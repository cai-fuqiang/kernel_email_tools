"""Tests for core utility functions and API key resolution."""

import os

import pytest

from src.qa.providers import parse_json_object, resolve_api_key
from src.storage.tag_store import (
    build_paragraph_anchor,
    hash_anchor,
    normalize_anchor,
    slugify_tag,
)
from src.api.server import VALID_ROLES, VALID_VISIBILITY, _normalize_role, _normalize_visibility


class TestResolveApiKey:
    def test_returns_env_var_when_set(self, monkeypatch):
        monkeypatch.setenv("DASHSCOPE_API_KEY", "env-key-123")
        result = resolve_api_key("dashscope", "config-key")
        assert result == "env-key-123"

    def test_falls_back_to_configured_key(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
        result = resolve_api_key("dashscope", "config-key")
        assert result == "config-key"

    def test_returns_empty_when_nothing_set(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
        result = resolve_api_key("dashscope")
        assert result == ""

    def test_unknown_provider_no_env_var(self, monkeypatch):
        result = resolve_api_key("unknown-provider", "my-key")
        assert result == "my-key"


class TestSlugifyTag:
    def test_lowercase_and_hyphenate(self):
        assert slugify_tag("KVM Virtualization") == "kvm-virtualization"

    def test_collapse_multiple_special_chars(self):
        assert slugify_tag("Foo!!!Bar@@@Baz") == "foo-bar-baz"

    def test_trim_leading_trailing_hyphens(self):
        assert slugify_tag("---hello---") == "hello"

    def test_generates_fallback_for_all_special(self):
        result = slugify_tag("!!!")
        assert result.startswith("tag-")
        assert len(result) > 4


class TestNormalizeAnchor:
    def test_none_returns_empty_dict(self):
        assert normalize_anchor(None) == {}

    def test_empty_dict(self):
        assert normalize_anchor({}) == {}

    def test_stable_key_ordering(self):
        a = normalize_anchor({"b": 1, "a": 2})
        b = normalize_anchor({"a": 2, "b": 1})
        assert json.dumps(a) == json.dumps(b)


class TestHashAnchor:
    def test_same_content_same_hash(self):
        a = hash_anchor({"paragraph_index": 0, "paragraph_hash": "abc"})
        b = hash_anchor({"paragraph_index": 0, "paragraph_hash": "abc"})
        assert a == b

    def test_key_order_independent(self):
        a = hash_anchor({"b": 1, "a": 2})
        b = hash_anchor({"a": 2, "b": 1})
        assert a == b

    def test_none_returns_hash_of_empty_dict(self):
        result = hash_anchor(None)
        assert len(result) == 64  # SHA-256 hex digest


class TestBuildParagraphAnchor:
    def test_includes_index_and_hash(self):
        anchor = build_paragraph_anchor(3, "hello world")
        assert anchor["paragraph_index"] == 3
        assert len(anchor["paragraph_hash"]) == 16

    def test_different_text_different_hash(self):
        a = build_paragraph_anchor(0, "text one")
        b = build_paragraph_anchor(0, "text two")
        assert a["paragraph_hash"] != b["paragraph_hash"]


class TestParseJsonObject:
    def test_plain_json(self):
        result = parse_json_object('{"key": "value"}')
        assert result == {"key": "value"}

    def test_fenced_json(self):
        result = parse_json_object('```json\n{"key": "value"}\n```')
        assert result == {"key": "value"}

    def test_fenced_no_language(self):
        result = parse_json_object('```\n{"key": "value"}\n```')
        assert result == {"key": "value"}

    def test_json_with_surrounding_text(self):
        result = parse_json_object('here is the output: {"key": "value"} done')
        assert result == {"key": "value"}

    def test_empty_returns_none(self):
        assert parse_json_object("") is None

    def test_invalid_returns_none(self):
        assert parse_json_object("not json at all") is None

    def test_list_returns_none(self):
        assert parse_json_object("[1, 2, 3]") is None


class TestNormalizeRole:
    def test_valid_admin(self):
        assert _normalize_role("admin") == "admin"

    def test_valid_editor(self):
        assert _normalize_role("editor") == "editor"

    def test_valid_viewer(self):
        assert _normalize_role("viewer") == "viewer"

    def test_case_insensitive(self):
        assert _normalize_role("ADMIN") == "admin"

    def test_whitespace(self):
        assert _normalize_role("  editor  ") == "editor"

    def test_invalid_defaults_to_viewer(self):
        assert _normalize_role("superuser") == "viewer"

    def test_none_defaults_to_viewer(self):
        assert _normalize_role("") == "viewer"


class TestNormalizeVisibility:
    def test_valid_public(self):
        assert _normalize_visibility("public") == "public"

    def test_valid_private(self):
        assert _normalize_visibility("private") == "private"

    def test_invalid_defaults_to_public(self):
        assert _normalize_visibility("secret") == "public"

    def test_empty_defaults_to_public(self):
        assert _normalize_visibility("") == "public"


# Needed for normalize_anchor test above
import json  # noqa: E402

"""Tests for auth utilities: password hashing, session tokens, capabilities."""

import hashlib
import secrets

import pytest

from src.api.deps import (
    _capabilities_for_role,
    _hash_password,
    _hash_session_token,
    _normalize_approval_status,
    _normalize_publish_status,
    _pbkdf2_iterations,
    _verify_password,
)


class TestPasswordHash:
    def test_roundtrip_correct_password(self):
        hashed = _hash_password("test-password-123")
        assert _verify_password("test-password-123", hashed) is True

    def test_wrong_password(self):
        hashed = _hash_password("correct-password")
        assert _verify_password("wrong-password", hashed) is False

    def test_hash_is_different_each_time(self):
        h1 = _hash_password("same-password")
        h2 = _hash_password("same-password")
        assert h1 != h2  # different salts

    def test_format_contains_algo_iterations_salt_digest(self):
        hashed = _hash_password("test")
        parts = hashed.split("$")
        assert len(parts) == 4
        assert parts[0] == "pbkdf2_sha256"
        assert int(parts[1]) >= 1000  # reasonable iteration count

    def test_verify_bad_format_returns_false(self):
        assert _verify_password("whatever", "not-a-valid-hash") is False

    def test_verify_wrong_algo_returns_false(self):
        assert _verify_password("pw", "argon2$1$abc$def") is False


class TestSessionTokenHash:
    def test_same_token_same_hash(self):
        token = secrets.token_urlsafe(32)
        assert _hash_session_token(token) == _hash_session_token(token)

    def test_hex_output(self):
        h = _hash_session_token("test-token")
        assert len(h) == 64  # SHA-256 hex
        assert all(c in "0123456789abcdef" for c in h)

    def test_different_tokens_different_hash(self):
        assert _hash_session_token("a") != _hash_session_token("b")


class TestNormalizeApprovalStatus:
    def test_approved(self):
        assert _normalize_approval_status("approved") == "approved"

    def test_pending(self):
        assert _normalize_approval_status("pending") == "pending"

    def test_rejected(self):
        assert _normalize_approval_status("rejected") == "rejected"

    def test_invalid_defaults_to_pending(self):
        assert _normalize_approval_status("unknown") == "pending"

    def test_none_defaults_to_pending(self):
        assert _normalize_approval_status("") == "pending"


class TestNormalizePublishStatus:
    def test_none_defaults_to_none_str(self):
        assert _normalize_publish_status("") == "none"

    def test_pending(self):
        assert _normalize_publish_status("pending") == "pending"

    def test_approved(self):
        assert _normalize_publish_status("approved") == "approved"

    def test_rejected(self):
        assert _normalize_publish_status("rejected") == "rejected"

    def test_invalid_defaults_to_none(self):
        assert _normalize_publish_status("published") == "none"


class TestCapabilitiesForRole:
    def test_admin_has_all(self):
        caps = _capabilities_for_role("admin")
        assert "read" in caps
        assert "write" in caps
        assert "manage_users" in caps

    def test_editor_has_read_write(self):
        caps = _capabilities_for_role("editor")
        assert caps == ["read", "write"]

    def test_viewer_has_read_only(self):
        caps = _capabilities_for_role("viewer")
        assert caps == ["read"]

    def test_agent_has_agent_permissions(self):
        caps = _capabilities_for_role("agent")
        assert "read" in caps
        assert "agent:research" in caps
        assert "agent:create_draft" in caps
        assert "write" not in caps

    def test_unknown_role_has_read_only(self):
        caps = _capabilities_for_role("superadmin")
        assert caps == ["read"]


class TestPbkdf2Iterations:
    def test_returns_reasonable_default(self):
        iters = _pbkdf2_iterations()
        assert iters >= 10000  # minimum reasonable iteration count

"""Utilities for extracting annotation-to-annotation Markdown links."""

from __future__ import annotations

import re
from typing import TypedDict

ANNOTATION_LINK_PATTERN = re.compile(
    r'(?<!!)\[(?P<label>[^\]]+)\]\(\s*annotation:(?P<annotation_id>[A-Za-z0-9._:-]+)'
    r'(?:\s+"(?P<relation_type>[^"]+)")?\s*\)'
)

RELATION_TYPES = (
    "references",
    "explains",
    "refines",
    "contradicts",
    "same_variable",
    "variable_evolves_to",
    "value_passed_to",
    "depends_on",
    "evidence_for",
)

SOURCE_KINDS = (
    "manual",
    "markdown_link",
    "system",
)

_RELATION_TYPE_SET = set(RELATION_TYPES)
_SOURCE_KIND_SET = set(SOURCE_KINDS)


class AnnotationLinkMatch(TypedDict):
    label: str
    annotation_id: str
    relation_type: str


def normalize_relation_type(value: str) -> str:
    normalized = (value or "").strip().lower().replace("-", "_")
    if normalized in _RELATION_TYPE_SET:
        return normalized
    return "references"


def normalize_source_kind(value: str) -> str:
    normalized = (value or "").strip().lower().replace("-", "_")
    if normalized in _SOURCE_KIND_SET:
        return normalized
    return "manual"


def extract_annotation_links(markdown: str) -> list[AnnotationLinkMatch]:
    links: list[AnnotationLinkMatch] = []
    for match in ANNOTATION_LINK_PATTERN.finditer(markdown or ""):
        links.append(
            {
                "label": match.group("label"),
                "annotation_id": match.group("annotation_id"),
                "relation_type": normalize_relation_type(match.group("relation_type") or ""),
            }
        )
    return links

"""Shared Pydantic models used by multiple routers."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class AnnotationResponse(BaseModel):
    annotation_id: str
    annotation_type: str = ""
    body: str = ""
    author: str = ""
    author_user_id: str = ""
    target_type: str = ""
    target_ref: str = ""
    target_label: str = ""
    target_subtitle: str = ""
    anchor: dict = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict)
    thread_id: str = ""
    parent_annotation_id: str = ""
    in_reply_to: str = ""
    visibility: str = "private"
    publish_status: str = "none"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DraftApplyRequest(BaseModel):
    selected_draft_ids: Optional[list[str]] = None
    knowledge_overrides: Optional[dict] = None
    annotation_overrides: Optional[dict] = None
    tag_overrides: Optional[dict] = None
    visibility: str = "private"
    force_create_tags: bool = False


class DraftApplyResponse(BaseModel):
    created_entities: list[dict] = Field(default_factory=list)
    created_annotations: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


def _annotation_to_response(annotation: Any) -> AnnotationResponse:
    """Convert an AnnotationRead / AnnotationORM-like object to AnnotationResponse.

    Normalizes nullable fields (e.g. author_user_id) into the stable API shape
    used by FastAPI response serialization.
    """
    if annotation is None:
        raise ValueError("annotation is required")

    def _get(name: str, default: Any = "") -> Any:
        if isinstance(annotation, dict):
            value = annotation.get(name, default)
        else:
            value = getattr(annotation, name, default)
        return default if value is None else value

    return AnnotationResponse(
        annotation_id=_get("annotation_id", ""),
        annotation_type=_get("annotation_type", ""),
        body=_get("body", ""),
        author=_get("author", ""),
        author_user_id=_get("author_user_id", "") or "",
        target_type=_get("target_type", ""),
        target_ref=_get("target_ref", ""),
        target_label=_get("target_label", ""),
        target_subtitle=_get("target_subtitle", ""),
        anchor=_get("anchor", {}) or {},
        meta=_get("meta", {}) or {},
        thread_id=_get("thread_id", ""),
        parent_annotation_id=_get("parent_annotation_id", "") or "",
        in_reply_to=_get("in_reply_to", ""),
        visibility=_get("visibility", "private") or "private",
        publish_status=_get("publish_status", "none") or "none",
        created_at=_get("created_at", None) or None,
        updated_at=_get("updated_at", None) or None,
    )

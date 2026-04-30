"""Shared Pydantic models used by multiple routers."""

from datetime import datetime
from typing import Optional

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

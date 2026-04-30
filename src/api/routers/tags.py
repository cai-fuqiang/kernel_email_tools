"""tags API routes."""

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

logger = logging.getLogger(__name__)

from src.api import state
from src.storage.models import (
    TagRead, TagTree, TagCreate, TagAssignmentCreate, TagAssignmentRead,
    TagBundle, EmailORM, EmailRead,
)

from src.api.deps import (
    CurrentUser, get_current_user, get_optional_current_user, require_roles,
    _is_admin, _normalize_role, _normalize_visibility, _normalize_approval_status,
    _normalize_publish_status, _ensure_public_write_allowed, _capabilities_for_role,
    _ensure_tag_manage_access, _resolve_tag_for_write, _ensure_tag_assignment_write_allowed,
    _ensure_tag_assignment_delete_access, _ensure_annotation_manage_access,
    _ensure_annotation_publish_request_access, _to_current_user_read, _get_user_orm,
    _hash_password, _verify_password, _hash_session_token, _serialize_user,
    _create_user_session, _clear_session_cookie, _revoke_session_by_token,
    _set_session_cookie, _session_cookie_name, _session_ttl_hours,
    _allow_public_registration, _require_admin_approval, _allow_header_auth_fallback,
    _local_auth_config, _header_name, _pbkdf2_iterations, _fallback_user,
    _resolve_user_from_session,
)
from src.api.schemas import AnnotationResponse, DraftApplyRequest, DraftApplyResponse

router = APIRouter(tags=["tags"])

class TagCreateRequest(BaseModel):
    """创建标签请求。"""
    name: str = Field(..., min_length=1, max_length=128, description="标签名称")
    slug: str = Field("", description="稳定 slug")
    description: str = Field("", description="标签描述")
    parent_id: Optional[int] = Field(None, description="父标签 ID（兼容字段）")
    parent_tag_id: Optional[int] = Field(None, description="父标签 ID")
    color: str = Field("#6366f1", description="标签颜色（十六进制）")
    status: str = Field("active", description="active | deprecated | draft")
    tag_kind: str = Field("topic", description="topic | subsystem | concept | status | person | org | process | evidence")
    visibility: str = Field("public", description="public | private")
    aliases: list[str] = Field(default_factory=list, description="标签别名")
    created_by: str = Field("me", description="创建者")


class TagUpdateRequest(BaseModel):
    """更新标签请求。"""
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None
    parent_tag_id: Optional[int] = None
    status: Optional[str] = None
    tag_kind: Optional[str] = None
    visibility: Optional[str] = None
    aliases: Optional[list[str]] = None
    updated_by: Optional[str] = None


class TagAddRequest(BaseModel):
    """为邮件添加标签请求。"""
    tag_name: str = Field(..., min_length=1, max_length=64, description="标签名称")


class TagAssignmentCreateRequest(BaseModel):
    tag_id: Optional[int] = None
    tag_slug: str = ""
    tag_name: str = ""
    target_type: str = Field(..., min_length=1, max_length=64)
    target_ref: str = Field(..., min_length=1, max_length=1024)
    anchor: dict = Field(default_factory=dict)
    assignment_scope: str = Field("direct")
    source_type: str = Field("manual")
    evidence: dict = Field(default_factory=dict)
    created_by: str = Field("me")


class TagTargetBundleResponse(BaseModel):
    target_type: str
    target_ref: str
    direct_tags: list[TagRead] = Field(default_factory=list)

    aggregated_tags: list[TagRead] = Field(default_factory=list)


@router.post("/api/tags", response_model=TagRead)
async def create_tag(
    request: TagCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建标签。

    支持父子层级，子标签通过 parent_id 指定父标签。
    """
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    visibility = _normalize_visibility(request.visibility)
    _ensure_public_write_allowed(visibility, current_user)

    try:
        tag = await state._tag_store.create_tag(
            TagCreate(
                name=request.name,
                slug=request.slug,
                description=request.description,
                parent_tag_id=request.parent_tag_id if request.parent_tag_id is not None else request.parent_id,
                color=request.color,
                status=request.status,
                tag_kind=request.tag_kind,
                visibility=visibility,
                aliases=request.aliases,
                created_by=current_user.display_name,
                owner_user_id=current_user.user_id,
                created_by_user_id=current_user.user_id,
            ),
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
        return state._tag_store._to_tag_read(tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/tags", response_model=list[TagTree])
async def get_tags(
    flat: bool = Query(False, description="是否返回平铺列表"),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取标签树形结构。

    返回所有标签，按父子关系组织成树形结构。
    """
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    return await state._tag_store.list_tags(
        flat=flat,
        viewer_user_id=current_user.user_id if current_user else None,
    )


@router.patch("/api/tags/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: int,
    request: TagUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    tag_obj = await _ensure_tag_manage_access(tag_id, current_user)
    if request.visibility is not None:
        _ensure_public_write_allowed(request.visibility, current_user)
    elif tag_obj.visibility == "public" and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admin can modify public tags")

    try:
        tag = await state._tag_store.update_tag(
            tag_id=tag_id,
            name=request.name,
            description=request.description,
            color=request.color,
            parent_tag_id=request.parent_tag_id if request.parent_tag_id is not None else request.parent_id,
            status=request.status,
            tag_kind=request.tag_kind,
            visibility=_normalize_visibility(request.visibility) if request.visibility is not None else None,
            aliases=request.aliases,
            updated_by=current_user.display_name,
            updated_by_user_id=current_user.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not tag:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    return state._tag_store._to_tag_read(tag)


@router.get("/api/tags/stats", response_model=list[dict])
async def get_tag_stats(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    """获取标签统计信息。

    返回所有标签及其被使用的邮件数量。
    """
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    return await state._tag_store.get_tag_stats(
        viewer_user_id=current_user.user_id if current_user else None
    )


@router.get("/api/tags/{tag_name}/emails")
async def get_tag_emails(
    tag_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取指定标签下的邮件列表。

    Args:
        tag_name: 标签名称。
        page: 页码（从 1 开始）。
        page_size: 每页数量（最大 100）。

    Returns:
        包含标签名、邮件列表、总数、分页信息的字典。
    """
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    results, total = await state._storage.get_emails_by_tag(
        tag_name=tag_name,
        page=page,
        page_size=page_size,
        viewer_user_id=current_user.user_id if current_user else None,
    )

    return {
        "tag": tag_name,
        "emails": [
            {
                "message_id": r.message_id,
                "subject": r.subject,
                "sender": r.sender,
                "date": r.date.isoformat() if r.date else None,
                "list_name": r.list_name,
                "thread_id": r.thread_id,
                "has_patch": r.has_patch,
                "snippet": r.snippet,
            }
            for r in results
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.delete("/api/tags/{tag_id}")
async def delete_tag(
    tag_id: int,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除标签。

    会级联删除所有子标签。
    """
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_manage_access(tag_id, current_user)

    deleted = await state._tag_store.delete_tag(tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    return {"status": "ok", "message": f"Tag {tag_id} deleted"}


@router.post("/api/tags/{source_id}/merge/{target_id}")
async def merge_tags(
    source_id: int,
    target_id: int,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """将 source 标签合并到 target 标签。

    所有 source 的 tag assignment 被重新分配到 target，
    source 的子标签迁移到 target 下，source 标签被删除。
    """
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_manage_access(source_id, current_user)
    await _ensure_tag_manage_access(target_id, current_user)

    try:
        result = await state._tag_store.merge_tag(source_id, target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", **result}


@router.post("/api/tag-assignments", response_model=TagAssignmentRead)
async def create_tag_assignment(
    request: TagAssignmentCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_assignment_write_allowed(
        current_user=current_user,
        tag_id=request.tag_id,
        tag_slug=request.tag_slug,
        tag_name=request.tag_name,
    )

    try:
        return await state._tag_store.assign_tag(
            TagAssignmentCreate(
                tag_id=request.tag_id,
                tag_slug=request.tag_slug,
                tag_name=request.tag_name,
                target_type=request.target_type,
                target_ref=request.target_ref,
                anchor=request.anchor,
                assignment_scope=request.assignment_scope,
                source_type=request.source_type,
                evidence=request.evidence,
                created_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
            ),
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/tag-assignments", response_model=list[TagAssignmentRead])
async def list_tag_assignments(
    target_type: Optional[str] = Query(None),
    target_ref: Optional[str] = Query(None),
    anchor_json: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    tag_kind: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    anchor = json.loads(anchor_json) if anchor_json else None
    return await state._tag_store.list_assignments(
        target_type=target_type,
        target_ref=target_ref,
        anchor=anchor,
        tag=tag,
        tag_kind=tag_kind,
        status=status,
        viewer_user_id=current_user.user_id if current_user else None,
    )


@router.delete("/api/tag-assignments/{assignment_id}")
async def delete_tag_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_assignment_delete_access(assignment_id, current_user)

    deleted = await state._tag_store.remove_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag assignment {assignment_id} not found")
    return {"status": "ok", "assignment_id": assignment_id, "deleted": True}


@router.get("/api/tag-targets")
async def get_tag_targets(
    tag: str = Query(..., min_length=1),
    target_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    items, total = await state._tag_store.get_targets_by_tag(
        tag=tag,
        target_type=target_type,
        page=page,
        page_size=page_size,
        viewer_user_id=current_user.user_id if current_user else None,
    )
    return {
        "tag": tag,
        "target_type": target_type,
        "targets": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/tag-targets/{target_type}/{target_ref:path}/tags", response_model=TagTargetBundleResponse)
async def get_target_tags(
    target_type: str,
    target_ref: str,
    anchor_json: Optional[str] = Query(None),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    bundle = await state._tag_store.get_target_bundle(
        target_type,
        target_ref,
        anchor=json.loads(anchor_json) if anchor_json else None,
        viewer_user_id=current_user.user_id if current_user else None,
    )
    return TagTargetBundleResponse(
        target_type=target_type,
        target_ref=target_ref,
        direct_tags=bundle.direct_tags,
        aggregated_tags=bundle.aggregated_tags,
    )


@router.get("/api/email/{message_id}/tags")
async def get_email_tags(
    message_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取邮件的标签列表。"""
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    tags = await state._storage.get_email_tags(
        message_id,
        viewer_user_id=current_user.user_id if current_user else None,
    )
    return {"message_id": message_id, "tags": tags}


@router.post("/api/email/{message_id}/tags")
async def add_email_tag(
    message_id: str,
    request: TagAddRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """为邮件添加标签。

    单封邮件最多 16 个标签。
    """
    if not state._storage or not state._tag_store:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    existing_tag = await _resolve_tag_for_write(tag_name=request.tag_name)
    if existing_tag is None:
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Editors can only use existing private tags")
        await state._tag_store.get_or_create_tag(
            request.tag_name,
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
    else:
        await _ensure_tag_assignment_write_allowed(
            current_user=current_user,
            tag_name=request.tag_name,
        )

    added = await state._storage.add_email_tag(
        message_id,
        request.tag_name,
        actor_user_id=current_user.user_id,
        actor_display_name=current_user.display_name,
    )
    if not added:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to add tag. Email may not exist or tag limit (16) reached."
        )

    return {
        "status": "ok",
        "message_id": message_id,
        "tag": request.tag_name,
    }


@router.delete("/api/email/{message_id}/tags/{tag_name}")
async def remove_email_tag(
    message_id: str,
    tag_name: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """从邮件移除标签。"""
    if not state._storage or not state._tag_store:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with state._storage.session_factory() as session:
        result = await session.execute(
            select(TagAssignmentORM.assignment_id)
            .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
            .outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
            .where(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_MESSAGE)
            .where(TagAssignmentORM.target_ref == message_id)
            .where(or_(TagORM.name == tag_name, TagORM.slug == tag_name, TagAliasORM.alias == tag_name))
        )
        assignment_ids = [row[0] for row in result.all()]

    if not assignment_ids:
        raise HTTPException(status_code=404, detail=f"No tag assignments found for {tag_name}")

    removed_any = False
    for assignment_id in assignment_ids:
        try:
            await _ensure_tag_assignment_delete_access(assignment_id, current_user)
        except HTTPException:
            continue
        removed = await state._tag_store.remove_assignment(assignment_id)
        removed_any = removed or removed_any
    if not removed_any:
        raise HTTPException(status_code=403, detail="No removable tag assignments found")

    return {
        "status": "ok",
        "message_id": message_id,
        "tag": tag_name,
        "removed": True,
    }



"""annotations API routes."""

import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

logger = logging.getLogger(__name__)

from src.api import state
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

router = APIRouter(tags=["annotations"])

class ThreadResponse(BaseModel):
    """线程响应。"""
    thread_id: str
    emails: list[dict]
    annotations: list[dict] = Field(default_factory=list)
    total: int


class StatsResponse(BaseModel):
    """统计信息响应。"""
    total_emails: int
    lists: dict


@router.get("/api/thread/{thread_id:path}", response_model=ThreadResponse)
async def get_thread(
    thread_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取邮件线程 — 返回线程内所有邮件及批注（按时间排序）。"""
    if not state._storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    emails = await state._storage.get_thread(thread_id)
    if not emails:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")

    # 获取线程批注
    annotations_data = []
    if state._annotation_store:
        annotations = await state._annotation_store.list_by_thread(
            thread_id,
            viewer_user_id=current_user.user_id if current_user else None,
        )
        annotations_data = [_annotation_to_response(a).model_dump() for a in annotations]

    return ThreadResponse(
        thread_id=thread_id,
        emails=[
            {
                "id": e.id,
                "message_id": e.message_id,
                "subject": e.subject,
                "sender": e.sender,
                "date": e.date.isoformat() if e.date else None,
                "in_reply_to": e.in_reply_to,
                "references": e.references or [],
                "has_patch": e.has_patch,
                "patch_content": e.patch_content or "",
                "body": e.body or "",
                "body_raw": e.body_raw or "",
            }
            for e in emails
        ],
        annotations=annotations_data,
        total=len(emails),
    )


@router.get("/api/stats", response_model=StatsResponse)
async def stats():
    """获取数据库统计信息。"""
    if not state._storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    total = await state._storage.get_email_count()

    return StatsResponse(
        total_emails=total,
        lists={"total": total},
    )


class AnnotationCreateRequest(BaseModel):
    """创建标注请求。"""
    annotation_type: Literal["email", "code", "sdm_spec"] = Field("email", description="标注类型")
    body: str = Field(..., min_length=1, description="批注正文（支持 Markdown）")
    author: str = Field("", description="批注作者（留空使用默认作者）")
    visibility: str = Field("public", description="public | private")

    parent_annotation_id: str = Field("", description="父批注 ID，用于回复")
    target_type: str = Field("", description="标注目标类型，如 email_thread / kernel_file / sdm_spec")
    target_ref: str = Field("", description="目标唯一引用")
    target_label: str = Field("", description="目标标题")
    target_subtitle: str = Field("", description="目标副标题")
    anchor: dict = Field(default_factory=dict, description="目标内锚点")
    meta: dict = Field(default_factory=dict, description="扩展元数据")

    # 邮件便捷字段
    thread_id: str = Field("", description="所属线程 ID")
    in_reply_to: str = Field("", description="邮件内定位 message_id")

    # 代码便捷字段
    version: str = Field("", description="内核版本 tag（code 类型必填）")
    file_path: str = Field("", description="文件相对路径（code 类型必填）")
    start_line: int = Field(0, ge=0, description="起始行号（code 类型必填）")
    end_line: int = Field(0, ge=0, description="结束行号（code 类型必填）")


class AnnotationUpdateRequest(BaseModel):
    """更新批注请求。"""
    body: str = Field(..., min_length=1, description="批注正文（支持 Markdown）")


class AnnotationPublicationReviewRequest(BaseModel):
    """管理员审核公开申请。"""
    review_comment: str = Field("", max_length=2000, description="审核说明")


@router.get("/api/annotations/stats")
async def get_annotation_stats(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    """获取批注各类型总数统计。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    from sqlalchemy import func, select
    from src.storage.models import AnnotationORM

    async with state._annotation_store.session_factory() as session:
        stmt = (
            select(AnnotationORM.annotation_type, func.count(AnnotationORM.id).label("count"))
            .where(*state._annotation_store._visibility_filters(
                current_user.user_id if current_user else None
            ))
            .group_by(AnnotationORM.annotation_type)
        )
        result = await session.execute(stmt)
        rows = result.all()
        counts = {row[0]: row[1] for row in rows}
        return {
            "email_count": counts.get("email", 0),
            "code_count": counts.get("code", 0),
            "sdm_spec_count": counts.get("sdm_spec", 0),
            "total": sum(counts.values()),
        }


@router.get("/api/annotations")
async def list_annotations(
    q: Optional[str] = Query(None, description="搜索关键词（模糊匹配批注正文）"),
    type: str = Query("all", description="批注类型过滤：'all' | 'email' | 'code'"),
    version: Optional[str] = Query(None, description="限定代码版本（code 类型时）"),
    target_type: Optional[str] = Query(None, description="限定目标类型"),
    target_ref: Optional[str] = Query(None, description="限定目标引用"),
    publish_status: Optional[str] = Query(None, description="公开申请状态过滤"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """统一标注列表与搜索。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    try:
        extra_filters = []
        if type == "code" and version:
            extra_filters.append(AnnotationORM.version == version)
        if target_type:
            extra_filters.append(AnnotationORM.target_type == target_type)
        if target_ref:
            extra_filters.append(AnnotationORM.target_ref == target_ref)
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)

        if q and q.strip():
            annotations, total = await state._annotation_store.search(
                keyword=q.strip(),
                annotation_type=type,
                page=page,
                page_size=page_size,
                extra_filters=extra_filters or None,
                viewer_user_id=current_user.user_id if current_user else None,
                include_all_private=bool(current_user and _is_admin(current_user)),
            )
        else:
            annotations, total = await state._annotation_store.list_all(
                annotation_type=type,
                page=page,
                page_size=page_size,
                extra_filters=extra_filters or None,
                viewer_user_id=current_user.user_id if current_user else None,
                include_all_private=bool(current_user and _is_admin(current_user)),
            )

        return {
            "annotations": annotations,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    except Exception as e:
        logger.error(f"Failed to list annotations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list annotations: {str(e)}")


@router.post("/api/annotations", response_model=AnnotationResponse)
async def create_annotation(
    request: AnnotationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建统一标注。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    parent_annotation_id = request.parent_annotation_id
    if not parent_annotation_id and request.in_reply_to.startswith(("annotation-", "code-annot-")):
        parent_annotation_id = request.in_reply_to

    visibility = _normalize_visibility(request.visibility)
    if parent_annotation_id and not _is_admin(current_user):
        visibility = "private"
    _ensure_public_write_allowed(visibility, current_user)

    if request.annotation_type == "email" and not request.thread_id:
        raise HTTPException(status_code=400, detail="thread_id is required for email annotations")

    if request.annotation_type == "code":
        if not request.version or not request.file_path or request.start_line <= 0 or request.end_line <= 0:
            raise HTTPException(status_code=400, detail="version, file_path, start_line and end_line are required for code annotations")
        if request.start_line > request.end_line:
            raise HTTPException(status_code=400, detail="start_line must not exceed end_line")

    try:
        annotation = await state._annotation_store.create(
            AnnotationCreate(
                annotation_type=request.annotation_type,
                body=request.body,
                author=current_user.display_name,
                author_user_id=current_user.user_id,
                visibility=visibility,
                parent_annotation_id=parent_annotation_id,
                target_type=request.target_type,
                target_ref=request.target_ref,
                target_label=request.target_label,
                target_subtitle=request.target_subtitle,
                anchor=request.anchor,
                meta=request.meta,
                thread_id=request.thread_id,
                in_reply_to=request.in_reply_to,
                version=request.version,
                file_path=request.file_path,
                start_line=request.start_line,
                end_line=request.end_line,
            ),
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
        return _annotation_to_response(annotation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/annotations/{thread_id:path}", response_model=list[AnnotationResponse])
async def get_annotations(
    thread_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取线程所有批注（仅 email 类型）。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await state._annotation_store.list_by_thread(
        thread_id,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return [_annotation_to_response(a) for a in annotations]


@router.post("/api/annotations/{annotation_id}/publish-request", response_model=AnnotationResponse)
async def request_annotation_publication(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _ensure_annotation_publish_request_access(annotation_id, current_user)
    if annotation.visibility != "private":
        raise HTTPException(status_code=400, detail="Only private annotations can request publication")

    updated = await state._annotation_store.request_publication(annotation_id, current_user.user_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@router.post("/api/annotations/{annotation_id}/publish-withdraw", response_model=AnnotationResponse)
async def withdraw_annotation_publication_request(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await state._annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if not _is_admin(current_user):
        if annotation.author_user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="Editors can only withdraw their own publication requests")
        if annotation.visibility == "public":
            raise HTTPException(status_code=400, detail="Public annotations do not have a withdrawable publication request")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await state._annotation_store.withdraw_publication_request(annotation_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@router.post("/api/admin/annotations/{annotation_id}/approve-publication", response_model=AnnotationResponse)
async def approve_annotation_publication(
    annotation_id: str,
    request: AnnotationPublicationReviewRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await state._annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await state._annotation_store.review_publication(
        annotation_id,
        approved=True,
        reviewer_user_id=current_user.user_id,
        review_comment=request.review_comment,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@router.post("/api/admin/annotations/{annotation_id}/reject-publication", response_model=AnnotationResponse)
async def reject_annotation_publication(
    annotation_id: str,
    request: AnnotationPublicationReviewRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await state._annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await state._annotation_store.review_publication(
        annotation_id,
        approved=False,
        reviewer_user_id=current_user.user_id,
        review_comment=request.review_comment,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@router.put("/api/annotations/{annotation_id}")
async def update_annotation(
    annotation_id: str,
    request: AnnotationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """编辑批注。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    updated = await state._annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@router.delete("/api/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除批注。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    deleted = await state._annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return {"status": "ok", "message": f"Annotation {annotation_id} deleted"}


@router.post("/api/annotations/export")
async def export_annotations(
    thread_id: Optional[str] = Query(None, description="线程 ID（留空导出全部）"),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """导出批注为 JSON（满足 git 固化需求）。

    - 指定 thread_id：导出单个线程的批注
    - 不指定：导出所有批注（按线程分组）
    """
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if thread_id:
        annotations = await state._annotation_store.list_by_thread(
            thread_id,
            viewer_user_id=current_user.user_id,
            include_all_private=_is_admin(current_user),
        )
        return {
            "thread_id": thread_id,
            "exported_at": datetime.utcnow().isoformat(),
            "annotations": [item.model_dump(mode="json") for item in annotations],
        }
    else:
        items, _ = await state._annotation_store.list_all(
            annotation_type="all",
            page=1,
            page_size=10_000,
            viewer_user_id=current_user.user_id,
            include_all_private=_is_admin(current_user),
        )
        grouped: dict[str, list[dict]] = {}
        for item in items:
            grouped.setdefault(item["target_ref"], []).append(item)
        return {
            "exported_at": datetime.utcnow().isoformat(),
            "total_annotations": len(items),
            "targets": grouped,
        }


@router.post("/api/annotations/import")
async def import_annotations(
    data: dict = Body(...),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """从 JSON 导入批注（已存在的会跳过）。

    支持两种格式：
    - 单目标格式：{ "thread_id": "...", "annotations": [...] }
    - 全量格式：{ "targets": { "target_ref": [...], ... } }
    """
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    try:
        if "targets" in data:
            result = await state._annotation_store.import_all(data)
            return {"status": "ok", **result}
        elif "thread_id" in data:
            count = await state._annotation_store.import_thread(data)
            return {"status": "ok", "total_imported": count, "thread_id": data["thread_id"]}
        else:
            raise HTTPException(status_code=400, detail="Invalid format: need 'targets' or 'thread_id' key")
    except Exception as e:
        logger.error(f"Failed to import annotations: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")



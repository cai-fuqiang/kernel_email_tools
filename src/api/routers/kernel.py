"""kernel API routes."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

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

router = APIRouter(tags=["kernel"])

@router.get("/api/kernel/versions")
async def kernel_versions(
    filter: str = Query("release", description="版本过滤: release(正式版) 或 all(含rc)"),
):
    """获取所有可用的内核版本列表。

    返回按版本号降序排列的版本信息列表，支持过滤 rc 版本。
    """
    if not state._kernel_source:
        raise HTTPException(
            status_code=503,
            detail="Kernel source not initialized. Please configure kernel_source.repo_path in settings.yaml",
        )

    include_rc = (filter == "all")
    versions = await state._kernel_source.list_versions(include_rc=include_rc)
    return {
        "versions": [
            {
                "tag": v.tag,
                "major": v.major,
                "minor": v.minor,
                "patch": v.patch,
                "rc": v.rc,
                "is_release": v.is_release,
            }
            for v in versions
        ],
        "total": len(versions),
    }


@router.get("/api/kernel/tree/{version}/{path:path}")
async def kernel_tree(version: str, path: str = ""):
    """获取指定版本、指定路径下的目录树。

    Args:
        version: 版本 tag（如 v6.1）。
        path: 相对路径（空字符串表示根目录）。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        entries = await state._kernel_source.list_tree(version, path)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "version": version,
        "path": path,
        "entries": [
            {
                "name": e.name,
                "path": e.path,
                "type": e.entry_type.value,
                "size": e.size,
            }
            for e in entries
        ],
        "total": len(entries),
    }


@router.get("/api/kernel/tree/{version}")
async def kernel_tree_root(version: str):
    """获取指定版本根目录树（无 path 参数时的路由）。"""
    return await kernel_tree(version, "")


@router.get("/api/kernel/file/{version}/{path:path}")
async def kernel_file(version: str, path: str):
    """获取指定版本、指定文件的内容。

    Args:
        version: 版本 tag。
        path: 文件相对路径。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        file_content = await state._kernel_source.get_file(version, path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "version": file_content.version,
        "path": file_content.path,
        "content": file_content.content,
        "line_count": file_content.line_count,
        "size": file_content.size,
        "truncated": file_content.truncated,
    }




class CodeAnnotationCreateRequest(BaseModel):
    """创建代码注释请求。"""
    version: str = Field(..., description="内核版本 tag")
    file_path: str = Field(..., description="文件相对路径")
    start_line: int = Field(..., ge=1, description="起始行号")
    end_line: int = Field(..., ge=1, description="结束行号")
    body: str = Field(..., min_length=1, description="注释正文（支持 Markdown）")
    author: Optional[str] = Field(None, description="作者名称")
    visibility: str = Field("public", description="public | private")
    in_reply_to: Optional[str] = Field(None, description="回复的父 annotation_id")


class CodeAnnotationUpdateRequest(BaseModel):
    """更新代码注释请求。"""
    body: str = Field(..., min_length=1, description="注释正文")


@router.get("/api/kernel/annotations")
async def list_code_annotations(
    q: Optional[str] = Query(None, description="搜索关键词"),
    version: Optional[str] = Query(None, description="限定版本"),
    publish_status: Optional[str] = Query(None, description="公开申请状态过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """代码标注总览，基于统一 annotation store。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if q and q.strip():
        extra_filters = [AnnotationORM.version == version] if version else []
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)
        annotations, total = await state._annotation_store.search(
            keyword=q.strip(),
            annotation_type="code",
            page=page,
            page_size=page_size,
            extra_filters=extra_filters or None,
            viewer_user_id=current_user.user_id if current_user else None,
            include_all_private=bool(current_user and _is_admin(current_user)),
        )
    else:
        extra_filters = [AnnotationORM.version == version] if version else []
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)
        annotations, total = await state._annotation_store.list_all(
            annotation_type="code",
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


@router.get("/api/kernel/annotations/{version}/{path:path}")
async def get_file_code_annotations(
    version: str,
    path: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取指定文件的注释列表。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await state._annotation_store.list_by_code(
        version,
        path,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return [_annotation_to_response(a).model_dump() for a in annotations]


@router.post("/api/kernel/annotations")
async def create_code_annotation(
    request: CodeAnnotationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建代码注释。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    visibility = _normalize_visibility(request.visibility)
    if request.in_reply_to and not _is_admin(current_user):
        visibility = "private"
    _ensure_public_write_allowed(visibility, current_user)

    try:
        annotation = await state._annotation_store.create(
            AnnotationCreate(
                annotation_type="code",
                body=request.body,
                author=current_user.display_name,
                author_user_id=current_user.user_id,
                visibility=visibility,
                parent_annotation_id=request.in_reply_to or "",
                target_type="kernel_file",
                target_ref=f"{request.version}:{request.file_path}",
                target_label=request.file_path,
                target_subtitle=request.version,
                anchor={
                    "start_line": request.start_line,
                    "end_line": request.end_line,
                },
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


@router.put("/api/kernel/annotations/{annotation_id}")
async def update_code_annotation(
    annotation_id: str,
    request: CodeAnnotationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """更新代码注释正文。"""
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


@router.delete("/api/kernel/annotations/{annotation_id}")
async def delete_code_annotation(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除代码注释。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    deleted = await state._annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return {"status": "ok", "annotation_id": annotation_id}

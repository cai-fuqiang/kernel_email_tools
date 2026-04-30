"""system API routes."""

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

router = APIRouter(tags=["system"])

@router.get("/api/channels")
async def get_channels():
    """获取可用的邮件 channel 列表（来自配置文件 email_collector.local_channels）。"""
    channels_config = state._app_config.get("email_collector", {}).get("local_channels", [])
    if not channels_config:
        # 从数据库获取 distinct list_name 作为降级方案
        if state._storage:
            async with state._storage.session_factory() as session:
                result = await session.execute(
                    select(EmailORM.list_name).distinct()
                )
                names = [row[0] for row in result.fetchall() if row[0]]
                return [{"value": name, "label": name.upper()} for name in sorted(names)]
        return []
    return [{"value": ch["name"], "label": ch["name"].upper()} for ch in channels_config]


@router.get("/")
async def root():
    """API 根路径 — 重定向到前端页面。"""
    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/app/", status_code=302)


@router.get("/api/")
async def root():
    """API 根路径 — 健康检查。"""
    return {"status": "ok", "service": "kernel-email-kb", "version": "0.1.0"}



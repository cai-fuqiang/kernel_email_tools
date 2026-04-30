"""FastAPI dependency injection — auth middleware, normalization, access control.

All route modules import their dependencies from here.
"""

import base64
import hashlib
import logging
import os
import secrets
import uuid as uuid_module
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from src.api import state
from src.storage.models import (
    AnnotationORM,
    AnnotationRead,
    CurrentUserRead,
    TagAliasORM,
    TagAssignmentORM,
    TagORM,
    UserORM,
    UserSessionORM,
)

logger = logging.getLogger(__name__)

# ============================================================
# Constants
# ============================================================
VALID_ROLES = {"admin", "editor", "viewer", "agent"}
VALID_VISIBILITY = {"public", "private"}
VALID_APPROVAL_STATUS = {"pending", "approved", "rejected"}
VALID_PUBLISH_STATUS = {"none", "pending", "approved", "rejected"}


# ============================================================
# CurrentUser model (used by all routes)
# ============================================================
class CurrentUser(BaseModel):
    user_id: str
    username: str
    display_name: str
    email: str
    approval_status: str
    role: str
    status: str
    auth_source: str


# ============================================================
# Normalization helpers
# ============================================================
def _normalize_role(role: str) -> str:
    role_value = (role or "viewer").strip().lower()
    return role_value if role_value in VALID_ROLES else "viewer"


def _normalize_visibility(value: str) -> str:
    visibility = (value or "public").strip().lower()
    return visibility if visibility in VALID_VISIBILITY else "public"


def _normalize_approval_status(value: str) -> str:
    status_value = (value or "pending").strip().lower()
    return status_value if status_value in VALID_APPROVAL_STATUS else "pending"


def _normalize_publish_status(value: str) -> str:
    status_value = (value or "none").strip().lower()
    return status_value if status_value in VALID_PUBLISH_STATUS else "none"


def _capabilities_for_role(role: str) -> list[str]:
    if role == "admin":
        return ["read", "write", "manage_users"]
    if role == "editor":
        return ["read", "write"]
    if role == "agent":
        return [
            "read",
            "agent:research",
            "agent:create_draft",
            "agent:create_private_note",
            "agent:suggest_merge",
        ]
    return ["read"]


# ============================================================
# Config accessors
# ============================================================
def _header_name(name: str, default: str) -> str:
    return str(state._auth_config.get("headers", {}).get(name, default))


def _local_auth_config() -> dict:
    return state._auth_config.get("local", {}) or {}


def _session_cookie_name() -> str:
    return str(_local_auth_config().get("session_cookie_name", "kernel_email_session"))


def _session_ttl_hours() -> int:
    return int(_local_auth_config().get("session_ttl_hours", 168))


def _allow_header_auth_fallback() -> bool:
    return bool(_local_auth_config().get("allow_header_auth_fallback", True))


def _allow_public_registration() -> bool:
    return bool(_local_auth_config().get("allow_public_registration", True))


def _require_admin_approval() -> bool:
    return bool(_local_auth_config().get("require_admin_approval", True))


def _pbkdf2_iterations() -> int:
    return int(_local_auth_config().get("pbkdf2_iterations", 240000))


# ============================================================
# Password / session token helpers
# ============================================================
def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = _pbkdf2_iterations()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt_b64}${digest_b64}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations_raw, salt_b64, digest_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(digest_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations_raw),
        )
        return secrets.compare_digest(actual, expected)
    except Exception:
        logger.debug("Password verification failed (bad hash format or encoding)")
        return False


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ============================================================
# User serialization / fallback
# ============================================================
def _serialize_user(user: UserORM) -> CurrentUser:
    return CurrentUser(
        user_id=user.user_id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        approval_status=_normalize_approval_status(user.approval_status),
        role=_normalize_role(user.role),
        status=user.status,
        auth_source=user.auth_source,
    )


def _fallback_user() -> Optional[CurrentUser]:
    fallback = state._auth_config.get("dev_fallback_user", {}) or {}
    if not fallback.get("enabled", False):
        return None
    role = _normalize_role(str(fallback.get("role", "admin")))
    user_id = str(fallback.get("user_id", "dev-admin")).strip()
    return CurrentUser(
        user_id=user_id,
        username=str(fallback.get("username", user_id)).strip(),
        display_name=str(fallback.get("display_name", user_id)).strip(),
        email=str(fallback.get("email", "")).strip(),
        approval_status="approved",
        role=role,
        status=str(fallback.get("status", "active")).strip() or "active",
        auth_source="fallback",
    )


# ============================================================
# User sync / session management
# ============================================================
async def _sync_user_record(current_user: CurrentUser) -> CurrentUser:
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    allow_auto_provision = state._auth_config.get("allow_auto_provision", True)
    now = datetime.utcnow()
    async with state._storage.session_factory() as session:
        result = await session.execute(
            select(UserORM).where(UserORM.user_id == current_user.user_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            # 用户可能已通过不同 user_id 前缀（local: vs header:）存在，
            # 按 username 查找以避免重复键冲突。
            existing = await session.execute(
                select(UserORM).where(UserORM.username == current_user.username)
            )
            user = existing.scalar_one_or_none()
            if user is not None:
                # 更新现有记录的 user_id 和其他字段
                user.user_id = current_user.user_id
                user.auth_source = current_user.auth_source or user.auth_source
                user.last_seen_at = now
                user.updated_at = now
            elif not allow_auto_provision:
                raise HTTPException(status_code=401, detail="User provisioning disabled")
            else:
                user = UserORM(
                    user_id=current_user.user_id,
                    username=current_user.username,
                    display_name=current_user.display_name,
                    email=current_user.email,
                    approval_status=_normalize_approval_status(current_user.approval_status or "approved"),
                    role=_normalize_role(current_user.role or "viewer"),
                    status=current_user.status,
                    auth_source=current_user.auth_source,
                    last_seen_at=now,
                    created_at=now,
                    updated_at=now,
                )
                session.add(user)
        else:
            user.username = current_user.username or user.username
            user.display_name = current_user.display_name or user.display_name
            user.email = current_user.email or user.email
            if current_user.approval_status:
                user.approval_status = _normalize_approval_status(current_user.approval_status)
            if current_user.role:
                user.role = _normalize_role(current_user.role)
            user.status = current_user.status or user.status
            user.auth_source = current_user.auth_source or user.auth_source
            user.last_seen_at = now
            user.updated_at = now
        await session.commit()
        await session.refresh(user)
        if user.status != "active":
            raise HTTPException(status_code=403, detail="User is disabled")
        return _serialize_user(user)


async def _maybe_bootstrap_admin() -> None:
    if not state._storage:
        return
    bootstrap = _local_auth_config().get("bootstrap_admin", {}) or {}
    username = str(bootstrap.get("username", "")).strip()
    password = str(os.environ.get("KERNEL_ADMIN_PASSWORD") or bootstrap.get("password", "")).strip()
    if not username or not password:
        return
    async with state._storage.session_factory() as session:
        admin_count = (
            await session.execute(
                select(func.count())
                .select_from(UserORM)
                .where(UserORM.role == "admin")
                .where(UserORM.password_hash != "")
            )
        ).scalar() or 0
        if admin_count > 0:
            return
        now = datetime.utcnow()
        result = await session.execute(select(UserORM).where(UserORM.username == username))
        user = result.scalar_one_or_none()
        if user is None:
            user = UserORM(
                user_id=f"local:{username}",
                username=username,
                display_name=str(bootstrap.get("display_name", username)).strip() or username,
                email=str(bootstrap.get("email", "")).strip(),
                created_at=now,
            )
            session.add(user)
        user.display_name = str(bootstrap.get("display_name", user.display_name or username)).strip() or username
        user.email = str(bootstrap.get("email", user.email)).strip()
        user.password_hash = _hash_password(password)
        user.password_algo = "pbkdf2_sha256"
        user.approval_status = "approved"
        user.approved_by_user_id = user.user_id
        user.approved_at = now
        user.role = "admin"
        user.status = "active"
        user.auth_source = "local"
        user.last_seen_at = now
        user.updated_at = now
        await session.commit()
        logger.info("Bootstrapped local admin user: %s", username)


async def _maybe_bootstrap_agent() -> Optional[CurrentUser]:
    if not state._storage:
        return None
    agent_cfg = (state._app_config.get("agent", {}) or {}).get("default_agent", {}) or {}
    username = str(agent_cfg.get("username", "lobster-agent")).strip() or "lobster-agent"
    display_name = str(agent_cfg.get("display_name", "Lobster Research Agent")).strip() or "Lobster Research Agent"
    email = str(agent_cfg.get("email", "")).strip()
    user_id = f"agent:{username}"
    now = datetime.utcnow()
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            user = UserORM(
                user_id=user_id, username=username, display_name=display_name,
                email=email, approval_status="approved", approved_by_user_id=user_id,
                approved_at=now, role="agent", status="active",
                auth_source="system_agent", last_seen_at=now,
                created_at=now, updated_at=now,
            )
            session.add(user)
        else:
            user.username = username
            user.display_name = display_name
            user.email = email
            user.approval_status = "approved"
            user.role = "agent"
            user.status = "active"
            user.auth_source = "system_agent"
            user.updated_at = now
        await session.commit()
        await session.refresh(user)
        logger.info("Bootstrapped AI agent user: %s", username)
        return _serialize_user(user)


async def _resolve_user_from_session(request: Request) -> Optional[CurrentUser]:
    if not state._storage or not _local_auth_config().get("enabled", True):
        return None
    token = request.cookies.get(_session_cookie_name(), "").strip()
    if not token:
        return None
    token_hash = _hash_session_token(token)
    async with state._storage.session_factory() as session:
        result = await session.execute(
            select(UserSessionORM, UserORM)
            .join(UserORM, UserORM.user_id == UserSessionORM.user_id)
            .where(UserSessionORM.session_token_hash == token_hash)
            .where(UserSessionORM.revoked_at.is_(None))
        )
        row = result.first()
        if not row:
            return None
        session_row, user = row
        now = datetime.now(session_row.expires_at.tzinfo) if session_row.expires_at.tzinfo else datetime.utcnow()
        if session_row.expires_at <= now:
            session_row.revoked_at = now
            await session.commit()
            return None
        if user.status != "active":
            raise HTTPException(status_code=403, detail="User is disabled")
        if _normalize_approval_status(user.approval_status) != "approved":
            raise HTTPException(status_code=403, detail=f"Account is {user.approval_status}")
        user.last_seen_at = now
        user.last_login_at = user.last_login_at or now
        await session.commit()
        return _serialize_user(user)


async def _create_user_session(user: UserORM, request: Request) -> str:
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    raw_token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    async with state._storage.session_factory() as session:
        session_row = UserSessionORM(
            session_id=secrets.token_hex(16),
            user_id=user.user_id,
            session_token_hash=_hash_session_token(raw_token),
            created_at=now,
            expires_at=now + timedelta(hours=_session_ttl_hours()),
        )
        session.add(session_row)
        await session.commit()
        return raw_token


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_session_cookie_name(),
        value=token,
        httponly=True,
        secure=bool(_local_auth_config().get("cookie_secure", False)),
        samesite="lax",
        max_age=int(timedelta(hours=_session_ttl_hours()).total_seconds()),
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=_session_cookie_name())


async def _revoke_session_by_token(token: str) -> None:
    if not state._storage:
        return
    token_hash = _hash_session_token(token)
    async with state._storage.session_factory() as session:
        result = await session.execute(
            select(UserSessionORM).where(UserSessionORM.session_token_hash == token_hash)
        )
        session_row = result.scalar_one_or_none()
        if session_row and not session_row.revoked_at:
            session_row.revoked_at = datetime.utcnow()
            await session.commit()


# ============================================================
# Auth dependency functions (FastAPI Depends)
# ============================================================
async def _resolve_current_user(request: Request, required: bool = True) -> Optional[CurrentUser]:
    # Header-based auth (trusted proxy)
    auth_mode = state._auth_config.get("mode", "header")
    if auth_mode == "header":
        username = request.headers.get(_header_name("username", "X-Username"), "").strip()
        if username:
            user = CurrentUser(
                user_id=request.headers.get(_header_name("user_id", "X-User-Id"), f"header:{username}").strip() or f"header:{username}",
                username=username,
                display_name=request.headers.get(_header_name("display_name", "X-Display-Name"), username).strip() or username,
                email=request.headers.get(_header_name("email", "X-User-Email"), "").strip(),
                approval_status="approved",
                role=request.headers.get(_header_name("role", "X-User-Role"), "viewer").strip(),
                status="active",
                auth_source="header",
            )
            return await _sync_user_record(user)
        # No header — fall through to local session cookie auth below

    # Local auth mode
    if _local_auth_config().get("enabled", True):
        user = await _resolve_user_from_session(request)
        if user:
            return user
        if _allow_header_auth_fallback():
            username = request.headers.get(_header_name("username", "X-Username"), "").strip()
            if username:
                user = CurrentUser(
                    user_id=request.headers.get(_header_name("user_id", "X-User-Id"), f"header:{username}").strip() or f"header:{username}",
                    username=username,
                    display_name=request.headers.get(_header_name("display_name", "X-Display-Name"), username).strip() or username,
                    email=request.headers.get(_header_name("email", "X-User-Email"), "").strip(),
                    approval_status="approved",
                    role=request.headers.get(_header_name("role", "X-User-Role"), "viewer").strip(),
                    status="active",
                    auth_source="header",
                )
                return await _sync_user_record(user)

    user = _fallback_user()
    if user:
        return await _sync_user_record(user)
    if required:
        raise HTTPException(status_code=401, detail="Authentication required")
    return None


async def get_current_user(request: Request) -> CurrentUser:
    user = await _resolve_current_user(request, required=True)
    assert user is not None
    return user


async def get_optional_current_user(request: Request) -> Optional[CurrentUser]:
    return await _resolve_current_user(request, required=False)


def require_roles(*roles: str):
    async def dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Permission denied")
        return current_user
    return dependency


# ============================================================
# Access control helpers
# ============================================================
def _is_admin(current_user: CurrentUser) -> bool:
    return current_user.role == "admin"


def _ensure_public_write_allowed(visibility: str, current_user: CurrentUser) -> None:
    if _normalize_visibility(visibility) == "public" and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admin can modify public content")


async def _ensure_tag_manage_access(tag_id: int, current_user: CurrentUser) -> TagORM:
    if not state._tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    tag = await state._tag_store.get_tag(tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    if _is_admin(current_user):
        return tag
    if tag.visibility == "public":
        raise HTTPException(status_code=403, detail="Only admin can modify public tags")
    if tag.owner_user_id == current_user.user_id or tag.created_by_user_id == current_user.user_id:
        return tag
    raise HTTPException(status_code=403, detail="Editors can only modify their own private tags")


async def _resolve_tag_for_write(
    *, tag_id: Optional[int] = None, tag_slug: str = "", tag_name: str = "",
) -> Optional[TagORM]:
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        stmt = select(TagORM).outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
        if tag_id is not None:
            stmt = stmt.where(TagORM.id == tag_id)
        elif tag_slug:
            stmt = stmt.where(TagORM.slug == tag_slug)
        elif tag_name:
            stmt = stmt.where(or_(TagORM.name == tag_name, TagAliasORM.alias == tag_name))
        else:
            return None
        result = await session.execute(stmt)
        return result.scalars().first()


async def _ensure_tag_assignment_write_allowed(
    *, current_user: CurrentUser, tag_id: Optional[int] = None,
    tag_slug: str = "", tag_name: str = "",
) -> TagORM:
    tag = await _resolve_tag_for_write(tag_id=tag_id, tag_slug=tag_slug, tag_name=tag_name)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if _is_admin(current_user):
        return tag
    if tag.visibility == "public":
        raise HTTPException(status_code=403, detail="Only admin can modify public tags")
    if tag.owner_user_id == current_user.user_id or tag.created_by_user_id == current_user.user_id:
        return tag
    raise HTTPException(status_code=403, detail="Editors can only use their own private tags")


async def _ensure_tag_assignment_delete_access(assignment_id: str, current_user: CurrentUser) -> TagAssignmentORM:
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        result = await session.execute(
            select(TagAssignmentORM, TagORM)
            .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
            .where(TagAssignmentORM.assignment_id == assignment_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Tag assignment {assignment_id} not found")
        assignment, tag = row
        if _is_admin(current_user):
            return assignment
        if tag.visibility == "public":
            raise HTTPException(status_code=403, detail="Only admin can modify public tags")
        if assignment.created_by_user_id == current_user.user_id and (
            tag.owner_user_id == current_user.user_id or tag.created_by_user_id == current_user.user_id
        ):
            return assignment
        raise HTTPException(status_code=403, detail="Editors can only modify their own private tag assignments")


async def _ensure_annotation_manage_access(annotation_id: str, current_user: CurrentUser) -> AnnotationRead:
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    annotation = await state._annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if _is_admin(current_user):
        return annotation
    if annotation.visibility == "public":
        raise HTTPException(status_code=403, detail="Only admin can modify public annotations")
    if annotation.publish_status == "pending":
        raise HTTPException(status_code=403, detail="Pending publication annotations must be withdrawn before editing")
    if annotation.author_user_id == current_user.user_id:
        return annotation
    raise HTTPException(status_code=403, detail="Editors can only modify their own private annotations")


async def _ensure_annotation_publish_request_access(annotation_id: str, current_user: CurrentUser) -> AnnotationRead:
    annotation = await _ensure_annotation_manage_access(annotation_id, current_user)
    if _is_admin(current_user):
        raise HTTPException(status_code=400, detail="Admins can directly review publication requests")
    if annotation.publish_status == "pending":
        raise HTTPException(status_code=400, detail="Annotation already pending publication review")
    return annotation


# ============================================================
# User read helpers
# ============================================================
def _to_current_user_read(current_user: CurrentUser) -> CurrentUserRead:
    return CurrentUserRead(
        user_id=current_user.user_id,
        username=current_user.username,
        display_name=current_user.display_name,
        email=current_user.email,
        approval_status=current_user.approval_status,
        role=current_user.role,
        status=current_user.status,
        auth_source=current_user.auth_source,
        capabilities=_capabilities_for_role(current_user.role),
    )


async def _get_user_orm(user_id: str) -> UserORM:
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        return user


# ============================================================
# Dependency getters for global state (FastAPI Depends)
# ============================================================
def _require_storage():
    if state._storage is None:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    return state._storage


def _require_tag_store():
    if state._tag_store is None:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    return state._tag_store


def _require_annotation_store():
    if state._annotation_store is None:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    return state._annotation_store


def _require_knowledge_store():
    if state._knowledge_store is None:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return state._knowledge_store

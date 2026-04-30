"""auth API routes."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.api import state
from src.storage.models import CurrentUserRead, UserORM, UserSessionORM, UserRead, UserUpdate

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

router = APIRouter(tags=["auth"])

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=128)
    email: str = Field("", max_length=256)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=8, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class SessionRead(BaseModel):
    authenticated: bool
    user: Optional[CurrentUserRead] = None


class RegisterResult(BaseModel):
    user_id: str
    username: str
    approval_status: str
    message: str


class LoginResult(BaseModel):
    message: str
    user: CurrentUserRead


class AdminRejectUserRequest(BaseModel):
    reason: str = Field("", max_length=500)


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


class AdminCreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=128)
    email: str = Field("", max_length=256)
    role: str = Field("viewer")
    status: str = Field("active")
    approval_status: str = Field("approved")


@router.post("/api/auth/register", response_model=RegisterResult)
async def register_account(request: RegisterRequest):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    if not _allow_public_registration():
        raise HTTPException(status_code=403, detail="Public registration is disabled")

    username = request.username.strip()
    now = datetime.utcnow()
    approval_status = "pending" if _require_admin_approval() else "approved"
    async with state._storage.session_factory() as session:
        existing = await session.execute(
            select(UserORM).where(
                (UserORM.username == username) | (UserORM.user_id == f"local:{username}")
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already exists")

        if request.email.strip():
            email_existing = await session.execute(
                select(UserORM).where(UserORM.email == request.email.strip())
            )
            if email_existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already exists")

        user = UserORM(
            user_id=f"local:{username}",
            username=username,
            display_name=request.display_name.strip(),
            email=request.email.strip(),
            password_hash=_hash_password(request.password),
            password_algo="pbkdf2_sha256",
            approval_status=approval_status,
            approved_at=None if approval_status == "pending" else now,
            role="viewer",
            status="active",
            auth_source="local",
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        await session.commit()

    return RegisterResult(
        user_id=f"local:{username}",
        username=username,
        approval_status=approval_status,
        message="Registration submitted, waiting for admin approval" if approval_status == "pending" else "Registration successful",
    )


@router.post("/api/auth/login", response_model=LoginResult)
async def login_account(request: LoginRequest, response: Response, http_request: Request):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    username = request.username.strip()
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.username == username))
        user = result.scalar_one_or_none()
        if user is None or not user.password_hash or not _verify_password(request.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if _normalize_approval_status(user.approval_status) == "pending":
            raise HTTPException(status_code=403, detail="Account is pending approval")
        if _normalize_approval_status(user.approval_status) == "rejected":
            raise HTTPException(status_code=403, detail="Account registration was rejected")
        if user.status != "active":
            raise HTTPException(status_code=403, detail="Account is disabled")

        user.last_login_at = datetime.utcnow()
        user.last_seen_at = datetime.utcnow()
        user.auth_source = "local"
        await session.commit()
        await session.refresh(user)
        token = await _create_user_session(user, http_request)
        _set_session_cookie(response, token)
        return LoginResult(message="Login successful", user=_to_current_user_read(_serialize_user(user)))


@router.post("/api/auth/logout")
async def logout_account(response: Response, request: Request):
    await _revoke_session_by_token(request.cookies.get(_session_cookie_name(), "").strip())
    _clear_session_cookie(response)
    return {"status": "ok"}


@router.get("/api/auth/session", response_model=SessionRead)
async def auth_session(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    if not current_user:
        return SessionRead(authenticated=False, user=None)
    return SessionRead(authenticated=True, user=_to_current_user_read(current_user))


@router.post("/api/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == current_user.user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        if not user.password_hash or not _verify_password(request.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        user.password_hash = _hash_password(request.new_password)
        user.password_algo = "pbkdf2_sha256"
        user.updated_at = datetime.utcnow()
        await session.commit()
    return {"status": "ok"}


@router.get("/api/me", response_model=CurrentUserRead)
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    return _to_current_user_read(current_user)


@router.get("/api/admin/users", response_model=list[UserRead])
async def list_users(current_user: CurrentUser = Depends(require_roles("admin"))):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).order_by(UserORM.updated_at.desc(), UserORM.user_id.asc()))
        return [UserRead.model_validate(user) for user in result.scalars().all()]


@router.patch("/api/admin/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    request: UserUpdate,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")

        if request.display_name is not None:
            user.display_name = request.display_name.strip()
        if request.email is not None:
            user.email = request.email.strip()
        if request.role is not None:
            if user.role == "admin" and _normalize_role(request.role) != "admin":
                admin_count = (
                    await session.execute(
                        select(func.count()).select_from(UserORM).where(UserORM.role == "admin")
                    )
                ).scalar() or 0
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last admin")
            user.role = _normalize_role(request.role)
        if request.status is not None:
            user.status = request.status.strip() or user.status
        if request.approval_status is not None:
            user.approval_status = _normalize_approval_status(request.approval_status)
        if request.disabled_reason is not None:
            user.disabled_reason = request.disabled_reason
        user.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(user)
        return UserRead.model_validate(user)


@router.post("/api/admin/users", response_model=UserRead)
async def admin_create_user(
    request: AdminCreateUserRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    username = request.username.strip()
    now = datetime.utcnow()
    async with state._storage.session_factory() as session:
        existing = await session.execute(select(UserORM).where(UserORM.username == username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already exists")
        user = UserORM(
            user_id=f"local:{username}",
            username=username,
            display_name=request.display_name.strip(),
            email=request.email.strip(),
            password_hash=_hash_password(request.password),
            password_algo="pbkdf2_sha256",
            approval_status=_normalize_approval_status(request.approval_status),
            approved_by_user_id=current_user.user_id if _normalize_approval_status(request.approval_status) == "approved" else None,
            approved_at=now if _normalize_approval_status(request.approval_status) == "approved" else None,
            role=_normalize_role(request.role),
            status=request.status.strip() or "active",
            auth_source="local",
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return UserRead.model_validate(user)


@router.post("/api/admin/users/{user_id}/approve", response_model=UserRead)
async def approve_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        user.approval_status = "approved"
        user.approved_by_user_id = current_user.user_id
        user.approved_at = datetime.utcnow()
        user.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(user)
        return UserRead.model_validate(user)


@router.post("/api/admin/users/{user_id}/reject", response_model=UserRead)
async def reject_user(
    user_id: str,
    request: AdminRejectUserRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        user.approval_status = "rejected"
        user.disabled_reason = request.reason.strip()
        user.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(user)
        return UserRead.model_validate(user)


@router.post("/api/admin/users/{user_id}/reset-password", response_model=UserRead)
async def reset_user_password(
    user_id: str,
    request: AdminResetPasswordRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not state._storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with state._storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        user.password_hash = _hash_password(request.new_password)
        user.password_algo = "pbkdf2_sha256"
        user.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(user)
        return UserRead.model_validate(user)





"""FastAPI 服务层 — 提供搜索、问答、线程查询、翻译接口。"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal, Optional

import yaml
from fastapi import FastAPI, HTTPException, Query, Body, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from src.qa.ask_agent import AskAgent
from src.qa.ask_drafts import AskDraftService
from src.qa.manual_qa import ManualQA
from src.qa.providers import ChatLLMClient, DashScopeEmbeddingProvider, resolve_api_key
from src.retriever.base import SearchQuery
from src.retriever.hybrid import HybridRetriever
from src.retriever.keyword import KeywordRetriever
from src.retriever.manual import ManualRetriever, ManualSearchQuery
from src.retriever.semantic import SemanticRetriever
from src.storage.document_store import DocumentStorage
from src.storage.models import (
    AgentResearchRunCreate,
    AgentResearchRunRead,
    AgentResearchRunUpdate,
    AgentRunActionCreate,
    AgentRunActionRead,
    AnnotationCreate,
    AnnotationORM,
    AnnotationRead,
    AnnotationUpdate,
    CurrentUserRead,
    EmailORM,
    EmailRead,
    KnowledgeEntityCreate,
    KnowledgeEntityRead,
    KnowledgeEntityUpdate,
    KnowledgeDraftCreate,
    KnowledgeDraftRead,
    KnowledgeDraftUpdate,
    KnowledgeEvidenceCreate,
    KnowledgeEvidenceRead,
    KnowledgeEvidenceUpdate,
    KnowledgeRelationCreate,
    KnowledgeRelationRead,
    KnowledgeRelationUpdate,
    TagAssignmentCreate,
    TagAssignmentORM,
    TagAssignmentRead,
    TagBundle,
    TagAliasORM,
    TagCreate,
    TagORM,
    TagRead,
    TagTree,
    UserORM,
    UserRead,
    UserSessionORM,
    UserUpdate,
)
from src.agent.research_service import AgentResearchService
from src.storage.agent_store import AgentStore
from src.storage.ask_store import AskStore
from src.storage.knowledge_store import KnowledgeStore
from src.storage.postgres import PostgresStorage

from src.storage.tag_store import (
    TARGET_TYPE_ANNOTATION,
    TARGET_TYPE_EMAIL_MESSAGE,
    TARGET_TYPE_EMAIL_THREAD,
    TARGET_TYPE_KERNEL_LINE_RANGE,
    TagStore,
)
from src.storage.translation_cache import TranslationCacheStore
from src.storage.annotation_store import AnnotationStore
from src.kernel_source.base import BaseKernelSource
from src.kernel_source.git_local import GitLocalSource
from src.kernel_source.elixir import ElixirSource
from src.kernel_source.fallback import FallbackKernelSource
from src.translator.base import TranslationError
from src.translator.google_translator import GoogleTranslator, is_available as is_translator_available

logger = logging.getLogger(__name__)

# ============================================================
# 全局组件（在 lifespan 中初始化）
# ============================================================
_storage: Optional[PostgresStorage] = None
_retriever: Optional[HybridRetriever] = None
_llm_client: Optional[ChatLLMClient] = None
_qa: Optional[AskAgent] = None
_tag_store: Optional[TagStore] = None

# 芯片手册相关组件
_manual_storage: Optional[DocumentStorage] = None
_manual_retriever: Optional[ManualRetriever] = None
_manual_qa: Optional[ManualQA] = None

# 翻译组件
_translator: Optional[GoogleTranslator] = None
_translation_cache: Optional[TranslationCacheStore] = None
_translation_jobs: dict[str, dict] = {}
_translation_jobs_by_thread: dict[str, str] = {}

# 批注组件
_annotation_store: Optional[AnnotationStore] = None

# 内核源码浏览组件
_kernel_source: Optional[BaseKernelSource] = None

_knowledge_store: Optional[KnowledgeStore] = None

# Ask 对话历史组件
_ask_store: Optional["AskStore"] = None

# AI agent research components
_agent_store: Optional[AgentStore] = None
_agent_user: Optional["CurrentUser"] = None
_agent_service: Optional[AgentResearchService] = None

# 认证配置
_auth_config: dict = {}

# 全量应用配置（用于读取 email_collector 等非 auth 配置）
_app_config: dict = {}

VALID_ROLES = {"admin", "editor", "viewer", "agent"}
VALID_VISIBILITY = {"public", "private"}
VALID_APPROVAL_STATUS = {"pending", "approved", "rejected"}
VALID_PUBLISH_STATUS = {"none", "pending", "approved", "rejected"}



def _load_config() -> dict:
    """加载配置文件。"""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


class CurrentUser(BaseModel):
    user_id: str
    username: str
    display_name: str
    email: str
    approval_status: str
    role: str
    status: str
    auth_source: str


def _normalize_role(role: str) -> str:
    role_value = (role or "viewer").strip().lower()
    return role_value if role_value in VALID_ROLES else "viewer"


def _normalize_visibility(value: str) -> str:
    visibility = (value or "public").strip().lower()
    return visibility if visibility in VALID_VISIBILITY else "public"


def _normalize_approval_status(value: str) -> str:
    status = (value or "pending").strip().lower()
    return status if status in VALID_APPROVAL_STATUS else "pending"


def _normalize_publish_status(value: str) -> str:
    status = (value or "none").strip().lower()
    return status if status in VALID_PUBLISH_STATUS else "none"


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


def _header_name(name: str, default: str) -> str:
    return str(_auth_config.get("headers", {}).get(name, default))


def _local_auth_config() -> dict:
    return _auth_config.get("local", {}) or {}


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
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations_raw),
        )
        return secrets.compare_digest(actual, expected)
    except Exception:
        return False


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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
    fallback = _auth_config.get("dev_fallback_user", {}) or {}
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


async def _sync_user_record(current_user: CurrentUser) -> CurrentUser:
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    allow_auto_provision = _auth_config.get("allow_auto_provision", True)
    now = datetime.utcnow()
    async with _storage.session_factory() as session:
        result = await session.execute(
            select(UserORM).where(UserORM.user_id == current_user.user_id)
        )
        user = result.scalar_one_or_none()

        if user is None:
            if not allow_auto_provision:
                raise HTTPException(status_code=401, detail="User provisioning disabled")
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
    if not _storage:
        return
    bootstrap = _local_auth_config().get("bootstrap_admin", {}) or {}
    username = str(bootstrap.get("username", "")).strip()
    password = str(os.environ.get("KERNEL_ADMIN_PASSWORD") or bootstrap.get("password", "")).strip()
    if not username or not password:
        return

    async with _storage.session_factory() as session:
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
    if not _storage:
        return None
    agent_cfg = (_app_config.get("agent", {}) or {}).get("default_agent", {}) or {}
    username = str(agent_cfg.get("username", "lobster-agent")).strip() or "lobster-agent"
    display_name = str(agent_cfg.get("display_name", "Lobster Research Agent")).strip() or "Lobster Research Agent"
    email = str(agent_cfg.get("email", "")).strip()
    user_id = f"agent:{username}"
    now = datetime.utcnow()

    async with _storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            user = UserORM(
                user_id=user_id,
                username=username,
                display_name=display_name,
                email=email,
                approval_status="approved",
                approved_by_user_id=user_id,
                approved_at=now,
                role="agent",
                status="active",
                auth_source="system_agent",
                last_seen_at=now,
                created_at=now,
                updated_at=now,
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
    if not _storage or not _local_auth_config().get("enabled", True):
        return None

    token = request.cookies.get(_session_cookie_name(), "").strip()
    if not token:
        return None

    token_hash = _hash_session_token(token)
    async with _storage.session_factory() as session:
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
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    raw_token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    async with _storage.session_factory() as session:
        session_row = UserSessionORM(
            session_id=secrets.token_hex(16),
            user_id=user.user_id,
            session_token_hash=_hash_session_token(raw_token),
            created_at=now,
            expires_at=now + timedelta(hours=_session_ttl_hours()),
            ip=request.client.host if request.client else "",
            user_agent=request.headers.get("user-agent", "")[:1000],
        )
        session.add(session_row)
        await session.commit()
    return raw_token


def _set_session_cookie(response: Response, token: str) -> None:
    secure = bool(_local_auth_config().get("cookie_secure", False))
    response.set_cookie(
        key=_session_cookie_name(),
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=_session_ttl_hours() * 3600,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=_session_cookie_name(), path="/")


async def _revoke_session_by_token(token: str) -> None:
    if not token or not _storage:
        return
    async with _storage.session_factory() as session:
        result = await session.execute(
            select(UserSessionORM).where(UserSessionORM.session_token_hash == _hash_session_token(token))
        )
        session_row = result.scalar_one_or_none()
        if session_row and session_row.revoked_at is None:
            session_row.revoked_at = datetime.utcnow()
            await session.commit()


async def _resolve_current_user(request: Request, required: bool = True) -> Optional[CurrentUser]:
    session_user = await _resolve_user_from_session(request)
    if session_user is not None:
        return session_user

    if _allow_header_auth_fallback():
        user_id = request.headers.get(_header_name("user_id", "X-User-Id"), "").strip()
        username = request.headers.get(_header_name("username", "X-Username"), "").strip()
        display_name = request.headers.get(_header_name("display_name", "X-Display-Name"), "").strip()
        email = request.headers.get(_header_name("email", "X-User-Email"), "").strip()
        role = request.headers.get(_header_name("role", "X-User-Role"), "").strip()

        if user_id:
            current_user = CurrentUser(
                user_id=user_id,
                username=username or user_id,
                display_name=display_name or username or user_id,
                email=email,
                approval_status="approved",
                role=role.strip().lower(),
                status="active",
                auth_source="header",
            )
            return await _sync_user_record(current_user)

    fallback = _fallback_user()
    if fallback is None:
        if required:
            raise HTTPException(status_code=401, detail="Authentication required")
        return None
    return await _sync_user_record(fallback)


async def get_current_user(request: Request) -> CurrentUser:
    user = await _resolve_current_user(request, required=True)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def get_optional_current_user(request: Request) -> Optional[CurrentUser]:
    return await _resolve_current_user(request, required=False)


def require_roles(*roles: str):
    async def dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Permission denied")
        return current_user

    return dependency


def _is_admin(current_user: CurrentUser) -> bool:
    return current_user.role == "admin"


def _ensure_public_write_allowed(visibility: str, current_user: CurrentUser) -> None:
    if _normalize_visibility(visibility) == "public" and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admin can modify public content")


async def _ensure_tag_manage_access(tag_id: int, current_user: CurrentUser) -> TagORM:
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    tag = await _tag_store.get_tag(tag_id)
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
    *,
    tag_id: Optional[int] = None,
    tag_slug: str = "",
    tag_name: str = "",
) -> Optional[TagORM]:
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
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
    *,
    current_user: CurrentUser,
    tag_id: Optional[int] = None,
    tag_slug: str = "",
    tag_name: str = "",
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
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
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
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _annotation_store.get(annotation_id)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动时初始化组件，关闭时释放资源。"""
    global _storage, _retriever, _llm_client, _qa, _tag_store
    global _manual_storage, _manual_retriever, _manual_qa
    global _translator, _translation_cache
    global _annotation_store
    global _kernel_source, _knowledge_store, _ask_store, _agent_store, _agent_user
    global _auth_config, _app_config

    config = _load_config()
    storage_cfg = config.get("storage", {})
    retriever_cfg = config.get("retriever", {})
    qa_cfg = config.get("qa", {})
    indexer_cfg = config.get("indexer", {})
    _auth_config = config.get("auth", {})
    _app_config = config

    # ========== 邮件存储初始化 ==========
    email_storage_cfg = storage_cfg.get("email", {})
    email_database_url = email_storage_cfg.get("database_url")
    if not email_database_url:
        raise RuntimeError("storage.email.database_url not configured in settings.yaml")

    _storage = PostgresStorage(
        database_url=email_database_url,
        pool_size=email_storage_cfg.get("pool_size", 5),
    )
    await _storage.init_db()
    await _maybe_bootstrap_admin()
    _agent_user = await _maybe_bootstrap_agent()
    _agent_store = AgentStore(_storage.session_factory)
    recovered_runs = await _agent_store.fail_running_runs_after_restart()
    if recovered_runs:
        logger.warning("Marked %d stale AI agent run(s) failed after restart", recovered_runs)

    # 初始化标签存储
    _tag_store = TagStore(
        session_factory=_storage.session_factory,
        default_actor=config.get("annotations", {}).get("default_author", "me"),
    )

    # 初始化 LLM 客户端（用于 AI 概括和草稿生成）
    email_qa_cfg = qa_cfg.get("email", qa_cfg)
    _llm_client = ChatLLMClient(
        provider=email_qa_cfg.get("llm_provider", "dashscope"),
        model=email_qa_cfg.get("model", "qwen-plus"),
        api_key=email_qa_cfg.get("api_key", ""),
    )
    vector_cfg = indexer_cfg.get("vector", {})
    embedding_provider = None
    if vector_cfg.get("enabled", False):
        embedding_provider_name = vector_cfg.get("provider", "dashscope")
        if embedding_provider_name == "local":
            from src.qa.providers import LocalEmbeddingProvider

            embedding_provider = LocalEmbeddingProvider(
                model=vector_cfg.get("model", "BAAI/bge-m3"),
                dimension=vector_cfg.get("dimension", 1024),
            )
            logger.info("Using local embedding model for vector retrieval")
        elif embedding_provider_name == "dashscope":
            embedding_api_key = resolve_api_key(
                "dashscope",
                vector_cfg.get("api_key", "") or email_qa_cfg.get("api_key", ""),
            )
            if embedding_api_key:
                embedding_provider = DashScopeEmbeddingProvider(
                    api_key=embedding_api_key,
                    model=vector_cfg.get("model", "text-embedding-v3"),
                    dimension=vector_cfg.get("dimension", 1024),
                )
            else:
                logger.warning("Vector retrieval enabled but DashScope API key is missing")
        else:
            logger.warning("Unsupported embedding provider for Ask vector retrieval: %s", embedding_provider_name)

    # 初始化检索层
    keyword_retriever = KeywordRetriever(storage=_storage)
    semantic_retriever = SemanticRetriever(
        database_url=email_database_url,
        model=vector_cfg.get("model", "text-embedding-3-small"),
        enabled=vector_cfg.get("enabled", False),
        storage=_storage,
        embedding_provider=embedding_provider,
        embedding_provider_name=vector_cfg.get("provider", "dashscope"),
    )
    _retriever = HybridRetriever(
        keyword_retriever=keyword_retriever,
        semantic_retriever=semantic_retriever,
    )

    _qa = AskAgent(
        storage=_storage,
        retriever=_retriever,
        llm=_llm_client,
        embedding_provider=embedding_provider,
        embedding_provider_name=vector_cfg.get("provider", "dashscope"),
    )
    logger.info("Mail Ask agent initialized")

    # ========== 翻译组件初始化 ==========
    translator_cfg = config.get("translator", {})
    if is_translator_available():
        # 加载代理配置
        proxy_cfg = translator_cfg.get("proxy", {})
        proxy_enabled = proxy_cfg.get("enabled", False)
        proxy_http = proxy_cfg.get("http", "") if proxy_enabled else ""
        proxy_https = proxy_cfg.get("https", "") if proxy_enabled else ""
        
        _translator = GoogleTranslator(
            timeout=translator_cfg.get("google", {}).get("timeout", 10),
            proxy_http=proxy_http,
            proxy_https=proxy_https,
        )
        # 初始化翻译缓存（传入 session_factory，每次操作创建新 session）
        _translation_cache = TranslationCacheStore(
            session_factory=_storage.session_factory
        )
        logger.info(f"Translation service initialized (proxy: {proxy_enabled})")
    else:
        logger.warning("Translation service not available")

    # ========== 批注组件初始化 ==========
    annotations_cfg = config.get("annotations", {})
    _annotation_store = AnnotationStore(
        session_factory=_storage.session_factory,
        default_author=annotations_cfg.get("default_author", "me"),
    )
    logger.info("Annotation store initialized")


    logger.info("Kernel symbol store initialized")

    _knowledge_store = KnowledgeStore(_storage.session_factory)
    _qa.knowledge_store = _knowledge_store
    _ask_store = AskStore(_storage.session_factory)
    _agent_service = AgentResearchService(
        agent_store=_agent_store,
        knowledge_store=_knowledge_store,
        retriever=_retriever,
        llm_client=_llm_client,
        qa=_qa,
        agent_user_id=_agent_user.user_id if _agent_user else "agent:lobster-agent",
        agent_name=_agent_user.display_name if _agent_user else "Lobster Research Agent",
    )
    logger.info("Knowledge store initialized")

    # ========== 芯片手册存储初始化 ==========
    manual_storage_cfg = storage_cfg.get("manual", {})
    manual_database_url = manual_storage_cfg.get("database_url")
    if manual_database_url:
        _manual_storage = DocumentStorage(
            database_url=manual_database_url,
            pool_size=manual_storage_cfg.get("pool_size", 5),
        )
        await _manual_storage.init_db()

        # 初始化手册检索层
        _manual_retriever = ManualRetriever(storage=_manual_storage)

        # 初始化手册问答层
        manual_qa_cfg = qa_cfg.get("manual", qa_cfg)
        _manual_qa = ManualQA(
            retriever=_manual_retriever,
            llm_provider=manual_qa_cfg.get("llm_provider", "openai"),
            model=manual_qa_cfg.get("model", "gpt-4"),
            api_key=manual_qa_cfg.get("api_key", ""),
        )
        logger.info("Manual storage initialized successfully")
    else:
        logger.warning("Manual storage not configured, chip manual features disabled")

    # ========== 内核源码浏览初始化 ==========
    kernel_cfg = config.get("kernel_source", {})
    kernel_repo_path = kernel_cfg.get("repo_path", "")
    if kernel_repo_path:
        import os
        expanded = os.path.expanduser(kernel_repo_path)
        if os.path.isdir(expanded):
            cache_cfg = kernel_cfg.get("cache", {})
            _git_source = GitLocalSource(
                repo_path=kernel_repo_path,
                max_file_size=kernel_cfg.get("max_file_size", 1_048_576),
                tree_cache_size=cache_cfg.get("tree_cache_size", 256),
                file_cache_size=cache_cfg.get("file_cache_size", 128),
            )
            # 用 elixir.bootlin.com 作为回退：当本地 git 缺少 tag 时（如 3.15.8），
            # 自动从 elixir 抓取源码
            _kernel_source = FallbackKernelSource(
                primary=_git_source,
                fallback=ElixirSource(),
            )
            logger.info(f"Kernel source initialized: {expanded}")
        else:
            logger.warning(f"Kernel source repo not found: {expanded}, kernel code browsing disabled")
    else:
        logger.warning("kernel_source.repo_path not configured, kernel code browsing disabled")

    logger.info("API server initialized successfully")

    logger.info("API server initialized successfully")
    yield

    # 关闭资源
    if _storage:
        await _storage.close()
    if _manual_storage:
        await _manual_storage.close()
    logger.info("API server shutdown complete")


app = FastAPI(
    title="Kernel Email Knowledge Base",
    description="Linux kernel mailing list knowledge base with dual-engine retrieval",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: allow frontend dev server and production
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # 允许所有来源（开发/生产环境）
    allow_credentials=False,  # 移除 credentials 以避免与 wildcard origins 冲突
    allow_methods=['*'],
    allow_headers=['*'],
)
# Serve static frontend files if available
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
import os
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'web', 'dist')
if os.path.isdir(static_dir):
    # SPA fallback: serve index.html for all non-file paths under /app
    @app.get('/app/{path:path}')
    async def serve_spa(path: str):
        file_path = os.path.join(static_dir, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, 'index.html'))
    app.mount('/app/assets', StaticFiles(directory=os.path.join(static_dir, 'assets')), name='assets')


# ============================================================
# Pydantic 请求/响应模型
# ============================================================

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


class SearchResponse(BaseModel):
    """搜索响应。"""
    query: str
    mode: str
    total: int
    page: int
    page_size: int
    hits: list[dict]


class SummarizeRequest(BaseModel):
    """AI 概括请求."""
    query: str = Field("", description="原始搜索关键词")
    hits: list[dict] = Field(default_factory=list, description="搜索结果列表")


class SummarizeResponse(BaseModel):
    """AI 概括响应."""
    answer: str
    sources: list[dict] = Field(default_factory=list)
    model: str = ""


class AskResponse(BaseModel):
    """邮件 Ask 响应。"""
    question: str
    answer: str
    sources: list[dict] = Field(default_factory=list)
    model: str = ""
    retrieval_mode: str = "agentic_rag"
    search_plan: dict = Field(default_factory=dict)
    executed_queries: list[dict] = Field(default_factory=list)
    threads: list[dict] = Field(default_factory=list)
    retrieval_stats: dict = Field(default_factory=dict)


class AskMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    history: list[AskMessage] = Field(default_factory=list, max_length=12)
    list_name: Optional[str] = None
    sender: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    tags: list[str] = Field(default_factory=list)


class DraftRequest(BaseModel):
    """生成草稿请求."""
    query: str = Field("", description="原始搜索关键词")
    summary: str = Field("", description="AI 概括文本")
    sources: list[dict] = Field(default_factory=list)


class DraftResponse(BaseModel):
    draft_id: str = ""
    knowledge_drafts: list[dict] = Field(default_factory=list)
    annotation_drafts: list[dict] = Field(default_factory=list)
    tag_assignment_drafts: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DraftApplyRequest(BaseModel):
    knowledge_drafts: list[dict] = Field(default_factory=list)
    annotation_drafts: list[dict] = Field(default_factory=list)
    tag_assignment_drafts: list[dict] = Field(default_factory=list)


class DraftApplyResponse(BaseModel):
    created_entities: list[dict] = Field(default_factory=list)
    created_annotations: list[dict] = Field(default_factory=list)
    created_tag_assignments: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


class KnowledgeRelationCreateRequest(BaseModel):
    source_entity_id: str = Field(..., min_length=1, max_length=160)
    target_entity_id: str = Field(..., min_length=1, max_length=160)
    relation_type: str = Field(..., min_length=1, max_length=64)
    description: str = Field("", max_length=4000)
    evidence_id: str = Field("", max_length=160)
    meta: dict = Field(default_factory=dict)


class KnowledgeRelationUpdateRequest(BaseModel):
    relation_type: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=4000)
    evidence_id: Optional[str] = Field(None, max_length=160)
    meta: Optional[dict] = None


class KnowledgeRelationListResponse(BaseModel):
    outgoing: list[KnowledgeRelationRead] = Field(default_factory=list)
    incoming: list[KnowledgeRelationRead] = Field(default_factory=list)


class KnowledgeEvidenceCreateRequest(BaseModel):
    source_type: str = Field("email", max_length=64)
    message_id: str = Field("", max_length=512)
    thread_id: str = Field("", max_length=512)
    claim: str = Field("", max_length=4000)
    quote: str = Field("", max_length=12000)
    confidence: str = Field("", max_length=32)
    meta: dict = Field(default_factory=dict)


class KnowledgeEvidenceUpdateRequest(BaseModel):
    source_type: Optional[str] = Field(None, max_length=64)
    message_id: Optional[str] = Field(None, max_length=512)
    thread_id: Optional[str] = Field(None, max_length=512)
    claim: Optional[str] = Field(None, max_length=4000)
    quote: Optional[str] = Field(None, max_length=12000)
    confidence: Optional[str] = Field(None, max_length=32)
    meta: Optional[dict] = None


class KnowledgeDraftListResponse(BaseModel):
    drafts: list[KnowledgeDraftRead] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class AgentResearchBudget(BaseModel):
    max_iterations: int = Field(1, ge=1, le=10)
    max_searches: int = Field(3, ge=1, le=50)
    max_threads: int = Field(6, ge=1, le=30)


class AgentResearchRunCreateRequest(BaseModel):
    topic: str = Field(..., min_length=3, max_length=4000)
    list_name: str = Field("", max_length=128)
    sender: str = Field("", max_length=512)
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    has_patch: Optional[bool] = None
    budget: AgentResearchBudget = Field(default_factory=AgentResearchBudget)


class AgentResearchRunListResponse(BaseModel):
    runs: list[AgentResearchRunRead] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class AgentResearchRunDetailResponse(BaseModel):
    run: AgentResearchRunRead
    actions: list[AgentRunActionRead] = Field(default_factory=list)


class KnowledgeDraftCreateRequest(BaseModel):
    source_type: str = Field("manual", max_length=64)
    source_ref: str = Field("", max_length=512)
    question: str = ""
    payload: dict = Field(default_factory=dict)
    status: str = Field("new", max_length=32)
    review_note: str = ""


class KnowledgeDraftUpdateRequest(BaseModel):
    payload: Optional[dict] = None
    status: Optional[str] = Field(None, max_length=32)
    review_note: Optional[str] = None



class KnowledgeEntityMergeRequest(BaseModel):
    source_entity_id: str = Field(..., min_length=1, max_length=160)
    target_entity_id: str = Field(..., min_length=1, max_length=160)


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


class ManualSearchResponse(BaseModel):
    """手册搜索响应。"""
    query: str
    mode: str
    total: int
    hits: list[dict]


class ManualAskResponse(BaseModel):
    """手册问答响应。"""
    question: str
    answer: str
    sources: list[dict]
    model: str
    retrieval_mode: str


class ManualStatsResponse(BaseModel):
    """手册统计信息响应。"""
    total_chunks: int
    by_manual_type: dict
    by_content_type: dict


class TranslateRequest(BaseModel):
    """翻译请求。"""
    text: str = Field(..., min_length=1, description="待翻译的原文")
    source_lang: str = Field("auto", description="源语言（默认 auto 自动检测）")
    target_lang: str = Field("zh-CN", description="目标语言（默认 zh-CN 中文）")


class TranslateResponse(BaseModel):
    """翻译响应。"""
    translation: str
    cached: bool = False


class TranslateBatchRequest(BaseModel):
    """批量翻译请求。"""
    texts: list[str] = Field(..., min_length=1, max_length=50, description="待翻译的原文列表（最多 50 条）")
    source_lang: str = Field("auto", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")
    message_id: Optional[str] = Field(None, description="关联的邮件 Message-ID（可选，用于翻译缓存关联邮件标签）")


class TranslateBatchResponse(BaseModel):
    """批量翻译响应。"""
    translations: list[str]
    cached_count: int = 0


class ThreadTranslateRequest(BaseModel):
    """线程翻译任务请求。"""
    thread_id: str = Field(..., min_length=1, description="线程 ID")
    source_lang: str = Field("auto", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")


class TranslationJobItem(BaseModel):
    """线程翻译任务中的单条结果。"""
    source_text: str
    translated_text: str = ""
    message_id: str = ""
    cached: bool = False
    error: str = ""


class TranslationJobResponse(BaseModel):
    """线程翻译任务状态。"""
    job_id: str
    thread_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    email_count: int = 0
    status: str
    total: int = 0
    completed: int = 0
    cached_count: int = 0
    failed_count: int = 0
    progress_percent: float = 0.0
    items: list[TranslationJobItem] = Field(default_factory=list)
    error: str = ""
    created_at: str
    updated_at: str


class TranslationJobListResponse(BaseModel):
    """运行中的线程翻译任务列表。"""
    jobs: list[TranslationJobResponse]
    total: int


def _translation_job_to_response(job: dict) -> TranslationJobResponse:
    total = int(job.get("total", 0) or 0)
    completed = int(job.get("completed", 0) or 0)
    progress = round((completed / total) * 100, 1) if total > 0 else 0.0
    items = [
        TranslationJobItem(
            source_text=item.get("source_text", ""),
            translated_text=item.get("translated_text", ""),
            message_id=item.get("message_id", ""),
            cached=bool(item.get("cached", False)),
            error=item.get("error", ""),
        )
        for item in job.get("items", [])
    ]
    return TranslationJobResponse(
        job_id=job["job_id"],
        thread_id=job["thread_id"],
        subject=job.get("subject", ""),
        sender=job.get("sender", ""),
        date=job.get("date"),
        email_count=int(job.get("email_count", 0) or 0),
        status=job["status"],
        total=total,
        completed=completed,
        cached_count=int(job.get("cached_count", 0) or 0),
        failed_count=int(job.get("failed_count", 0) or 0),
        progress_percent=progress,
        items=items,
        error=job.get("error", ""),
        created_at=job["created_at"],
        updated_at=job["updated_at"],
    )


def _touch_translation_job(job_id: str, **updates) -> None:
    job = _translation_jobs.get(job_id)
    if not job:
        return
    job.update(updates)
    job["updated_at"] = datetime.utcnow().isoformat()


def _strip_diff_and_signature(body_raw: str) -> str:
    if not body_raw:
        return ""
    lines = body_raw.split("\n")
    result: list[str] = []
    in_diff = False

    for i, line in enumerate(lines):
        trimmed = line.strip()
        if trimmed in {"--", "-- "} and not in_diff:
            break

        if (
            trimmed.startswith("diff --git ")
            or trimmed.startswith("diff --cc ")
            or (
                trimmed.startswith("--- a/")
                and i + 1 < len(lines)
                and lines[i + 1].strip().startswith("+++ b/")
            )
        ):
            in_diff = True

        if (
            not in_diff
            and re.match(r"^---\s+\S", trimmed)
            and i + 1 < len(lines)
            and re.match(r"^\+\+\+\s+\S", lines[i + 1].strip())
        ):
            in_diff = True

        if in_diff:
            continue

        result.append(line)

    return "\n".join(result)


def _is_quoted_line(line: str) -> bool:
    return bool(re.match(r"^\s*>", line))


def _parse_paragraphs_for_translation(body: str) -> list[tuple[str, str]]:
    if not body:
        return []

    raw_paragraphs = [p for p in re.split(r"\n\n+", body) if p.strip()]
    blocks: list[tuple[str, str]] = []

    for para in raw_paragraphs:
        lines = para.split("\n")
        all_quoted = all(_is_quoted_line(line) or not line.strip() for line in lines)
        if all_quoted and any(line.strip() for line in lines):
            blocks.append((para, "quoted"))
            continue

        any_quoted = any(_is_quoted_line(line) for line in lines)
        if not any_quoted:
            blocks.append((para, "normal"))
            continue

        current_lines: list[str] = []
        current_type = "normal"

        def flush_current() -> None:
            text = "\n".join(current_lines)
            if text.strip():
                blocks.append((text, current_type))

        for line in lines:
            line_type = "quoted" if _is_quoted_line(line) else "normal"
            if line_type != current_type and current_lines:
                flush_current()
                current_lines = []
            current_type = line_type
            current_lines.append(line)

        if current_lines:
            flush_current()

    return blocks


def _should_translate_paragraph(block_type: str, text: str) -> bool:
    if block_type == "quoted":
        return False
    if not text or re.search(r"[\u4e00-\u9fff]", text):
        return False

    lines = text.split("\n")
    non_empty_lines = [line for line in lines if line.strip()]
    if not non_empty_lines:
        return False

    skip_lines = [
        line for line in non_empty_lines
        if line.strip().startswith((
            "Signed-off-by:",
            "Reviewed-by:",
            "Acked-by:",
            "Tested-by:",
            "Cc:",
            "Link:",
        ))
    ]
    return len(skip_lines) < len(non_empty_lines) * 0.8


def _get_email_display_body(email: EmailRead) -> str:
    if email.body_raw:
        return _strip_diff_and_signature(email.body_raw)
    return email.body or ""


def _extract_thread_translation_inputs(emails: list[EmailRead]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    items: list[tuple[str, str]] = []
    for email in emails:
        for text, block_type in _parse_paragraphs_for_translation(_get_email_display_body(email)):
            if not _should_translate_paragraph(block_type, text):
                continue
            normalized = text.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            items.append((email.message_id, normalized))
    return items


async def _run_thread_translation_job(job_id: str) -> None:
    job = _translation_jobs.get(job_id)
    if not job:
        return

    if not _storage or not _translator:
        _touch_translation_job(job_id, status="failed", error="Translation service not initialized")
        return

    thread_id = job["thread_id"]
    source_lang = job["source_lang"]
    target_lang = job["target_lang"]

    try:
        _touch_translation_job(job_id, status="running")
        emails = await _storage.get_thread(thread_id)
        if not emails:
            raise ValueError(f"Thread not found: {thread_id}")

        first_email = emails[0]
        _touch_translation_job(
            job_id,
            subject=first_email.subject or "",
            sender=first_email.sender or "",
            date=first_email.date.isoformat() if first_email.date else None,
            email_count=len(emails),
        )

        inputs = _extract_thread_translation_inputs(emails)
        _touch_translation_job(job_id, total=len(inputs))
        if not inputs:
            _touch_translation_job(job_id, status="completed")
            return

        items: list[dict] = []
        completed = 0
        cached_count = 0
        failed_count = 0

        for message_id, text in inputs:
            item = {
                "source_text": text,
                "translated_text": "",
                "message_id": message_id,
                "cached": False,
                "error": "",
            }

            cached_translation = None
            if _translation_cache:
                cached_translation = await _translation_cache.get(text, source_lang, target_lang)

            if cached_translation is not None:
                item["translated_text"] = cached_translation
                item["cached"] = True
                cached_count += 1
            else:
                try:
                    translation = await _translator.translate(text, source_lang, target_lang)
                    item["translated_text"] = translation
                    if _translation_cache:
                        await _translation_cache.set(
                            text,
                            translation,
                            source_lang,
                            target_lang,
                            message_id=message_id,
                        )
                except TranslationError as exc:
                    failed_count += 1
                    item["translated_text"] = text
                    item["error"] = str(exc)

            items.append(item)
            completed += 1
            _touch_translation_job(
                job_id,
                items=items,
                completed=completed,
                cached_count=cached_count,
                failed_count=failed_count,
            )

        final_status = "completed" if failed_count == 0 else "completed_with_errors"
        _touch_translation_job(job_id, status=final_status)
    except Exception as exc:
        logger.error("Failed to run thread translation job %s: %s", job_id, exc)
        _touch_translation_job(job_id, status="failed", error=str(exc))
    finally:
        if _translation_jobs_by_thread.get(thread_id) == job_id:
            if _translation_jobs.get(job_id, {}).get("status") in {"completed", "completed_with_errors", "failed"}:
                _translation_jobs_by_thread.pop(thread_id, None)


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
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with _storage.session_factory() as session:
        result = await session.execute(select(UserORM).where(UserORM.user_id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail=f"User not found: {user_id}")
        return user


@app.post("/api/auth/register", response_model=RegisterResult)
async def register_account(request: RegisterRequest):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    if not _allow_public_registration():
        raise HTTPException(status_code=403, detail="Public registration is disabled")

    username = request.username.strip()
    now = datetime.utcnow()
    approval_status = "pending" if _require_admin_approval() else "approved"
    async with _storage.session_factory() as session:
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


@app.post("/api/auth/login", response_model=LoginResult)
async def login_account(request: LoginRequest, response: Response, http_request: Request):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    username = request.username.strip()
    async with _storage.session_factory() as session:
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


@app.post("/api/auth/logout")
async def logout_account(response: Response, request: Request):
    await _revoke_session_by_token(request.cookies.get(_session_cookie_name(), "").strip())
    _clear_session_cookie(response)
    return {"status": "ok"}


@app.get("/api/auth/session", response_model=SessionRead)
async def auth_session(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    if not current_user:
        return SessionRead(authenticated=False, user=None)
    return SessionRead(authenticated=True, user=_to_current_user_read(current_user))


@app.post("/api/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
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


@app.get("/api/me", response_model=CurrentUserRead)
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    return _to_current_user_read(current_user)


@app.get("/api/admin/users", response_model=list[UserRead])
async def list_users(current_user: CurrentUser = Depends(require_roles("admin"))):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
        result = await session.execute(select(UserORM).order_by(UserORM.updated_at.desc(), UserORM.user_id.asc()))
        return [UserRead.model_validate(user) for user in result.scalars().all()]


@app.patch("/api/admin/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    request: UserUpdate,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
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


@app.post("/api/admin/users", response_model=UserRead)
async def admin_create_user(
    request: AdminCreateUserRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    username = request.username.strip()
    now = datetime.utcnow()
    async with _storage.session_factory() as session:
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


@app.post("/api/admin/users/{user_id}/approve", response_model=UserRead)
async def approve_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with _storage.session_factory() as session:
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


@app.post("/api/admin/users/{user_id}/reject", response_model=UserRead)
async def reject_user(
    user_id: str,
    request: AdminRejectUserRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with _storage.session_factory() as session:
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


@app.post("/api/admin/users/{user_id}/reset-password", response_model=UserRead)
async def reset_user_password(
    user_id: str,
    request: AdminResetPasswordRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")
    async with _storage.session_factory() as session:
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




# ============================================================
# 标签管理 API 路由
# ============================================================

@app.post("/api/tags", response_model=TagRead)
async def create_tag(
    request: TagCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建标签。

    支持父子层级，子标签通过 parent_id 指定父标签。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    visibility = _normalize_visibility(request.visibility)
    _ensure_public_write_allowed(visibility, current_user)

    try:
        tag = await _tag_store.create_tag(
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
        return _tag_store._to_tag_read(tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/tags", response_model=list[TagTree])
async def get_tags(
    flat: bool = Query(False, description="是否返回平铺列表"),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取标签树形结构。

    返回所有标签，按父子关系组织成树形结构。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    return await _tag_store.list_tags(
        flat=flat,
        viewer_user_id=current_user.user_id if current_user else None,
    )


@app.patch("/api/tags/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: int,
    request: TagUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    tag_obj = await _ensure_tag_manage_access(tag_id, current_user)
    if request.visibility is not None:
        _ensure_public_write_allowed(request.visibility, current_user)
    elif tag_obj.visibility == "public" and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admin can modify public tags")

    try:
        tag = await _tag_store.update_tag(
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
    return _tag_store._to_tag_read(tag)


@app.get("/api/tags/stats", response_model=list[dict])
async def get_tag_stats(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    """获取标签统计信息。

    返回所有标签及其被使用的邮件数量。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    return await _tag_store.get_tag_stats(
        viewer_user_id=current_user.user_id if current_user else None
    )


@app.get("/api/channels")
async def get_channels():
    """获取可用的邮件 channel 列表（来自配置文件 email_collector.local_channels）。"""
    channels_config = _app_config.get("email_collector", {}).get("local_channels", [])
    if not channels_config:
        # 从数据库获取 distinct list_name 作为降级方案
        if _storage:
            async with _storage.session_factory() as session:
                result = await session.execute(
                    select(EmailORM.list_name).distinct()
                )
                names = [row[0] for row in result.fetchall() if row[0]]
                return [{"value": name, "label": name.upper()} for name in sorted(names)]
        return []
    return [{"value": ch["name"], "label": ch["name"].upper()} for ch in channels_config]


@app.get("/api/tags/{tag_name}/emails")
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
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    results, total = await _storage.get_emails_by_tag(
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


@app.delete("/api/tags/{tag_id}")
async def delete_tag(
    tag_id: int,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除标签。

    会级联删除所有子标签。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_manage_access(tag_id, current_user)

    deleted = await _tag_store.delete_tag(tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    return {"status": "ok", "message": f"Tag {tag_id} deleted"}


@app.post("/api/tags/{source_id}/merge/{target_id}")
async def merge_tags(
    source_id: int,
    target_id: int,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """将 source 标签合并到 target 标签。

    所有 source 的 tag assignment 被重新分配到 target，
    source 的子标签迁移到 target 下，source 标签被删除。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_manage_access(source_id, current_user)
    await _ensure_tag_manage_access(target_id, current_user)

    try:
        result = await _tag_store.merge_tag(source_id, target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", **result}


@app.post("/api/tag-assignments", response_model=TagAssignmentRead)
async def create_tag_assignment(
    request: TagAssignmentCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_assignment_write_allowed(
        current_user=current_user,
        tag_id=request.tag_id,
        tag_slug=request.tag_slug,
        tag_name=request.tag_name,
    )

    try:
        return await _tag_store.assign_tag(
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


@app.get("/api/tag-assignments", response_model=list[TagAssignmentRead])
async def list_tag_assignments(
    target_type: Optional[str] = Query(None),
    target_ref: Optional[str] = Query(None),
    anchor_json: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    tag_kind: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    anchor = json.loads(anchor_json) if anchor_json else None
    return await _tag_store.list_assignments(
        target_type=target_type,
        target_ref=target_ref,
        anchor=anchor,
        tag=tag,
        tag_kind=tag_kind,
        status=status,
        viewer_user_id=current_user.user_id if current_user else None,
    )


@app.delete("/api/tag-assignments/{assignment_id}")
async def delete_tag_assignment(
    assignment_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    await _ensure_tag_assignment_delete_access(assignment_id, current_user)

    deleted = await _tag_store.remove_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag assignment {assignment_id} not found")
    return {"status": "ok", "assignment_id": assignment_id, "deleted": True}


@app.get("/api/tag-targets")
async def get_tag_targets(
    tag: str = Query(..., min_length=1),
    target_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    items, total = await _tag_store.get_targets_by_tag(
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


@app.get("/api/tag-targets/{target_type}/{target_ref:path}/tags", response_model=TagTargetBundleResponse)
async def get_target_tags(
    target_type: str,
    target_ref: str,
    anchor_json: Optional[str] = Query(None),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    bundle = await _tag_store.get_target_bundle(
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


@app.get("/api/email/{message_id}/tags")
async def get_email_tags(
    message_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取邮件的标签列表。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    tags = await _storage.get_email_tags(
        message_id,
        viewer_user_id=current_user.user_id if current_user else None,
    )
    return {"message_id": message_id, "tags": tags}


@app.post("/api/email/{message_id}/tags")
async def add_email_tag(
    message_id: str,
    request: TagAddRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """为邮件添加标签。

    单封邮件最多 16 个标签。
    """
    if not _storage or not _tag_store:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    existing_tag = await _resolve_tag_for_write(tag_name=request.tag_name)
    if existing_tag is None:
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Editors can only use existing private tags")
        await _tag_store.get_or_create_tag(
            request.tag_name,
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
    else:
        await _ensure_tag_assignment_write_allowed(
            current_user=current_user,
            tag_name=request.tag_name,
        )

    added = await _storage.add_email_tag(
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


@app.delete("/api/email/{message_id}/tags/{tag_name}")
async def remove_email_tag(
    message_id: str,
    tag_name: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """从邮件移除标签。"""
    if not _storage or not _tag_store:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    async with _storage.session_factory() as session:
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
        removed = await _tag_store.remove_assignment(assignment_id)
        removed_any = removed or removed_any
    if not removed_any:
        raise HTTPException(status_code=403, detail="No removable tag assignments found")

    return {
        "status": "ok",
        "message_id": message_id,
        "tag": tag_name,
        "removed": True,
    }


# ============================================================
# API 路由（统一前缀 /api）
# ============================================================

@app.get("/")
async def root():
    """API 根路径 — 重定向到前端页面。"""
    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/app/", status_code=302)


@app.get("/api/")
async def root():
    """API 根路径 — 健康检查。"""
    return {"status": "ok", "service": "kernel-email-kb", "version": "0.1.0"}


@app.get("/api/search", response_model=SearchResponse)
async def search(
    q: str = Query("", description="搜索关键词"),
    list_name: Optional[str] = Query(None, description="限定邮件列表"),
    sender: Optional[str] = Query(None, description="发件人模糊匹配"),
    date_from: Optional[datetime] = Query(None, description="起始日期 (ISO 格式)"),
    date_to: Optional[datetime] = Query(None, description="结束日期 (ISO 格式)"),
    has_patch: Optional[bool] = Query(None, description="是否必须包含补丁"),
    tags: Optional[str] = Query(None, description="标签列表（逗号分隔，如 memory,vm）"),
    tag_mode: str = Query("any", description="标签匹配模式: any(任一匹配) 或 all(全部匹配)"),
    sort_by: str = Query("", description="排序字段: relevance(默认) 或 date"),
    sort_order: str = Query("", description="排序顺序: desc(默认) 或 asc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    mode: str = Query("hybrid", description="检索模式: keyword/semantic/hybrid"),
):
    """全文搜索邮件。

    支持三种模式：
    - keyword: 精确关键词检索（PostgreSQL GIN 全文索引）
    - semantic: 语义向量检索（pgvector，需启用）
    - hybrid: 混合检索（自动路由 + 结果融合）

    支持高级过滤：
    - sender: 发件人模糊匹配
    - date_from/date_to: 日期范围过滤
    - has_patch: 是否包含补丁
    - tags: 标签过滤（逗号分隔）
    - tag_mode: 标签匹配模式（any/all）
    """
    if not _retriever:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # 解析标签列表
    tag_list = None
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # 至少要有关键词或过滤条件
    if not q.strip() and not sender and not date_from and not date_to and has_patch is None and not tag_list:
        raise HTTPException(status_code=400, detail="At least one search condition is required")
    if mode == "semantic" and not q.strip():
        raise HTTPException(status_code=400, detail="Semantic search requires a non-empty query")

    query = SearchQuery(
        text=q,
        list_name=list_name,
        sender=sender,
        date_from=date_from,
        date_to=date_to,
        has_patch=has_patch,
        tags=tag_list,
        tag_mode=tag_mode,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )

    # 根据 mode 选择检索器
    if mode == "keyword":
        result = await _retriever.keyword_retriever.search(query)
    elif mode == "semantic":
        result = await _retriever.semantic_retriever.search(query)
    else:
        result = await _retriever.search(query)

    return SearchResponse(
        query=q,
        mode=result.mode,
        total=result.total,
        page=page,
        page_size=page_size,
        hits=[
            {
                "message_id": h.message_id,
                "subject": h.subject,
                "sender": h.sender,
                "date": h.date,
                "list_name": h.list_name,
                "thread_id": h.thread_id,
                "has_patch": h.has_patch,
                "tags": h.tags,
                "score": round(h.score, 4),
                "snippet": h.snippet,
                "source": h.source,
            }
            for h in result.hits
        ],
    )


# ============================================================
# Ask 对话历史 API 路由
# ============================================================

@app.get("/api/ask/conversations")
async def list_ask_conversations(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取当前用户的 Ask 对话历史列表。"""
    if not _ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    items, total = await _ask_store.list_conversations(
        user_id=current_user.user_id,
        page=page,
        page_size=page_size,
    )
    return {
        "conversations": [item.model_dump(mode="json") for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/ask/conversations/{conversation_id}")
async def get_ask_conversation(
    conversation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取完整对话（含所有轮次）。"""
    if not _ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    conv = await _ask_store.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.user_id != current_user.user_id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    return conv.model_dump(mode="json")


@app.post("/api/ask/conversations")
async def save_ask_conversation(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """保存或更新 Ask 对话（upsert by conversation_id）。"""
    if not _ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    body = await request.json()
    conv = await _ask_store.save_conversation(
        conversation_id=body.get("conversation_id"),
        user_id=current_user.user_id,
        display_name=current_user.display_name,
        title=str(body.get("title") or ""),
        model=str(body.get("model") or ""),
        turns=body.get("turns") if isinstance(body.get("turns"), list) else [],
    )
    return conv.model_dump(mode="json")


@app.delete("/api/ask/conversations/{conversation_id}")
async def delete_ask_conversation(
    conversation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """删除对话及其所有轮次。"""
    if not _ask_store:
        raise HTTPException(status_code=503, detail="Ask store not initialized")
    conv = await _ask_store.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.user_id != current_user.user_id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Permission denied")
    await _ask_store.delete_conversation(conversation_id)
    return {"deleted": True}


@app.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest):
    """Agentic Ask — 生成检索计划、多路召回邮件证据并回答。"""
    if not _qa:
        raise HTTPException(status_code=503, detail="Ask service not initialized")

    answer = await _qa.ask(
        question=request.question,
        list_name=request.list_name,
        sender=request.sender,
        date_from=request.date_from,
        date_to=request.date_to,
        tags=[tag.strip() for tag in request.tags if tag.strip()],
        history=[item.model_dump() for item in request.history],
    )

    return AskResponse(
        question=answer.question,
        answer=answer.answer,
        sources=[
            {
                "chunk_id": s.chunk_id,
                "message_id": s.message_id,
                "subject": s.subject,
                "sender": s.sender,
                "date": s.date,
                "list_name": s.list_name,
                "thread_id": s.thread_id,
                "chunk_index": s.chunk_index,
                "snippet": s.snippet,
                "score": round(s.score, 4),
                "source": s.source,
            }
            for s in answer.sources
        ],
        model=answer.model,
        retrieval_mode=answer.retrieval_mode,
        search_plan=answer.search_plan,
        executed_queries=[
            {"query": item.query, "mode": item.mode, "hits": item.hits}
            for item in answer.executed_queries
        ],
        threads=[
            {
                "thread_id": thread.thread_id,
                "subject": thread.subject,
                "message_count": thread.message_count,
                "messages": thread.messages,
            }
            for thread in answer.threads
        ],
        retrieval_stats=answer.retrieval_stats,
    )


@app.post("/api/search/summarize", response_model=SummarizeResponse)
async def summarize_search(request: SummarizeRequest):
    """AI 概括搜索结果 — 基于搜索命中邮件生成引用式概览。

    输入搜索命中的邮件列表，由 LLM 生成带 [Message-ID] 引用的概括。
    """
    if not _llm_client or not _llm_client.available:
        raise HTTPException(status_code=503, detail="LLM service not available")

    hits = request.hits[:12]
    if not hits:
        raise HTTPException(status_code=400, detail="No search hits provided")

    evidence_text = "\n\n".join(
        f"[{hit.get('message_id', '')}]\n"
        f"Subject: {hit.get('subject', '')}\n"
        f"From: {hit.get('sender', '')}\n"
        f"Date: {hit.get('date', '')}\n"
        f"Snippet: {hit.get('snippet', '')}"
        for hit in hits
    )

    system_prompt = (
        "You are an expert Linux kernel mailing list research assistant. "
        "Answer based ONLY on the provided evidence. If evidence is insufficient, say so clearly. "
        "Cite sources with Message-ID in square brackets. Keep the answer concise and technical."
    )
    user_prompt = (
        f"Question:\n{request.query}\n\n"
        f"Evidence:\n{evidence_text[:12000]}\n\n"
        "Write a concise answer using only the evidence above. Include citations like [Message-ID]."
    )

    answer_text = await _llm_client.complete(system_prompt, user_prompt, temperature=0.2, max_tokens=1500)

    if not answer_text:
        answer_text = f"Found {len(hits)} relevant emails but LLM summarization is unavailable. Please review the results manually."

    sources = [
        {
            "message_id": hit.get("message_id", ""),
            "subject": hit.get("subject", ""),
            "sender": hit.get("sender", ""),
            "date": hit.get("date", ""),
            "snippet": hit.get("snippet", ""),
            "thread_id": hit.get("thread_id", ""),
            "list_name": hit.get("list_name", ""),
        }
        for hit in hits
    ]

    return SummarizeResponse(
        answer=answer_text,
        sources=sources,
        model=_llm_client.model,
    )


def _draft_response_payload(bundle: DraftResponse) -> dict:
    return {
        "knowledge_drafts": bundle.knowledge_drafts,
        "annotation_drafts": bundle.annotation_drafts,
        "tag_assignment_drafts": bundle.tag_assignment_drafts,
        "warnings": bundle.warnings,
    }


async def _persist_draft_response(
    *,
    source_type: str,
    source_ref: str,
    question: str,
    response: DraftResponse,
    current_user: CurrentUser,
) -> str:
    if not _knowledge_store:
        return ""
    draft = await _knowledge_store.create_draft(
        KnowledgeDraftCreate(
            source_type=source_type,
            source_ref=source_ref,
            question=question,
            payload=_draft_response_payload(response),
            created_by=current_user.display_name,
            updated_by=current_user.display_name,
            created_by_user_id=current_user.user_id,
            updated_by_user_id=current_user.user_id,
        )
    )
    return draft.draft_id


def _evidence_items_from_knowledge_draft(
    draft: dict,
    entity_id: str,
    current_user: CurrentUser,
) -> list[KnowledgeEvidenceCreate]:
    meta = draft.get("meta") if isinstance(draft.get("meta"), dict) else {}
    ask_meta = meta.get("ask") if isinstance(meta.get("ask"), dict) else {}
    sources = ask_meta.get("sources") if isinstance(ask_meta.get("sources"), list) else []
    claim = str(draft.get("summary") or draft.get("canonical_name") or "").strip()
    items: list[KnowledgeEvidenceCreate] = []
    for source in sources[:12]:
        if not isinstance(source, dict):
            continue
        message_id = str(source.get("message_id") or "").strip()
        thread_id = str(source.get("thread_id") or "").strip()
        if not message_id and not thread_id:
            continue
        items.append(
            KnowledgeEvidenceCreate(
                entity_id=entity_id,
                source_type=str(source.get("source") or "email"),
                message_id=message_id,
                thread_id=thread_id,
                claim=claim[:4000],
                quote=str(source.get("snippet") or "").strip()[:12000],
                confidence="draft",
                meta={
                    "subject": source.get("subject", ""),
                    "sender": source.get("sender", ""),
                    "date": source.get("date", ""),
                    "list_name": source.get("list_name", ""),
                    "chunk_id": source.get("chunk_id", ""),
                    "chunk_index": source.get("chunk_index", 0),
                    "ask_question": ask_meta.get("question", ""),
                },
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    return items


async def _apply_draft_request(
    request: DraftApplyRequest,
    current_user: CurrentUser,
) -> DraftApplyResponse:
    if not _knowledge_store or not _annotation_store or not _tag_store:
        raise HTTPException(status_code=503, detail="Knowledge, annotation or tag store not initialized")

    created_entities = []
    created_annotations = []
    created_tag_assignments = []
    errors = []

    for index, draft in enumerate(request.knowledge_drafts):
        if not draft.get("selected", True):
            continue
        try:
            entity = await _knowledge_store.create(
                KnowledgeEntityCreate(
                    entity_type=str(draft.get("entity_type") or "topic"),
                    canonical_name=str(draft.get("canonical_name") or "").strip(),
                    slug=str(draft.get("slug") or ""),
                    entity_id=str(draft.get("entity_id") or ""),
                    aliases=draft.get("aliases") if isinstance(draft.get("aliases"), list) else [],
                    summary=str(draft.get("summary") or ""),
                    description=str(draft.get("description") or ""),
                    status=str(draft.get("status") or "draft"),
                    meta=draft.get("meta") if isinstance(draft.get("meta"), dict) else {},
                    created_by=current_user.display_name,
                    updated_by=current_user.display_name,
                    created_by_user_id=current_user.user_id,
                    updated_by_user_id=current_user.user_id,
                )
            )
            evidence_items = _evidence_items_from_knowledge_draft(draft, entity.entity_id, current_user)
            if evidence_items:
                await _knowledge_store.create_evidence_many(evidence_items)
            created_entities.append(entity.model_dump(mode="json"))
        except Exception as exc:
            errors.append({"type": "knowledge", "index": index, "message": str(exc)})

    for index, draft in enumerate(request.annotation_drafts):
        if not draft.get("selected", True):
            continue
        try:
            visibility = _normalize_visibility(str(draft.get("visibility") or "private"))
            _ensure_public_write_allowed(visibility, current_user)
            annotation_type = str(draft.get("annotation_type") or "email")
            thread_id = str(draft.get("thread_id") or "")
            if annotation_type == "email" and not thread_id:
                raise ValueError("thread_id is required for email annotation drafts")

            annotation = await _annotation_store.create(
                AnnotationCreate(
                    annotation_type=annotation_type,
                    body=str(draft.get("body") or ""),
                    author=current_user.display_name,
                    author_user_id=current_user.user_id,
                    visibility=visibility,
                    parent_annotation_id=str(draft.get("parent_annotation_id") or ""),
                    target_type=str(draft.get("target_type") or ""),
                    target_ref=str(draft.get("target_ref") or ""),
                    target_label=str(draft.get("target_label") or ""),
                    target_subtitle=str(draft.get("target_subtitle") or ""),
                    anchor=draft.get("anchor") if isinstance(draft.get("anchor"), dict) else {},
                    meta=draft.get("meta") if isinstance(draft.get("meta"), dict) else {},
                    thread_id=thread_id,
                    in_reply_to=str(draft.get("in_reply_to") or ""),
                ),
                actor_user_id=current_user.user_id,
                actor_display_name=current_user.display_name,
            )
            created_annotations.append(_annotation_to_response(annotation).model_dump(mode="json"))
        except Exception as exc:
            errors.append({"type": "annotation", "index": index, "message": str(exc)})

    for index, draft in enumerate(request.tag_assignment_drafts):
        if not draft.get("selected", True):
            continue
        try:
            tag_name = str(draft.get("tag_name") or "").strip()
            if not tag_name:
                raise ValueError("tag_name is required")
            if await _tag_store.get_tag_by_name(tag_name) is None:
                raise ValueError(f"Tag '{tag_name}' does not exist")
            assignment = await _tag_store.assign_tag(
                TagAssignmentCreate(
                    tag_name=tag_name,
                    target_type=str(draft.get("target_type") or ""),
                    target_ref=str(draft.get("target_ref") or ""),
                    anchor=draft.get("anchor") if isinstance(draft.get("anchor"), dict) else {},
                    assignment_scope=str(draft.get("assignment_scope") or "direct"),
                    source_type=str(draft.get("source_type") or "search_summarize"),
                    evidence=draft.get("evidence") if isinstance(draft.get("evidence"), dict) else {},
                    created_by=current_user.display_name,
                    created_by_user_id=current_user.user_id,
                ),
                actor_user_id=current_user.user_id,
                actor_display_name=current_user.display_name,
            )
            created_tag_assignments.append(assignment.model_dump(mode="json"))
        except Exception as exc:
            errors.append({"type": "tag_assignment", "index": index, "message": str(exc)})

    return DraftApplyResponse(
        created_entities=created_entities,
        created_annotations=created_annotations,
        created_tag_assignments=created_tag_assignments,
        errors=errors,
    )


@app.post("/api/search/summarize/draft", response_model=DraftResponse)
async def create_summary_draft(
    request: DraftRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """基于 AI 概括结果生成可编辑的 Knowledge / Annotation / Tag 草稿。"""
    if not _llm_client:
        raise HTTPException(status_code=503, detail="LLM service not initialized")
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    async def tag_exists(tag_name: str) -> bool:
        return await _tag_store.get_tag_by_name(tag_name) is not None

    bundle = await AskDraftService(llm=_llm_client).generate(
        query=request.query,
        summary=request.summary,
        sources=request.sources,
        tag_exists=tag_exists,
    )
    response = DraftResponse(
        knowledge_drafts=bundle.knowledge_drafts,
        annotation_drafts=bundle.annotation_drafts,
        tag_assignment_drafts=bundle.tag_assignment_drafts,
        warnings=bundle.warnings,
    )
    response.draft_id = await _persist_draft_response(
        source_type="search_summarize",
        source_ref=request.query,
        question=request.query,
        response=response,
        current_user=current_user,
    )
    return response


@app.post("/api/search/summarize/draft/apply", response_model=DraftApplyResponse)
async def apply_summary_draft(
    request: DraftApplyRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """保存用户确认后的 AI 概括草稿。"""
    return await _apply_draft_request(request, current_user)


@app.post("/api/ask/draft", response_model=DraftResponse)
async def create_ask_draft(
    request: AskResponse,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """基于 Ask 结果生成可编辑的 Knowledge / Annotation / Tag 草稿。"""
    if not _llm_client:
        raise HTTPException(status_code=503, detail="LLM service not initialized")
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    async def tag_exists(tag_name: str) -> bool:
        return await _tag_store.get_tag_by_name(tag_name) is not None

    bundle = await AskDraftService(llm=_llm_client).generate(
        query=request.question,
        summary=request.answer,
        sources=request.sources,
        search_plan=request.search_plan,
        threads=request.threads,
        retrieval_stats=request.retrieval_stats,
        tag_exists=tag_exists,
    )
    response = DraftResponse(
        knowledge_drafts=bundle.knowledge_drafts,
        annotation_drafts=bundle.annotation_drafts,
        tag_assignment_drafts=bundle.tag_assignment_drafts,
        warnings=bundle.warnings,
    )
    response.draft_id = await _persist_draft_response(
        source_type="ask",
        source_ref=request.question,
        question=request.question,
        response=response,
        current_user=current_user,
    )
    return response


@app.post("/api/ask/draft/apply", response_model=DraftApplyResponse)
async def apply_ask_draft(
    request: DraftApplyRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """保存用户确认后的 Ask 草稿。"""
    return await _apply_draft_request(request, current_user)


@app.get("/api/thread/{thread_id:path}", response_model=ThreadResponse)
async def get_thread(
    thread_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取邮件线程 — 返回线程内所有邮件及批注（按时间排序）。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    emails = await _storage.get_thread(thread_id)
    if not emails:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")

    # 获取线程批注
    annotations_data = []
    if _annotation_store:
        annotations = await _annotation_store.list_by_thread(
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


@app.get("/api/stats", response_model=StatsResponse)
async def stats():
    """获取数据库统计信息。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    total = await _storage.get_email_count()

    return StatsResponse(
        total_emails=total,
        lists={"total": total},
    )


# ============================================================
# 翻译 API 路由
# ============================================================

@app.post("/api/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """翻译文本。
    
    支持单条翻译，自动缓存结果避免重复翻译相同内容。
    """
    if not _translator:
        raise HTTPException(
            status_code=503,
            detail="Translation service not available. Please install deep-translator: pip install deep-translator"
        )

    text = request.text.strip()
    if not text:
        return TranslateResponse(translation="", cached=False)

    # 先检查缓存
    if _translation_cache:
        cached = await _translation_cache.get(
            text, request.source_lang, request.target_lang
        )
        if cached is not None:
            return TranslateResponse(translation=cached, cached=True)

    # 调用翻译服务
    try:
        translation = await _translator.translate(
            text, request.source_lang, request.target_lang
        )
    except TranslationError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 缓存结果
    if _translation_cache:
        await _translation_cache.set(
            text, translation, request.source_lang, request.target_lang
        )

    return TranslateResponse(translation=translation, cached=False)


@app.post("/api/translate/batch", response_model=TranslateBatchResponse)
async def translate_batch(request: TranslateBatchRequest):
    """批量翻译文本。
    
    最多支持 50 条文本批量翻译，自动利用缓存。
    """
    if not _translator:
        raise HTTPException(
            status_code=503,
            detail="Translation service not available"
        )
    
    # 确保 target_lang 是有效的中文
    target_lang = request.target_lang
    if target_lang not in ("zh-CN", "zh"):
        logger.info(f"Invalid target_lang '{target_lang}', using 'zh-CN'")
        target_lang = "zh-CN"
    
    texts = [t.strip() for t in request.texts if t.strip()]
    if not texts:
        return TranslateBatchResponse(translations=[], cached_count=0)
    
    translations = []
    cached_count = 0
    
    # 批量查询缓存
    if _translation_cache:
        cache_results = await _translation_cache.get_batch(
            texts, request.source_lang, target_lang
        )
    else:
        cache_results = {text: None for text in texts}
    
    # 处理每条文本
    for text in texts:
        cached = cache_results.get(text)
        if cached is not None:
            translations.append(cached)
            cached_count += 1
            logger.debug(f"Cache hit for text: '{text[:50]}...' -> '{cached[:50]}...'")
        else:
            try:
                translation = await _translator.translate(
                    text, request.source_lang, target_lang
                )
                translations.append(translation)
                logger.debug(f"Translated: '{text[:30]}...' -> '{translation[:30]}...'")
                # 缓存翻译结果
                if _translation_cache:
                    await _translation_cache.set(
                        text, translation, request.source_lang, target_lang,
                        message_id=request.message_id,
                    )
            except TranslationError as e:
                logger.warning(f"Translation failed for text: {str(e)}")
                translations.append(text)  # 返回原文作为 fallback
    
    return TranslateBatchResponse(translations=translations, cached_count=cached_count)


@app.post("/api/translate/thread", response_model=TranslationJobResponse)
async def translate_thread(request: ThreadTranslateRequest):
    """创建线程翻译后台任务。"""
    if not _translator or not _storage:
        raise HTTPException(status_code=503, detail="Translation service not available")

    existing_job_id = _translation_jobs_by_thread.get(request.thread_id)
    if existing_job_id:
        existing = _translation_jobs.get(existing_job_id)
        if existing and existing.get("status") in {"pending", "running"}:
            return _translation_job_to_response(existing)

    now = datetime.utcnow().isoformat()
    job_id = f"translate-job-{uuid.uuid4().hex[:12]}"
    job = {
        "job_id": job_id,
        "thread_id": request.thread_id,
        "source_lang": request.source_lang,
        "target_lang": request.target_lang if request.target_lang in {"zh-CN", "zh"} else "zh-CN",
        "status": "pending",
        "total": 0,
        "completed": 0,
        "cached_count": 0,
        "failed_count": 0,
        "items": [],
        "error": "",
        "created_at": now,
        "updated_at": now,
    }
    _translation_jobs[job_id] = job
    _translation_jobs_by_thread[request.thread_id] = job_id
    asyncio.create_task(_run_thread_translation_job(job_id))
    return _translation_job_to_response(job)


@app.get("/api/translate/jobs/{job_id}", response_model=TranslationJobResponse)
async def get_translation_job(job_id: str):
    """查询线程翻译任务状态。"""
    job = _translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Translation job not found: {job_id}")
    return _translation_job_to_response(job)


@app.get("/api/translate/jobs", response_model=TranslationJobListResponse)
async def list_translation_jobs(
    status: str = Query("active", description="active | all"),
):
    """列出线程翻译任务。"""
    if status == "active":
        jobs = [
            _translation_job_to_response(job)
            for job in _translation_jobs.values()
            if job.get("status") in {"pending", "running"}
        ]
    else:
        jobs = [_translation_job_to_response(job) for job in _translation_jobs.values()]

    jobs.sort(key=lambda job: job.updated_at, reverse=True)
    return TranslationJobListResponse(jobs=jobs, total=len(jobs))


@app.get("/api/translate/health")
async def translate_health():
    """翻译服务健康检查。"""
    return {
        "available": is_translator_available(),
        "translator": "google",
        "cache_enabled": _translation_cache is not None,
    }


class ClearCacheRequest(BaseModel):
    """清除缓存请求模型。"""
    scope: str = Field("paragraph", description="清除范围: 'paragraph' 清除单条, 'all' 清除全部")
    text_hash: Optional[str] = Field(None, description="段落文本的 SHA256 哈希（scope='paragraph' 时必填）")


class ClearCacheResponse(BaseModel):
    """清除缓存响应模型。"""
    success: bool
    message: str
    cleared_count: int = 0


@app.delete("/api/translate/cache", response_model=ClearCacheResponse)
async def clear_translation_cache(request: ClearCacheRequest = Body(...)):
    """清除翻译缓存。

    - scope='paragraph': 清除指定段落的缓存（需要提供 text_hash）
    - scope='all': 清除全部翻译缓存
    """
    if not _translation_cache:
        return ClearCacheResponse(
            success=False,
            message="Translation cache not initialized",
            cleared_count=0,
        )

    try:
        if request.scope == "all":
            cleared = await _translation_cache.clear_all()
            logger.info(f"Cleared all translation cache: {cleared} entries")
            return ClearCacheResponse(
                success=True,
                message=f"All translation cache cleared ({cleared} entries)",
                cleared_count=cleared,
            )
        elif request.scope == "paragraph":
            if not request.text_hash:
                raise HTTPException(status_code=400, detail="text_hash is required for 'paragraph' scope")
            deleted = await _translation_cache.delete(request.text_hash)
            logger.info(f"Cleared translation cache for hash: {request.text_hash}, deleted={deleted}")
            return ClearCacheResponse(
                success=True,
                message="Paragraph cache cleared" if deleted else "Cache entry not found",
                cleared_count=1 if deleted else 0,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid scope. Must be 'paragraph' or 'all'"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear translation cache: {e}")
        return ClearCacheResponse(
            success=False,
            message=f"Failed to clear cache: {str(e)}",
            cleared_count=0,
        )


class TranslatedThreadInfo(BaseModel):
    """已翻译线程信息。"""
    thread_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    list_name: str = ""
    email_count: int = 0
    cached_paragraphs: int = 0
    tags: list[str] = []
    last_translated_at: Optional[str] = None


class TranslatedThreadsResponse(BaseModel):
    """已翻译线程列表响应。"""
    threads: list[TranslatedThreadInfo]
    total: int


@app.get("/api/translate/threads", response_model=TranslatedThreadsResponse)
async def get_translated_threads():
    """获取有翻译缓存的线程列表（含邮件标签）。

    通过 translation_cache.message_id 关联 emails 表，
    按 thread_id 分组，返回每个线程的翻译统计和标签信息。
    每次请求创建新 session，避免长生命周期 session 过期问题。
    """
    if not _storage:
        return TranslatedThreadsResponse(threads=[], total=0)

    try:
        from src.storage.translation_cache import TranslationCache
        from src.storage.models import EmailORM
        from sqlalchemy import func as sa_func

        async with _storage.session_factory() as session:
            # 查询有缓存的 message_id 及其缓存数量和最近翻译时间
            cache_stmt = (
                select(
                    TranslationCache.message_id,
                    sa_func.count().label("cached_count"),
                    sa_func.max(TranslationCache.created_at).label("last_translated"),
                )
                .where(TranslationCache.message_id.isnot(None))
                .group_by(TranslationCache.message_id)
            )
            cache_result = await session.execute(cache_stmt)
            cache_rows = cache_result.all()

            if not cache_rows:
                return TranslatedThreadsResponse(threads=[], total=0)

            # 构建 message_id -> cache_info 映射
            cache_map = {
                row.message_id: {
                    "cached_count": row.cached_count,
                    "last_translated": row.last_translated,
                }
                for row in cache_rows
            }

            # 查询这些邮件的详细信息
            email_stmt = select(EmailORM).where(
                EmailORM.message_id.in_(list(cache_map.keys()))
            )
            email_result = await session.execute(email_stmt)
            emails = email_result.scalars().all()

            # 按 thread_id 分组
            thread_groups: dict[str, dict] = {}
            for email in emails:
                tid = email.thread_id or email.message_id
                if tid not in thread_groups:
                    thread_groups[tid] = {
                        "thread_id": tid,
                        "subject": email.subject,
                        "sender": email.sender,
                        "date": email.date.isoformat() if email.date else None,
                        "list_name": email.list_name,
                        "email_count": 0,
                        "cached_paragraphs": 0,
                        "tags": set(),
                        "last_translated_at": None,
                    }
                group = thread_groups[tid]
                group["email_count"] += 1
                cache_info = cache_map.get(email.message_id, {})
                group["cached_paragraphs"] += cache_info.get("cached_count", 0)
                # 合并标签
                if _tag_store:
                    thread_tags = await _tag_store.get_target_tag_names(
                        TARGET_TYPE_EMAIL_THREAD,
                        tid,
                    )
                    group["tags"].update(thread_tags)
                # 更新最近翻译时间
                lt = cache_info.get("last_translated")
                if lt:
                    lt_str = lt.isoformat() if hasattr(lt, "isoformat") else str(lt)
                    if not group["last_translated_at"] or lt_str > group["last_translated_at"]:
                        group["last_translated_at"] = lt_str

            # 转为列表并排序
            threads = [
                TranslatedThreadInfo(
                    thread_id=g["thread_id"],
                    subject=g["subject"],
                    sender=g["sender"],
                    date=g["date"],
                    list_name=g["list_name"],
                    email_count=g["email_count"],
                    cached_paragraphs=g["cached_paragraphs"],
                    tags=sorted(g["tags"]),
                    last_translated_at=g["last_translated_at"],
                )
                for g in thread_groups.values()
            ]
            threads.sort(key=lambda t: t.last_translated_at or "", reverse=True)

            return TranslatedThreadsResponse(threads=threads, total=len(threads))

    except Exception as e:
        logger.error(f"Failed to get translated threads: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get translated threads: {str(e)}")


class ManualTranslateRequest(BaseModel):
    """人工翻译请求模型。"""
    original_text: str = Field(..., description="原文")
    translated_text: str = Field(..., description="人工翻译后的文本")
    source_lang: str = Field("en", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")


class ManualTranslateResponse(BaseModel):
    """人工翻译响应模型。"""
    success: bool
    message: str
    cache_key: Optional[str] = None


@app.put("/api/translate/manual", response_model=ManualTranslateResponse)
async def manual_translate(request: ManualTranslateRequest = Body(...)):
    """人工翻译接口 - 将用户提供的翻译缓存起来。

    用于用户手动翻译特定段落并保存到缓存，
    下次翻译相同内容时直接返回人工翻译结果。
    """
    if not _translation_cache:
        return ManualTranslateResponse(
            success=False,
            message="Translation cache not initialized",
        )

    try:
        cache_key = await _translation_cache.set_manual_translation(
            original_text=request.original_text,
            translated_text=request.translated_text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
        )
        logger.info(f"Manual translation cached: key={cache_key}")
        return ManualTranslateResponse(
            success=True,
            message="Manual translation saved to cache",
            cache_key=cache_key,
        )
    except Exception as e:
        logger.error(f"Failed to save manual translation: {e}")
        return ManualTranslateResponse(
            success=False,
            message=f"Failed to save: {str(e)}",
        )


# ============================================================
# 批注 API 路由
# ============================================================

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


class AnnotationResponse(BaseModel):
    """统一标注响应。"""
    annotation_id: str
    annotation_type: str = "email"
    author: str
    author_user_id: Optional[str] = None
    visibility: str = "public"
    publish_status: str = "none"
    body: str
    parent_annotation_id: str = ""
    publish_requested_at: Optional[str] = None
    publish_requested_by_user_id: Optional[str] = None
    publish_reviewed_at: Optional[str] = None
    publish_reviewed_by_user_id: Optional[str] = None
    publish_review_comment: str = ""
    created_at: str
    updated_at: str
    target_type: str = ""
    target_ref: str = ""
    target_label: str = ""
    target_subtitle: str = ""
    anchor: dict = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict)
    thread_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    version: Optional[str] = None
    file_path: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None


def _annotation_to_response(annotation: AnnotationRead) -> AnnotationResponse:
    return AnnotationResponse(
        annotation_id=annotation.annotation_id,
        annotation_type=annotation.annotation_type,
        author=annotation.author,
        author_user_id=annotation.author_user_id,
        visibility=annotation.visibility,
        publish_status=annotation.publish_status,
        body=annotation.body,
        parent_annotation_id=annotation.parent_annotation_id,
        publish_requested_at=annotation.publish_requested_at.isoformat() if annotation.publish_requested_at else None,
        publish_requested_by_user_id=annotation.publish_requested_by_user_id,
        publish_reviewed_at=annotation.publish_reviewed_at.isoformat() if annotation.publish_reviewed_at else None,
        publish_reviewed_by_user_id=annotation.publish_reviewed_by_user_id,
        publish_review_comment=annotation.publish_review_comment or "",
        created_at=annotation.created_at.isoformat(),
        updated_at=annotation.updated_at.isoformat(),
        target_type=annotation.target_type,
        target_ref=annotation.target_ref,
        target_label=annotation.target_label,
        target_subtitle=annotation.target_subtitle,
        anchor=annotation.anchor or {},
        meta=annotation.meta or {},
        thread_id=annotation.thread_id or "",
        in_reply_to=annotation.in_reply_to or "",
        version=annotation.version or "",
        file_path=annotation.file_path or "",
        start_line=annotation.start_line or 0,
        end_line=annotation.end_line or 0,
    )


@app.get("/api/annotations/stats")
async def get_annotation_stats(current_user: Optional[CurrentUser] = Depends(get_optional_current_user)):
    """获取批注各类型总数统计。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    from sqlalchemy import func, select
    from src.storage.models import AnnotationORM

    async with _annotation_store.session_factory() as session:
        stmt = (
            select(AnnotationORM.annotation_type, func.count(AnnotationORM.id).label("count"))
            .where(*_annotation_store._visibility_filters(
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


@app.get("/api/annotations")
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
    if not _annotation_store:
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
            annotations, total = await _annotation_store.search(
                keyword=q.strip(),
                annotation_type=type,
                page=page,
                page_size=page_size,
                extra_filters=extra_filters or None,
                viewer_user_id=current_user.user_id if current_user else None,
                include_all_private=bool(current_user and _is_admin(current_user)),
            )
        else:
            annotations, total = await _annotation_store.list_all(
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


@app.post("/api/annotations", response_model=AnnotationResponse)
async def create_annotation(
    request: AnnotationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建统一标注。"""
    if not _annotation_store:
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
        annotation = await _annotation_store.create(
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


@app.get("/api/annotations/{thread_id:path}", response_model=list[AnnotationResponse])
async def get_annotations(
    thread_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取线程所有批注（仅 email 类型）。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await _annotation_store.list_by_thread(
        thread_id,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return [_annotation_to_response(a) for a in annotations]


@app.post("/api/annotations/{annotation_id}/publish-request", response_model=AnnotationResponse)
async def request_annotation_publication(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _ensure_annotation_publish_request_access(annotation_id, current_user)
    if annotation.visibility != "private":
        raise HTTPException(status_code=400, detail="Only private annotations can request publication")

    updated = await _annotation_store.request_publication(annotation_id, current_user.user_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@app.post("/api/annotations/{annotation_id}/publish-withdraw", response_model=AnnotationResponse)
async def withdraw_annotation_publication_request(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if not _is_admin(current_user):
        if annotation.author_user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="Editors can only withdraw their own publication requests")
        if annotation.visibility == "public":
            raise HTTPException(status_code=400, detail="Public annotations do not have a withdrawable publication request")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await _annotation_store.withdraw_publication_request(annotation_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@app.post("/api/admin/annotations/{annotation_id}/approve-publication", response_model=AnnotationResponse)
async def approve_annotation_publication(
    annotation_id: str,
    request: AnnotationPublicationReviewRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await _annotation_store.review_publication(
        annotation_id,
        approved=True,
        reviewer_user_id=current_user.user_id,
        review_comment=request.review_comment,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@app.post("/api/admin/annotations/{annotation_id}/reject-publication", response_model=AnnotationResponse)
async def reject_annotation_publication(
    annotation_id: str,
    request: AnnotationPublicationReviewRequest,
    current_user: CurrentUser = Depends(require_roles("admin")),
):
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotation = await _annotation_store.get(annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    if annotation.publish_status != "pending":
        raise HTTPException(status_code=400, detail="Annotation is not pending publication review")

    updated = await _annotation_store.review_publication(
        annotation_id,
        approved=False,
        reviewer_user_id=current_user.user_id,
        review_comment=request.review_comment,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return _annotation_to_response(updated)


@app.put("/api/annotations/{annotation_id}")
async def update_annotation(
    annotation_id: str,
    request: AnnotationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """编辑批注。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    updated = await _annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除批注。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    deleted = await _annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return {"status": "ok", "message": f"Annotation {annotation_id} deleted"}


@app.post("/api/annotations/export")
async def export_annotations(
    thread_id: Optional[str] = Query(None, description="线程 ID（留空导出全部）"),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """导出批注为 JSON（满足 git 固化需求）。

    - 指定 thread_id：导出单个线程的批注
    - 不指定：导出所有批注（按线程分组）
    """
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if thread_id:
        annotations = await _annotation_store.list_by_thread(
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
        items, _ = await _annotation_store.list_all(
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


@app.post("/api/annotations/import")
async def import_annotations(
    data: dict = Body(...),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """从 JSON 导入批注（已存在的会跳过）。

    支持两种格式：
    - 单目标格式：{ "thread_id": "...", "annotations": [...] }
    - 全量格式：{ "targets": { "target_ref": [...], ... } }
    """
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    try:
        if "targets" in data:
            result = await _annotation_store.import_all(data)
            return {"status": "ok", **result}
        elif "thread_id" in data:
            count = await _annotation_store.import_thread(data)
            return {"status": "ok", "total_imported": count, "thread_id": data["thread_id"]}
        else:
            raise HTTPException(status_code=400, detail="Invalid format: need 'targets' or 'thread_id' key")
    except Exception as e:
        logger.error(f"Failed to import annotations: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


# ============================================================
# 芯片手册 API 路由
# ============================================================

@app.get("/api/manual/search", response_model=ManualSearchResponse)
async def manual_search(
    q: str = Query(..., min_length=1, description="搜索关键词"),
    manual_type: Optional[str] = Query(None, description="手册类型 (如 intel_sdm)"),
    content_type: Optional[str] = Query(None, description="内容类型过滤"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """全文搜索芯片手册文档。

    支持按手册类型、内容类型过滤。
    """
    if not _manual_retriever:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized. Please configure storage.manual in settings.yaml"
        )

    query = ManualSearchQuery(
        text=q,
        manual_type=manual_type,
        content_type=content_type,
        page=page,
        page_size=page_size,
    )

    result = await _manual_retriever.search(query)

    return ManualSearchResponse(
        query=q,
        mode=result.mode,
        total=result.total,
        hits=[
            {
                "chunk_id": h.chunk_id,
                "manual_type": h.manual_type,
                "manual_version": h.manual_version,
                "volume": h.volume,
                "chapter": h.chapter,
                "section": h.section,
                "section_title": h.section_title,
                "content_type": h.content_type,
                "content": h.content[:500],  # 限制内容长度
                "page_start": h.page_start + 1,  # 转为 1-based
                "page_end": h.page_end + 1,
                "score": round(h.score, 4),
                "snippet": h.snippet,
            }
            for h in result.hits
        ],
    )


@app.get("/api/manual/ask", response_model=ManualAskResponse)
async def manual_ask(
    q: str = Query(..., min_length=1, description="问题"),
    manual_type: Optional[str] = Query(None, description="限定手册类型"),
    content_type: Optional[str] = Query(None, description="限定内容类型"),
):
    """RAG 问答 — 基于芯片手册上下文回答问题。

    Pipeline: 问题 → 文档检索 → 上下文构建 → LLM 生成（或 fallback 到摘要）
    """
    if not _manual_qa:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized. Please configure storage.manual in settings.yaml"
        )

    answer = await _manual_qa.ask(
        question=q,
        manual_type=manual_type,
        content_type=content_type,
    )

    return ManualAskResponse(
        question=answer.question,
        answer=answer.answer,
        sources=[
            {
                "chunk_id": s.chunk_id,
                "section": s.section,
                "section_title": s.section_title,
                "manual_type": s.manual_type,
                "page_start": s.page_start + 1,
                "page_end": s.page_end + 1,
                "snippet": s.snippet,
            }
            for s in answer.sources
        ],
        model=answer.model,
        retrieval_mode=answer.retrieval_mode,
    )


@app.get("/api/manual/stats", response_model=ManualStatsResponse)
async def manual_stats():
    """获取芯片手册数据库统计信息。"""
    if not _manual_storage:
        raise HTTPException(
            status_code=503,
            detail="Manual storage not initialized"
        )

    stats = await _manual_storage.get_stats()

    return ManualStatsResponse(
        total_chunks=stats["total"],
        by_manual_type=stats["by_manual_type"],
        by_content_type=stats["by_content_type"],
    )


# ============================================================
# 内核源码浏览 API 路由 (PLAN-10000)
# ============================================================

@app.get("/api/kernel/versions")
async def kernel_versions(
    filter: str = Query("release", description="版本过滤: release(正式版) 或 all(含rc)"),
):
    """获取所有可用的内核版本列表。

    返回按版本号降序排列的版本信息列表，支持过滤 rc 版本。
    """
    if not _kernel_source:
        raise HTTPException(
            status_code=503,
            detail="Kernel source not initialized. Please configure kernel_source.repo_path in settings.yaml",
        )

    include_rc = (filter == "all")
    versions = await _kernel_source.list_versions(include_rc=include_rc)
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


@app.get("/api/kernel/tree/{version}/{path:path}")
async def kernel_tree(version: str, path: str = ""):
    """获取指定版本、指定路径下的目录树。

    Args:
        version: 版本 tag（如 v6.1）。
        path: 相对路径（空字符串表示根目录）。
    """
    if not _kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        entries = await _kernel_source.list_tree(version, path)
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


@app.get("/api/kernel/tree/{version}")
async def kernel_tree_root(version: str):
    """获取指定版本根目录树（无 path 参数时的路由）。"""
    return await kernel_tree(version, "")


@app.get("/api/kernel/file/{version}/{path:path}")
async def kernel_file(version: str, path: str):
    """获取指定版本、指定文件的内容。

    Args:
        version: 版本 tag。
        path: 文件相对路径。
    """
    if not _kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        file_content = await _kernel_source.get_file(version, path)
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




# ============================================================
# 统一知识实体 API 路由 (PLAN-31000 Phase 1)
# ============================================================

@app.get("/api/knowledge/entities")
async def list_knowledge_entities(
    q: str = Query("", description="搜索关键词"),
    entity_type: str = Query("", description="实体类型过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    items, total = await _knowledge_store.list_entities(
        q=q,
        entity_type=entity_type,
        page=page,
        page_size=page_size,
    )
    return {
        "entities": [item.model_dump(mode="json") for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/knowledge/entities/by-message/{message_id:path}")
async def get_knowledge_entities_by_message(message_id: str):
    """根据邮件 Message-ID 反向查找引用了该邮件的知识实体。"""
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    entities = await _knowledge_store.find_entities_by_message_id(message_id)
    return {
        "message_id": message_id,
        "entities": [e.model_dump(mode="json") for e in entities],
    }


@app.get("/api/knowledge/stats")
async def get_knowledge_stats():
    """获取知识库概览统计数据。"""
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return await _knowledge_store.get_stats()


@app.post("/api/agent/research-runs", response_model=AgentResearchRunRead)
async def create_agent_research_run(
    request: AgentResearchRunCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _agent_store or not _agent_user or not _agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    filters = {
        "list_name": request.list_name.strip(),
        "sender": request.sender.strip(),
        "date_from": request.date_from.isoformat() if request.date_from else "",
        "date_to": request.date_to.isoformat() if request.date_to else "",
        "tags": request.tags,
        "has_patch": request.has_patch,
        "read_scope": "public",
    }
    run = await _agent_store.create_run(
        AgentResearchRunCreate(
            topic=request.topic,
            requested_by_user_id=current_user.user_id,
            requested_by=current_user.display_name,
            agent_user_id=_agent_user.user_id,
            agent_name=_agent_user.display_name,
            filters=filters,
            budget=request.budget.model_dump(),
        )
    )
    asyncio.create_task(_agent_service.execute(run.run_id))
    return run


@app.get("/api/agent/research-runs", response_model=AgentResearchRunListResponse)
async def list_agent_research_runs(
    status: str = Query("", description="run status filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _agent_store:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    runs, total = await _agent_store.list_runs(status=status, page=page, page_size=page_size)
    return AgentResearchRunListResponse(runs=runs, total=total, page=page, page_size=page_size)


@app.get("/api/agent/research-runs/{run_id}", response_model=AgentResearchRunDetailResponse)
async def get_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _agent_store:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    run = await _agent_store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    actions = await _agent_store.list_actions(run_id)
    return AgentResearchRunDetailResponse(run=run, actions=actions)


@app.post("/api/agent/research-runs/{run_id}/cancel", response_model=AgentResearchRunRead)
async def cancel_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    run = await _agent_service.cancel(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return run


@app.post("/api/agent/research-runs/{run_id}/retry", response_model=AgentResearchRunRead)
async def retry_agent_research_run(
    run_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _agent_service:
        raise HTTPException(status_code=503, detail="Agent research service not initialized")
    retry = await _agent_service.retry(run_id, current_user.user_id, current_user.display_name)
    if not retry:
        raise HTTPException(status_code=404, detail="Agent research run not found")
    return retry


@app.get("/api/knowledge/drafts", response_model=KnowledgeDraftListResponse)
async def list_knowledge_drafts(
    status: str = Query("", description="草稿状态过滤"),
    source_type: str = Query("", description="按来源类型过滤，如 agent_research"),
    created_by_user_id: str = Query("", description="按创建者用户 ID 过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    drafts, total = await _knowledge_store.list_drafts(
        status=status,
        source_type=source_type,
        created_by_user_id=created_by_user_id,
        page=page,
        page_size=page_size,
    )
    return KnowledgeDraftListResponse(drafts=drafts, total=total, page=page, page_size=page_size)


@app.post("/api/knowledge/drafts", response_model=KnowledgeDraftRead)
async def create_knowledge_draft(
    request: KnowledgeDraftCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    return await _knowledge_store.create_draft(
        KnowledgeDraftCreate(
            source_type=request.source_type,
            source_ref=request.source_ref,
            question=request.question,
            payload=request.payload,
            status=request.status,
            review_note=request.review_note,
            created_by=current_user.display_name,
            updated_by=current_user.display_name,
            created_by_user_id=current_user.user_id,
            updated_by_user_id=current_user.user_id,
        )
    )


@app.patch("/api/knowledge/drafts/{draft_id}", response_model=KnowledgeDraftRead)
async def update_knowledge_draft(
    draft_id: str,
    request: KnowledgeDraftUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await _knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(
            payload=request.payload,
            status=request.status,
            review_note=request.review_note,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    return draft


@app.post("/api/knowledge/drafts/{draft_id}/accept", response_model=DraftApplyResponse)
async def accept_knowledge_draft(
    draft_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await _knowledge_store.get_draft(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    payload = draft.payload if isinstance(draft.payload, dict) else {}
    result = await _apply_draft_request(
        DraftApplyRequest(
            knowledge_drafts=payload.get("knowledge_drafts") if isinstance(payload.get("knowledge_drafts"), list) else [],
            annotation_drafts=payload.get("annotation_drafts") if isinstance(payload.get("annotation_drafts"), list) else [],
            tag_assignment_drafts=payload.get("tag_assignment_drafts") if isinstance(payload.get("tag_assignment_drafts"), list) else [],
        ),
        current_user,
    )
    await _knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(status="accepted" if not result.errors else "reviewing"),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    return result


@app.post("/api/knowledge/drafts/{draft_id}/reject", response_model=KnowledgeDraftRead)
async def reject_knowledge_draft(
    draft_id: str,
    request: KnowledgeDraftUpdateRequest = Body(default=KnowledgeDraftUpdateRequest()),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    draft = await _knowledge_store.update_draft(
        draft_id,
        KnowledgeDraftUpdate(status="rejected", review_note=request.review_note),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Knowledge draft not found")
    return draft


@app.post("/api/knowledge/entities/merge")
async def merge_knowledge_entities(
    request: KnowledgeEntityMergeRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        result = await _knowledge_store.merge_entities(
            source_entity_id=request.source_entity_id,
            target_entity_id=request.target_entity_id,
            updated_by=current_user.display_name,
            updated_by_user_id=current_user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "source": result["source"].model_dump(mode="json"),
        "target": result["target"].model_dump(mode="json"),
        "moved": result["moved"],
    }


@app.post("/api/knowledge/entities")
async def create_knowledge_entity(
    request: "KnowledgeEntityCreateRequest",
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    try:
        entity = await _knowledge_store.create(
            KnowledgeEntityCreate(
                entity_type=request.entity_type,
                canonical_name=request.canonical_name,
                slug=request.slug,
                entity_id=request.entity_id,
                aliases=request.aliases,
                summary=request.summary,
                description=request.description,
                status=request.status,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    similar = await _knowledge_store.find_similar(
        entity.canonical_name,
        entity.entity_type,
    )
    similar = [s for s in similar if s.entity_id != entity.entity_id]
    return {
        "entity": entity.model_dump(mode="json"),
        "suggestions": {
            "duplicates": [s.model_dump(mode="json") for s in similar],
        },
    }


@app.get("/api/knowledge/entities/{entity_id}/relations", response_model=KnowledgeRelationListResponse)
async def list_knowledge_relations(entity_id: str):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await _knowledge_store.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    outgoing, incoming = await _knowledge_store.list_relations(entity_id)
    return KnowledgeRelationListResponse(outgoing=outgoing, incoming=incoming)


@app.get("/api/knowledge/entities/{entity_id}/evidence", response_model=list[KnowledgeEvidenceRead])
async def list_knowledge_evidence(entity_id: str):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    entity = await _knowledge_store.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return await _knowledge_store.list_evidence(entity_id)


@app.post("/api/knowledge/entities/{entity_id}/evidence", response_model=KnowledgeEvidenceRead)
async def create_knowledge_evidence(
    entity_id: str,
    request: KnowledgeEvidenceCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        return await _knowledge_store.create_evidence(
            KnowledgeEvidenceCreate(
                entity_id=entity_id,
                source_type=request.source_type,
                message_id=request.message_id,
                thread_id=request.thread_id,
                claim=request.claim,
                quote=request.quote,
                confidence=request.confidence,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/knowledge/entities/{entity_id}", response_model=KnowledgeEntityRead)
async def get_knowledge_entity(entity_id: str):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await _knowledge_store.get(entity_id.strip())
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return entity


@app.patch("/api/knowledge/evidence/{evidence_id}", response_model=KnowledgeEvidenceRead)
async def update_knowledge_evidence(
    evidence_id: str,
    request: KnowledgeEvidenceUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    evidence = await _knowledge_store.update_evidence(
        evidence_id,
        KnowledgeEvidenceUpdate(
            source_type=request.source_type,
            message_id=request.message_id,
            thread_id=request.thread_id,
            claim=request.claim,
            quote=request.quote,
            confidence=request.confidence,
            meta=request.meta,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if evidence is None:
        raise HTTPException(status_code=404, detail="Knowledge evidence not found")
    return evidence


@app.delete("/api/knowledge/evidence/{evidence_id}")
async def delete_knowledge_evidence(
    evidence_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    deleted = await _knowledge_store.delete_evidence(evidence_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge evidence not found")
    return {"deleted": True}


@app.post("/api/knowledge/relations", response_model=KnowledgeRelationRead)
async def create_knowledge_relation(
    request: KnowledgeRelationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        return await _knowledge_store.create_relation(
            KnowledgeRelationCreate(
                source_entity_id=request.source_entity_id,
                target_entity_id=request.target_entity_id,
                relation_type=request.relation_type,
                description=request.description,
                evidence_id=request.evidence_id,
                meta=request.meta,
                created_by=current_user.display_name,
                updated_by=current_user.display_name,
                created_by_user_id=current_user.user_id,
                updated_by_user_id=current_user.user_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.patch("/api/knowledge/relations/{relation_id}", response_model=KnowledgeRelationRead)
async def update_knowledge_relation(
    relation_id: str,
    request: KnowledgeRelationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    try:
        relation = await _knowledge_store.update_relation(
            relation_id=relation_id,
            data=KnowledgeRelationUpdate(
                relation_type=request.relation_type,
                description=request.description,
                evidence_id=request.evidence_id,
                meta=request.meta,
            ),
            updated_by=current_user.display_name,
            updated_by_user_id=current_user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if relation is None:
        raise HTTPException(status_code=404, detail="Knowledge relation not found")
    return relation


@app.delete("/api/knowledge/relations/{relation_id}")
async def delete_knowledge_relation(
    relation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")
    deleted = await _knowledge_store.delete_relation(relation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge relation not found")
    return {"deleted": True}


@app.patch("/api/knowledge/entities/{entity_id}", response_model=KnowledgeEntityRead)
async def update_knowledge_entity(
    entity_id: str,
    request: "KnowledgeEntityUpdateRequest",
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    entity = await _knowledge_store.update(
        entity_id=entity_id.strip(),
        data=KnowledgeEntityUpdate(
            canonical_name=request.canonical_name,
            aliases=request.aliases,
            summary=request.summary,
            description=request.description,
            status=request.status,
            meta=request.meta,
        ),
        updated_by=current_user.display_name,
        updated_by_user_id=current_user.user_id,
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    return entity


@app.delete("/api/knowledge/entities/{entity_id}")
async def delete_knowledge_entity(
    entity_id: str,
    force: bool = Query(False, description="强制删除，级联删除关联关系"),
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除知识实体。

    - force=false: 若存在关联关系则返回 409，列出阻挡的关系。
    - force=true: 级联删除所有关联关系和标签分配。
    """
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    ok, blocked = await _knowledge_store.delete_entity(entity_id.strip(), force=force)
    if not ok and not blocked:
        raise HTTPException(status_code=404, detail="Knowledge entity not found")
    if not ok:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Entity has relations. Use force=true to cascade delete.",
                "blocked_by": blocked,
            },
        )
    return {"deleted": True}


@app.get("/api/knowledge/entities/{entity_id}/graph")
async def get_knowledge_graph(
    entity_id: str,
    depth: int = Query(2, ge=1, le=3, description="遍历深度（1-3）"),
    relation_type: str = Query("", description="关系类型过滤，逗号分隔"),
):
    """获取以指定实体为中心的邻域子图（BFS 遍历）。

    Returns:
        nodes: 子图中的所有实体。
        edges: 子图中的所有关系（含 source_entity/target_entity 详情）。
        center: 中心实体 ID。
        depth: 实际遍历深度。
    """
    if not _knowledge_store:
        raise HTTPException(status_code=503, detail="Knowledge store not initialized")

    types = [t.strip() for t in relation_type.split(",") if t.strip()] if relation_type else None
    graph = await _knowledge_store.get_graph(entity_id, depth=depth, relation_types=types)
    return graph


# ============================================================
# 代码注释 API 路由 (PLAN-10000 Phase B)
# ============================================================

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


class KnowledgeEntityCreateRequest(BaseModel):
    entity_type: str = Field(..., min_length=1, max_length=64)
    canonical_name: str = Field(..., min_length=1, max_length=256)
    slug: str = Field("", max_length=160)
    entity_id: str = Field("", max_length=160)
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field("", max_length=2000)
    description: str = Field("", max_length=20000)
    status: str = Field("active", max_length=32)
    meta: dict = Field(default_factory=dict)


class KnowledgeEntityUpdateRequest(BaseModel):
    canonical_name: Optional[str] = Field(None, min_length=1, max_length=256)
    aliases: Optional[list[str]] = None
    summary: Optional[str] = Field(None, max_length=2000)
    description: Optional[str] = Field(None, max_length=20000)
    status: Optional[str] = Field(None, max_length=32)
    meta: Optional[dict] = None


@app.get("/api/kernel/annotations")
async def list_code_annotations(
    q: Optional[str] = Query(None, description="搜索关键词"),
    version: Optional[str] = Query(None, description="限定版本"),
    publish_status: Optional[str] = Query(None, description="公开申请状态过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """代码标注总览，基于统一 annotation store。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if q and q.strip():
        extra_filters = [AnnotationORM.version == version] if version else []
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)
        annotations, total = await _annotation_store.search(
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
        annotations, total = await _annotation_store.list_all(
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


@app.get("/api/kernel/annotations/{version}/{path:path}")
async def get_file_code_annotations(
    version: str,
    path: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取指定文件的注释列表。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await _annotation_store.list_by_code(
        version,
        path,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return [_annotation_to_response(a).model_dump() for a in annotations]


@app.post("/api/kernel/annotations")
async def create_code_annotation(
    request: CodeAnnotationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建代码注释。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    visibility = _normalize_visibility(request.visibility)
    if request.in_reply_to and not _is_admin(current_user):
        visibility = "private"
    _ensure_public_write_allowed(visibility, current_user)

    try:
        annotation = await _annotation_store.create(
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


@app.put("/api/kernel/annotations/{annotation_id}")
async def update_code_annotation(
    annotation_id: str,
    request: CodeAnnotationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """更新代码注释正文。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    updated = await _annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@app.delete("/api/kernel/annotations/{annotation_id}")
async def delete_code_annotation(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除代码注释。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    deleted = await _annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return {"status": "ok", "annotation_id": annotation_id}

"""FastAPI 服务层 — 提供搜索、问答、线程查询、翻译接口。"""

import logging
import json
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, Query, Body
from pydantic import BaseModel, Field
from sqlalchemy import select

from src.qa.manual_qa import ManualQA
from src.qa.rag_qa import RagQA
from src.retriever.base import SearchQuery
from src.retriever.hybrid import HybridRetriever
from src.retriever.keyword import KeywordRetriever
from src.retriever.manual import ManualRetriever, ManualSearchQuery
from src.retriever.semantic import SemanticRetriever
from src.storage.document_store import DocumentStorage
from src.storage.models import (
    AnnotationCreate,
    AnnotationORM,
    AnnotationRead,
    AnnotationUpdate,
    EmailRead,
    TagAssignmentCreate,
    TagAssignmentRead,
    TagBundle,
    TagCreate,
    TagRead,
    TagTree,
)
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
from src.kernel_source.git_local import GitLocalSource
from src.translator.base import TranslationError
from src.translator.google_translator import GoogleTranslator, is_available as is_translator_available

logger = logging.getLogger(__name__)

# ============================================================
# 全局组件（在 lifespan 中初始化）
# ============================================================
_storage: Optional[PostgresStorage] = None
_retriever: Optional[HybridRetriever] = None
_qa: Optional[RagQA] = None
_tag_store: Optional[TagStore] = None

# 芯片手册相关组件
_manual_storage: Optional[DocumentStorage] = None
_manual_retriever: Optional[ManualRetriever] = None
_manual_qa: Optional[ManualQA] = None

# 翻译组件
_translator: Optional[GoogleTranslator] = None
_translation_cache: Optional[TranslationCacheStore] = None

# 批注组件
_annotation_store: Optional[AnnotationStore] = None

# 内核源码浏览组件
_kernel_source: Optional[GitLocalSource] = None


def _load_config() -> dict:
    """加载配置文件。"""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动时初始化组件，关闭时释放资源。"""
    global _storage, _retriever, _qa, _tag_store
    global _manual_storage, _manual_retriever, _manual_qa
    global _translator, _translation_cache
    global _annotation_store
    global _kernel_source

    config = _load_config()
    storage_cfg = config.get("storage", {})
    retriever_cfg = config.get("retriever", {})
    qa_cfg = config.get("qa", {})
    indexer_cfg = config.get("indexer", {})

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

    # 初始化标签存储
    _tag_store = TagStore(
        session_factory=_storage.session_factory,
        default_actor=config.get("annotations", {}).get("default_author", "me"),
    )

    # 初始化检索层
    keyword_retriever = KeywordRetriever(storage=_storage)
    semantic_retriever = SemanticRetriever(
        database_url=email_database_url,
        model=indexer_cfg.get("vector", {}).get("model", "text-embedding-3-small"),
        enabled=indexer_cfg.get("vector", {}).get("enabled", False),
    )
    _retriever = HybridRetriever(
        keyword_retriever=keyword_retriever,
        semantic_retriever=semantic_retriever,
    )

    # 初始化邮件问答层
    email_qa_cfg = qa_cfg.get("email", qa_cfg)
    _qa = RagQA(
        retriever=_retriever,
        storage=_storage,
        llm_provider=email_qa_cfg.get("llm_provider", "openai"),
        model=email_qa_cfg.get("model", "gpt-4"),
        api_key=email_qa_cfg.get("api_key", ""),
    )

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
            _kernel_source = GitLocalSource(
                repo_path=kernel_repo_path,
                max_file_size=kernel_cfg.get("max_file_size", 1_048_576),
                tree_cache_size=cache_cfg.get("tree_cache_size", 256),
                file_cache_size=cache_cfg.get("file_cache_size", 128),
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
    inherited_tags: list[TagRead] = Field(default_factory=list)
    aggregated_tags: list[TagRead] = Field(default_factory=list)


class SearchResponse(BaseModel):
    """搜索响应。"""
    query: str
    mode: str
    total: int
    page: int
    page_size: int
    hits: list[dict]


class AskResponse(BaseModel):
    """问答响应。"""
    question: str
    answer: str
    sources: list[dict]
    model: str
    retrieval_mode: str


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




# ============================================================
# 标签管理 API 路由
# ============================================================

@app.post("/api/tags", response_model=TagRead)
async def create_tag(request: TagCreateRequest):
    """创建标签。

    支持父子层级，子标签通过 parent_id 指定父标签。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

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
                aliases=request.aliases,
                created_by=request.created_by,
            )
        )
        return _tag_store._to_tag_read(tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/tags", response_model=list[TagTree])
async def get_tags(flat: bool = Query(False, description="是否返回平铺列表")):
    """获取标签树形结构。

    返回所有标签，按父子关系组织成树形结构。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    return await _tag_store.list_tags(flat=flat)


@app.patch("/api/tags/{tag_id}", response_model=TagRead)
async def update_tag(tag_id: int, request: TagUpdateRequest):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    try:
        tag = await _tag_store.update_tag(
            tag_id=tag_id,
            name=request.name,
            description=request.description,
            color=request.color,
            parent_tag_id=request.parent_tag_id if request.parent_tag_id is not None else request.parent_id,
            status=request.status,
            tag_kind=request.tag_kind,
            aliases=request.aliases,
            updated_by=request.updated_by or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not tag:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    return _tag_store._to_tag_read(tag)


@app.get("/api/tags/stats", response_model=list[dict])
async def get_tag_stats():
    """获取标签统计信息。

    返回所有标签及其被使用的邮件数量。
    """
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    return await _storage.get_all_tags_with_count()


@app.get("/api/tags/{tag_name}/emails")
async def get_tag_emails(
    tag_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
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
async def delete_tag(tag_id: int):
    """删除标签。

    会级联删除所有子标签。
    """
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    deleted = await _tag_store.delete_tag(tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")
    return {"status": "ok", "message": f"Tag {tag_id} deleted"}


@app.post("/api/tag-assignments", response_model=TagAssignmentRead)
async def create_tag_assignment(request: TagAssignmentCreateRequest):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

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
                created_by=request.created_by,
            )
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
    )


@app.delete("/api/tag-assignments/{assignment_id}")
async def delete_tag_assignment(assignment_id: str):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

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
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")

    items, total = await _tag_store.get_targets_by_tag(
        tag=tag,
        target_type=target_type,
        page=page,
        page_size=page_size,
    )
    return {
        "tag": tag,
        "target_type": target_type,
        "targets": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/tag-summary")
async def get_tag_summary():
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    return {"tags": await _tag_store.get_tag_stats()}


@app.get("/api/tag-targets/{target_type}/{target_ref:path}/tags", response_model=TagTargetBundleResponse)
async def get_target_tags(
    target_type: str,
    target_ref: str,
    anchor_json: Optional[str] = Query(None),
):
    if not _tag_store:
        raise HTTPException(status_code=503, detail="Tag store not initialized")
    bundle = await _tag_store.get_target_bundle(
        target_type,
        target_ref,
        anchor=json.loads(anchor_json) if anchor_json else None,
    )
    return TagTargetBundleResponse(
        target_type=target_type,
        target_ref=target_ref,
        direct_tags=bundle.direct_tags,
        inherited_tags=bundle.inherited_tags,
        aggregated_tags=bundle.aggregated_tags,
    )


@app.get("/api/email/{message_id}/tags")
async def get_email_tags(message_id: str):
    """获取邮件的标签列表。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    tags = await _storage.get_email_tags(message_id)
    return {"message_id": message_id, "tags": tags}


@app.post("/api/email/{message_id}/tags")
async def add_email_tag(message_id: str, request: TagAddRequest):
    """为邮件添加标签。

    单封邮件最多 16 个标签。
    """
    if not _storage or not _tag_store:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    # 确保标签存在（不存在则自动创建）
    await _tag_store.get_or_create_tag(request.tag_name)

    added = await _storage.add_email_tag(message_id, request.tag_name)
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
async def remove_email_tag(message_id: str, tag_name: str):
    """从邮件移除标签。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Storage not initialized")

    removed = await _storage.remove_email_tag(message_id, tag_name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Email {message_id} not found")

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

    query = SearchQuery(
        text=q,
        list_name=list_name,
        sender=sender,
        date_from=date_from,
        date_to=date_to,
        has_patch=has_patch,
        tags=tag_list,
        tag_mode=tag_mode,
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


@app.get("/api/ask", response_model=AskResponse)
async def ask(
    q: str = Query(..., min_length=1, description="问题"),
    list_name: Optional[str] = Query(None, description="限定邮件列表"),
    sender: Optional[str] = Query(None, description="发件人模糊匹配"),
    date_from: Optional[datetime] = Query(None, description="起始日期 (ISO 格式)"),
    date_to: Optional[datetime] = Query(None, description="结束日期 (ISO 格式)"),
    tags: Optional[str] = Query(None, description="标签列表（逗号分隔，如 memory,vm）"),
):
    """RAG 问答 — 基于邮件上下文回答问题。

    Pipeline: 问题 → 混合检索（支持作者/日期/标签过滤）→ 上下文构建 → LLM 生成（或 fallback 到摘要）

    支持高级过滤：
    - sender: 发件人模糊匹配
    - date_from/date_to: 日期范围过滤
    - tags: 标签过滤（逗号分隔）
    """
    if not _qa:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # 解析标签列表
    tag_list = None
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    answer = await _qa.ask(
        question=q,
        list_name=list_name,
        sender=sender,
        date_from=date_from,
        date_to=date_to,
        tags=tag_list,
    )

    return AskResponse(
        question=answer.question,
        answer=answer.answer,
        sources=[
            {
                "message_id": s.message_id,
                "subject": s.subject,
                "sender": s.sender,
                "date": s.date,
                "snippet": s.snippet,
            }
            for s in answer.sources
        ],
        model=answer.model,
        retrieval_mode=answer.retrieval_mode,
    )


@app.get("/api/thread/{thread_id:path}", response_model=ThreadResponse)
async def get_thread(thread_id: str):
    """获取邮件线程 — 返回线程内所有邮件及批注（按时间排序）。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    emails = await _storage.get_thread(thread_id)
    if not emails:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")

    # 获取线程批注
    annotations_data = []
    if _annotation_store:
        annotations = await _annotation_store.list_by_thread(thread_id)
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
        return TranslatedThreadsResponse(threads=[], total=0)


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
    annotation_type: str = Field("email", description="标注类型：email / code / sdm_spec ...")
    body: str = Field(..., min_length=1, description="批注正文（支持 Markdown）")
    author: str = Field("", description="批注作者（留空使用默认作者）")

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


class AnnotationResponse(BaseModel):
    """统一标注响应。"""
    annotation_id: str
    annotation_type: str = "email"
    author: str
    body: str
    parent_annotation_id: str = ""
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
        body=annotation.body,
        parent_annotation_id=annotation.parent_annotation_id,
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


@app.get("/api/annotations")
async def list_annotations(
    q: Optional[str] = Query(None, description="搜索关键词（模糊匹配批注正文）"),
    type: str = Query("all", description="批注类型过滤：'all' | 'email' | 'code'"),
    version: Optional[str] = Query(None, description="限定代码版本（code 类型时）"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """统一标注列表与搜索。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    try:
        if q and q.strip():
            annotations, total = await _annotation_store.search(
                keyword=q.strip(),
                annotation_type=type,
                page=page,
                page_size=page_size,
                extra_filters=[AnnotationORM.version == version] if type == "code" and version else None,
            )
        else:
            annotations, total = await _annotation_store.list_all(
                annotation_type=type,
                page=page,
                page_size=page_size,
                extra_filters=[AnnotationORM.version == version] if type == "code" and version else None,
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
async def create_annotation(request: AnnotationCreateRequest):
    """创建统一标注。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    parent_annotation_id = request.parent_annotation_id
    if not parent_annotation_id and request.in_reply_to.startswith(("annotation-", "code-annot-")):
        parent_annotation_id = request.in_reply_to

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
                author=request.author,
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
            )
        )
        return _annotation_to_response(annotation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/annotations/{thread_id:path}", response_model=list[AnnotationResponse])
async def get_annotations(thread_id: str):
    """获取线程所有批注（仅 email 类型）。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await _annotation_store.list_by_thread(thread_id)
    return [_annotation_to_response(a) for a in annotations]


@app.put("/api/annotations/{annotation_id}")
async def update_annotation(annotation_id: str, request: AnnotationUpdateRequest):
    """编辑批注。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    updated = await _annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str):
    """删除批注。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    deleted = await _annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return {"status": "ok", "message": f"Annotation {annotation_id} deleted"}


@app.post("/api/annotations/export")
async def export_annotations(
    thread_id: Optional[str] = Query(None, description="线程 ID（留空导出全部）"),
):
    """导出批注为 JSON（满足 git 固化需求）。

    - 指定 thread_id：导出单个线程的批注
    - 不指定：导出所有批注（按线程分组）
    """
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if thread_id:
        return await _annotation_store.export_thread(thread_id)
    else:
        return await _annotation_store.export_all()


@app.post("/api/annotations/import")
async def import_annotations(data: dict = Body(...)):
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
    in_reply_to: Optional[str] = Field(None, description="回复的父 annotation_id")


class CodeAnnotationUpdateRequest(BaseModel):
    """更新代码注释请求。"""
    body: str = Field(..., min_length=1, description="注释正文")


@app.get("/api/kernel/annotations")
async def list_code_annotations(
    q: Optional[str] = Query(None, description="搜索关键词"),
    version: Optional[str] = Query(None, description="限定版本"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """代码标注总览，基于统一 annotation store。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if q and q.strip():
        annotations, total = await _annotation_store.search(
            keyword=q.strip(),
            annotation_type="code",
            page=page,
            page_size=page_size,
            extra_filters=[AnnotationORM.version == version] if version else None,
        )
    else:
        annotations, total = await _annotation_store.list_all(
            annotation_type="code",
            page=page,
            page_size=page_size,
            extra_filters=[AnnotationORM.version == version] if version else None,
        )

    return {
        "annotations": annotations,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/kernel/annotations/{version}/{path:path}")
async def get_file_code_annotations(version: str, path: str):
    """获取指定文件的注释列表。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await _annotation_store.list_by_code(version, path)
    return [_annotation_to_response(a).model_dump() for a in annotations]


@app.post("/api/kernel/annotations")
async def create_code_annotation(request: CodeAnnotationCreateRequest):
    """创建代码注释。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    try:
        annotation = await _annotation_store.create(
            AnnotationCreate(
                annotation_type="code",
                body=request.body,
                author=request.author or "",
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
        )
        return _annotation_to_response(annotation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/kernel/annotations/{annotation_id}")
async def update_code_annotation(annotation_id: str, request: CodeAnnotationUpdateRequest):
    """更新代码注释正文。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    updated = await _annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@app.delete("/api/kernel/annotations/{annotation_id}")
async def delete_code_annotation(annotation_id: str):
    """删除代码注释。"""
    if not _annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    deleted = await _annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return {"status": "ok", "annotation_id": annotation_id}

"""FastAPI 服务层 — 提供搜索、问答、线程查询接口。"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from src.qa.rag_qa import RagQA
from src.retriever.base import SearchQuery
from src.retriever.hybrid import HybridRetriever
from src.retriever.keyword import KeywordRetriever
from src.retriever.semantic import SemanticRetriever
from src.storage.models import EmailRead
from src.storage.postgres import PostgresStorage

logger = logging.getLogger(__name__)

# ============================================================
# 全局组件（在 lifespan 中初始化）
# ============================================================
_storage: Optional[PostgresStorage] = None
_retriever: Optional[HybridRetriever] = None
_qa: Optional[RagQA] = None


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
    global _storage, _retriever, _qa

    config = _load_config()
    storage_cfg = config.get("storage", {})
    retriever_cfg = config.get("retriever", {})
    qa_cfg = config.get("qa", {})
    indexer_cfg = config.get("indexer", {})

    database_url = storage_cfg.get("database_url")
    if not database_url:
        raise RuntimeError("storage.database_url not configured in settings.yaml")

    # 初始化存储层
    _storage = PostgresStorage(
        database_url=database_url,
        pool_size=storage_cfg.get("pool_size", 5),
    )
    await _storage.init_db()

    # 初始化检索层
    keyword_retriever = KeywordRetriever(storage=_storage)
    semantic_retriever = SemanticRetriever(
        database_url=database_url,
        model=indexer_cfg.get("vector", {}).get("model", "text-embedding-3-small"),
        enabled=indexer_cfg.get("vector", {}).get("enabled", False),
    )
    _retriever = HybridRetriever(
        keyword_retriever=keyword_retriever,
        semantic_retriever=semantic_retriever,
    )

    # 初始化问答层
    _qa = RagQA(
        retriever=_retriever,
        storage=_storage,
        llm_provider=qa_cfg.get("llm_provider", "openai"),
        model=qa_cfg.get("model", "gpt-4"),
        api_key=qa_cfg.get("api_key", ""),
    )

    logger.info("API server initialized successfully")
    yield

    # 关闭资源
    if _storage:
        await _storage.close()
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
# Pydantic 响应模型
# ============================================================

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
    total: int


class StatsResponse(BaseModel):
    """统计信息响应。"""
    total_emails: int
    lists: dict


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
    """
    if not _retriever:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # 至少要有关键词或过滤条件
    if not q.strip() and not sender and not date_from and not date_to and has_patch is None:
        raise HTTPException(status_code=400, detail="At least one search condition is required")

    query = SearchQuery(
        text=q,
        list_name=list_name,
        sender=sender,
        date_from=date_from,
        date_to=date_to,
        has_patch=has_patch,
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
):
    """RAG 问答 — 基于邮件上下文回答问题。

    Pipeline: 问题 → 混合检索 → 上下文构建 → LLM 生成（或 fallback 到摘要）
    """
    if not _qa:
        raise HTTPException(status_code=503, detail="Service not initialized")

    answer = await _qa.ask(question=q, list_name=list_name)

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
    """获取邮件线程 — 返回线程内所有邮件（按时间排序）。"""
    if not _storage:
        raise HTTPException(status_code=503, detail="Service not initialized")

    emails = await _storage.get_thread(thread_id)
    if not emails:
        raise HTTPException(status_code=404, detail=f"Thread not found: {thread_id}")

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
                "has_patch": e.has_patch,
                "body": e.body[:500],  # 限制 body 长度
            }
            for e in emails
        ],
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
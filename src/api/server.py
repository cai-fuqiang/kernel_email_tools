"""FastAPI 服务层 — 生命周期管理、依赖注入、路由注册。

Route handlers are in src/api/routers/ — one file per domain.
Shared dependencies are in src/api/deps.py.
Global state is in src/api/state.py.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from src.api import state
from src.api.deps import _maybe_bootstrap_admin, _maybe_bootstrap_agent
from src.api.routers.agent import router as agent_router
from src.api.routers.annotations import router as annotations_router
from src.api.routers.ask import router as ask_router
from src.api.routers.auth import router as auth_router
from src.api.routers.kernel import router as kernel_router
from src.api.routers.knowledge import router as knowledge_router
from src.api.routers.manual import router as manual_router
from src.api.routers.search import router as search_router
from src.api.routers.system import router as system_router
from src.api.routers.tags import router as tags_router
from src.api.routers.translations import router as translations_router

from src.qa.ask_agent import AskAgent
from src.qa.manual_qa import ManualQA
from src.qa.providers import ChatLLMClient, DashScopeEmbeddingProvider, resolve_api_key
from src.retriever.hybrid import HybridRetriever
from src.retriever.keyword import KeywordRetriever
from src.retriever.manual import ManualRetriever
from src.retriever.semantic import SemanticRetriever
from src.storage.document_store import DocumentStorage
from src.storage.models import EmailORM
from src.agent.research_service import AgentResearchService
from src.storage.agent_store import AgentStore
from src.storage.ask_store import AskStore
from src.storage.knowledge_store import KnowledgeStore
from src.storage.postgres import PostgresStorage
from src.storage.tag_store import TagStore
from src.storage.translation_cache import TranslationCacheStore
from src.storage.annotation_store import AnnotationStore
from src.kernel_source.elixir import ElixirSource
from src.kernel_source.fallback import FallbackKernelSource
from src.kernel_source.git_local import GitLocalSource
from src.translator.google_translator import GoogleTranslator, is_available as is_translator_available

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理：启动时初始化组件，关闭时释放资源。"""
    config = state._load_config()
    storage_cfg = config.get("storage", {})
    retriever_cfg = config.get("retriever", {})
    qa_cfg = config.get("qa", {})
    indexer_cfg = config.get("indexer", {})
    state._auth_config = config.get("auth", {})
    state._app_config = config

    # ========== 邮件存储初始化 ==========
    email_storage_cfg = storage_cfg.get("email", {})
    email_database_url = email_storage_cfg.get("database_url")
    if not email_database_url:
        raise RuntimeError("storage.email.database_url not configured in settings.yaml")

    state._storage = PostgresStorage(
        database_url=email_database_url,
        pool_size=email_storage_cfg.get("pool_size", 5),
    )
    await state._storage.init_db()
    await _maybe_bootstrap_admin()
    state._agent_user = await _maybe_bootstrap_agent()
    state._agent_store = AgentStore(state._storage.session_factory)
    recovered_runs = await state._agent_store.fail_running_runs_after_restart()
    if recovered_runs:
        logger.warning("Marked %d stale AI agent run(s) failed after restart", recovered_runs)

    # 初始化标签存储
    state._tag_store = TagStore(
        session_factory=state._storage.session_factory,
        default_actor=config.get("annotations", {}).get("default_author", "me"),
    )

    # 初始化 LLM 客户端
    email_qa_cfg = qa_cfg.get("email", qa_cfg)
    state._llm_client = ChatLLMClient(
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
            logger.warning("Unsupported embedding provider: %s", embedding_provider_name)

    # 初始化检索层
    keyword_retriever = KeywordRetriever(storage=state._storage)
    semantic_retriever = SemanticRetriever(
        database_url=email_database_url,
        model=vector_cfg.get("model", "text-embedding-3-small"),
        enabled=vector_cfg.get("enabled", False),
        storage=state._storage,
        embedding_provider=embedding_provider,
        embedding_provider_name=vector_cfg.get("provider", "dashscope"),
    )
    state._retriever = HybridRetriever(
        keyword_retriever=keyword_retriever,
        semantic_retriever=semantic_retriever,
    )

    state._qa = AskAgent(
        storage=state._storage,
        retriever=state._retriever,
        llm=state._llm_client,
        embedding_provider=embedding_provider,
        embedding_provider_name=vector_cfg.get("provider", "dashscope"),
    )
    logger.info("Mail Ask agent initialized")

    # ========== 翻译组件初始化 ==========
    translator_cfg = config.get("translator", {})
    if is_translator_available():
        proxy_cfg = translator_cfg.get("proxy", {})
        proxy_enabled = proxy_cfg.get("enabled", False)
        proxy_http = proxy_cfg.get("http", "") if proxy_enabled else ""
        proxy_https = proxy_cfg.get("https", "") if proxy_enabled else ""

        state._translator = GoogleTranslator(
            timeout=translator_cfg.get("google", {}).get("timeout", 10),
            proxy_http=proxy_http,
            proxy_https=proxy_https,
        )
        state._translation_cache = TranslationCacheStore(
            session_factory=state._storage.session_factory
        )
        logger.info(f"Translation service initialized (proxy: {proxy_enabled})")
    else:
        logger.warning("Translation service not available")

    # ========== 批注组件初始化 ==========
    annotations_cfg = config.get("annotations", {})
    state._annotation_store = AnnotationStore(
        session_factory=state._storage.session_factory,
        default_author=annotations_cfg.get("default_author", "me"),
    )
    logger.info("Annotation store initialized")

    state._knowledge_store = KnowledgeStore(state._storage.session_factory)
    state._qa.knowledge_store = state._knowledge_store
    state._ask_store = AskStore(state._storage.session_factory)
    state._agent_service = AgentResearchService(
        agent_store=state._agent_store,
        knowledge_store=state._knowledge_store,
        retriever=state._retriever,
        llm_client=state._llm_client,
        qa=state._qa,
        agent_user_id=state._agent_user.user_id if state._agent_user else "agent:lobster-agent",
        agent_name=state._agent_user.display_name if state._agent_user else "Lobster Research Agent",
    )
    logger.info("Knowledge store initialized")

    # ========== 芯片手册存储初始化 ==========
    manual_storage_cfg = storage_cfg.get("manual", {})
    manual_database_url = manual_storage_cfg.get("database_url")
    if manual_database_url:
        state._manual_storage = DocumentStorage(
            database_url=manual_database_url,
            pool_size=manual_storage_cfg.get("pool_size", 5),
        )
        await state._manual_storage.init_db()
        state._manual_retriever = ManualRetriever(storage=state._manual_storage)
        manual_qa_cfg = qa_cfg.get("manual", qa_cfg)
        state._manual_qa = ManualQA(
            retriever=state._manual_retriever,
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
        expanded = os.path.expanduser(kernel_repo_path)
        if os.path.isdir(expanded):
            cache_cfg = kernel_cfg.get("cache", {})
            git_source = GitLocalSource(
                repo_path=kernel_repo_path,
                max_file_size=kernel_cfg.get("max_file_size", 1_048_576),
                tree_cache_size=cache_cfg.get("tree_cache_size", 256),
                file_cache_size=cache_cfg.get("file_cache_size", 128),
            )
            fallback_source = ElixirSource()
            state._kernel_source = FallbackKernelSource(
                primary=git_source,
                fallback=fallback_source,
            )
            logger.info("Kernel source initialized: %s", kernel_repo_path)
        else:
            logger.warning("Kernel repo path not found: %s", expanded)
    else:
        logger.warning("Kernel source path not configured")

    yield

    # ========== 关闭清理 ==========
    if state._storage:
        await state._storage.close()
    if state._manual_storage:
        await state._manual_storage.close()


app = FastAPI(
    title="Kernel Email Knowledge Base",
    description="Linux kernel mailing list knowledge base with dual-engine retrieval",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: allow frontend dev server and production
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Domain routers — routes are self-contained with full paths
app.include_router(auth_router)
app.include_router(tags_router)
app.include_router(search_router)
app.include_router(ask_router)
app.include_router(translations_router)
app.include_router(annotations_router)
app.include_router(manual_router)
app.include_router(kernel_router)
app.include_router(knowledge_router)
app.include_router(agent_router)
app.include_router(system_router)

# Serve static frontend files if available
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'web', 'dist')
if os.path.isdir(static_dir):
    @app.get('/app/{path:path}')
    async def serve_spa(path: str):
        file_path = os.path.join(static_dir, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, 'index.html'))
    app.mount('/app/assets', StaticFiles(directory=os.path.join(static_dir, 'assets')), name='assets')

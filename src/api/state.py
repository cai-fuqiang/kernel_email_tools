"""Global application state — singleton instances initialized during lifespan.

All route modules import state from here rather than maintaining their own globals.
"""

import logging
from pathlib import Path
from typing import Optional, TYPE_CHECKING

import yaml

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from src.qa.ask_agent import AskAgent
    from src.qa.manual_qa import ManualQA
    from src.qa.providers import ChatLLMClient
    from src.retriever.hybrid import HybridRetriever
    from src.storage.agent_store import AgentStore
    from src.storage.annotation_store import AnnotationStore
    from src.storage.ask_store import AskStore
    from src.storage.document_store import DocumentStorage
    from src.storage.knowledge_store import KnowledgeStore
    from src.storage.postgres import PostgresStorage
    from src.storage.tag_store import TagStore
    from src.storage.translation_cache import TranslationCacheStore
    from src.kernel_source.base import BaseKernelSource
    from src.translator.google_translator import GoogleTranslator
    from src.agent.research_service import AgentResearchService

# ============================================================
# Global service singletons (initialized in lifespan)
# ============================================================

_storage: Optional["PostgresStorage"] = None
_retriever: Optional["HybridRetriever"] = None
_llm_client: Optional["ChatLLMClient"] = None
_qa: Optional["AskAgent"] = None
_tag_store: Optional["TagStore"] = None

_manual_storage: Optional["DocumentStorage"] = None
_manual_retriever: Optional["ManualRetriever"] = None
_manual_qa: Optional["ManualQA"] = None

_translator: Optional["GoogleTranslator"] = None
_translation_cache: Optional["TranslationCacheStore"] = None
_translation_jobs: dict[str, dict] = {}
_translation_jobs_by_thread: dict[str, str] = {}

_annotation_store: Optional["AnnotationStore"] = None

_kernel_source: Optional["BaseKernelSource"] = None

_knowledge_store: Optional["KnowledgeStore"] = None

_ask_store: Optional["AskStore"] = None

_agent_store: Optional["AgentStore"] = None
_agent_user: Optional["CurrentUser"] = None  # CurrentUser defined in deps.py to avoid circular imports
_agent_service: Optional["AgentResearchService"] = None

# Config dictionaries (set in lifespan)
_auth_config: dict = {}
_app_config: dict = {}


def _load_config() -> dict:
    """加载配置文件。"""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "settings.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}

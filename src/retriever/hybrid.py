"""混合检索编排器 — 查询意图路由 + 结果融合。"""

import logging
from typing import Optional

from src.retriever.base import BaseRetriever, SearchHit, SearchQuery, SearchResult
from src.retriever.keyword import KeywordRetriever
from src.retriever.semantic import SemanticRetriever

logger = logging.getLogger(__name__)


class HybridRetriever(BaseRetriever):
    """混合检索编排器。

    根据查询意图自动路由到合适的检索引擎，并融合多引擎结果。

    路由策略：
    - 精确关键词查询（短查询、含特殊标记）→ 仅关键词检索
    - 语义问题（自然语言句）→ 关键词 + 语义检索，结果融合
    - 语义引擎未启用时 → fallback 到仅关键词检索

    Attributes:
        keyword_retriever: 关键词检索器。
        semantic_retriever: 语义检索器。
    """

    # 问句关键词，用于判断是否为语义查询
    QUESTION_KEYWORDS = {
        "why", "how", "what", "when", "where", "who", "which",
        "explain", "describe", "compare", "difference", "summary",
        "为什么", "如何", "怎么", "什么", "哪个", "区别", "总结",
    }

    def __init__(
        self,
        keyword_retriever: KeywordRetriever,
        semantic_retriever: SemanticRetriever,
    ):
        """初始化 HybridRetriever。

        Args:
            keyword_retriever: 关键词检索器。
            semantic_retriever: 语义检索器。
        """
        self.keyword_retriever = keyword_retriever
        self.semantic_retriever = semantic_retriever

    def _is_semantic_query(self, text: str) -> bool:
        """判断查询是否适合语义检索。

        Args:
            text: 查询文本。

        Returns:
            True 表示适合语义检索（自然语言问句），False 表示仅需关键词检索。
        """
        text_lower = text.lower().strip()
        words = text_lower.split()

        # 空查询或单词查询 → 关键词
        if len(words) <= 2:
            return False

        # 以问号结尾 → 语义
        if text_lower.endswith("?") or text_lower.endswith("？"):
            return True

        # 首词为问句关键词 → 语义
        if words[0] in self.QUESTION_KEYWORDS:
            return True

        # 包含问句关键词 → 可能是语义
        if any(w in self.QUESTION_KEYWORDS for w in words):
            return True

        return False

    async def search(self, query: SearchQuery) -> SearchResult:
        """执行混合检索。

        根据查询意图路由到合适的检索引擎。

        Args:
            query: 检索查询参数。

        Returns:
            检索结果集，mode='hybrid'。
        """
        is_semantic = self._is_semantic_query(query.text)

        # 始终执行关键词检索
        keyword_result = await self.keyword_retriever.search(query)

        # 如果是语义查询且语义引擎已启用，同时执行语义检索
        if is_semantic and self.semantic_retriever.enabled:
            semantic_result = await self.semantic_retriever.search(query)
            merged = self._merge_results(keyword_result, semantic_result, query)
            logger.info(
                "Hybrid search '%s': keyword=%d, semantic=%d, merged=%d",
                query.text,
                len(keyword_result.hits),
                len(semantic_result.hits),
                len(merged.hits),
            )
            return merged

        # 仅关键词结果
        logger.info(
            "Hybrid search '%s': keyword-only (%d hits, semantic %s)",
            query.text,
            len(keyword_result.hits),
            "disabled" if not self.semantic_retriever.enabled else "not needed",
        )
        return SearchResult(
            hits=keyword_result.hits,
            total=keyword_result.total,
            query=query.text,
            mode="hybrid",
        )

    def _merge_results(
        self,
        keyword_result: SearchResult,
        semantic_result: SearchResult,
        query: SearchQuery,
    ) -> SearchResult:
        """融合关键词和语义检索结果。

        使用 RRF（Reciprocal Rank Fusion）算法合并排名。

        Args:
            keyword_result: 关键词检索结果。
            semantic_result: 语义检索结果。
            query: 原始查询。

        Returns:
            融合后的检索结果。
        """
        k = 60  # RRF 常数
        scores: dict[str, float] = {}
        hit_map: dict[str, SearchHit] = {}

        # 关键词结果 RRF 分数
        for rank, hit in enumerate(keyword_result.hits):
            rrf_score = 1.0 / (k + rank + 1)
            scores[hit.message_id] = scores.get(hit.message_id, 0) + rrf_score
            hit_map[hit.message_id] = hit

        # 语义结果 RRF 分数
        for rank, hit in enumerate(semantic_result.hits):
            rrf_score = 1.0 / (k + rank + 1)
            scores[hit.message_id] = scores.get(hit.message_id, 0) + rrf_score
            if hit.message_id not in hit_map:
                hit_map[hit.message_id] = hit

        # 按 RRF 分数降序排列
        sorted_ids = sorted(scores.keys(), key=lambda mid: scores[mid], reverse=True)

        # 分页
        start = (query.page - 1) * query.page_size
        end = start + query.page_size
        page_ids = sorted_ids[start:end]

        hits = []
        for mid in page_ids:
            hit = hit_map[mid]
            hit.score = scores[mid]
            hit.source = "hybrid"
            hits.append(hit)

        return SearchResult(
            hits=hits,
            total=len(sorted_ids),
            query=query.text,
            mode="hybrid",
        )
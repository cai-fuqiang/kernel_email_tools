"""L1 章节分片器 — 将章节树展平为 DocumentChunk 列表。"""

import logging
from typing import Optional

from src.chunker.base import BaseSectionChunker, ContentType, DocumentChunk, count_tokens
from src.parser.base import SectionNode

logger = logging.getLogger(__name__)


class SectionChunker(BaseSectionChunker):
    """L1：按章节结构将 SectionNode 树展平为 DocumentChunk。

    每个叶子节点（或内容非空的非叶子节点）生成一个初始分片。
    分片附带完整的层级路径前缀。
    """

    def __init__(
        self,
        manual_type: str = "intel_sdm",
        manual_version: str = "",
        token_model: str = "cl100k_base",
    ):
        self.manual_type = manual_type
        self.manual_version = manual_version
        self.token_model = token_model

    def split_sections(
        self,
        sections: list[SectionNode],
        volume: str = "",
        **kwargs,
    ) -> list[DocumentChunk]:
        """将章节树展平为分片列表。

        Args:
            sections: 顶层 SectionNode 列表。
            volume: 当前卷标识。

        Returns:
            DocumentChunk 列表（每个有内容的节一个分片）。
        """
        chunks: list[DocumentChunk] = []
        seq = 0
        for section in sections:
            seq = self._flatten(section, chunks, seq, path_parts=[], volume=volume)
        logger.info("L1 SectionChunker: %d chunks from %d sections", len(chunks), len(sections))
        return chunks

    def _flatten(
        self,
        node: SectionNode,
        chunks: list[DocumentChunk],
        seq: int,
        path_parts: list[str],
        volume: str,
    ) -> int:
        """递归展平章节节点。"""
        # 构建当前层级路径
        label = f"{node.number} {node.title}".strip() if node.number else node.title
        current_path = path_parts + [label]
        context_prefix = " > ".join(
            [f"{self.manual_type.upper()}"] + ([volume] if volume else []) + current_path
        )

        # 推断 chapter 标识
        chapter = ""
        for part in current_path:
            if part.lower().startswith("chapter") or (len(part.split(".")) == 1 and part[0].isdigit()):
                chapter = part
                break

        # 如果有内容，生成分片
        if node.content and node.content.strip():
            seq += 1
            tokens = count_tokens(node.content, self.token_model)
            chunks.append(DocumentChunk(
                chunk_id=f"{self.manual_type}:{node.number or seq}:{seq:05d}",
                manual_type=self.manual_type,
                manual_version=self.manual_version,
                volume=volume,
                chapter=chapter,
                section=node.number,
                section_title=node.title,
                content_type=ContentType.TEXT,  # L2 会重新识别
                content=node.content,
                context_prefix=context_prefix,
                page_start=node.page_start,
                page_end=node.page_end,
                token_count=tokens,
                metadata={
                    "table_count": len(node.tables),
                    "has_tables": bool(node.tables),
                    "tables_raw": node.tables,
                },
            ))

        # 递归子节点
        for child in node.children:
            seq = self._flatten(child, chunks, seq, current_path, volume)

        return seq
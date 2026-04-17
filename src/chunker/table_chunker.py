"""表格专用分片器。"""

import logging

from src.chunker.base import ContentType, DocumentChunk, count_tokens

logger = logging.getLogger(__name__)


class TableChunker:
    """表格分片器 — 将表格转为 Markdown 文本分片。

    策略：
    - 整表为一个分片（含表头+表名）
    - 超大表格按行分组切分，保留表头
    """

    def __init__(self, max_tokens: int = 1024, token_model: str = "cl100k_base"):
        self.max_tokens = max_tokens
        self.token_model = token_model

    def chunk_table(
        self, table: list[list[str]], parent: DocumentChunk, seq: int = 0,
    ) -> list[DocumentChunk]:
        """将单个表格转为分片。"""
        if not table:
            return []

        full_text = self._to_markdown(table)
        tokens = count_tokens(full_text, self.token_model)

        if tokens <= self.max_tokens:
            return [self._make(parent, full_text, seq)]

        # 超大表格：按行分组，保留表头
        header = table[0]
        chunks = []
        buffer_rows = [header]
        for row in table[1:]:
            buffer_rows.append(row)
            text = self._to_markdown(buffer_rows)
            if count_tokens(text, self.token_model) > self.max_tokens:
                # 输出（不含最后一行）
                out_text = self._to_markdown(buffer_rows[:-1])
                seq += 1
                chunks.append(self._make(parent, out_text, seq))
                buffer_rows = [header, row]
        if len(buffer_rows) > 1:
            seq += 1
            chunks.append(self._make(parent, self._to_markdown(buffer_rows), seq))
        return chunks

    def _to_markdown(self, table: list[list[str]]) -> str:
        lines = []
        for i, row in enumerate(table):
            lines.append(" | ".join(str(c) for c in row))
            if i == 0:
                lines.append(" | ".join("---" for _ in row))
        return "\n".join(lines)

    def _make(self, parent: DocumentChunk, content: str, seq: int) -> DocumentChunk:
        return DocumentChunk(
            chunk_id=f"{parent.chunk_id}:table_{seq}",
            manual_type=parent.manual_type,
            manual_version=parent.manual_version,
            volume=parent.volume,
            chapter=parent.chapter,
            section=parent.section,
            section_title=parent.section_title,
            content_type=ContentType.TABLE,
            content=content,
            context_prefix=parent.context_prefix,
            page_start=parent.page_start,
            page_end=parent.page_end,
            token_count=count_tokens(content, self.token_model),
        )
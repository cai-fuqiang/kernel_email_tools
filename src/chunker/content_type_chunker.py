"""L2 内容类型分片器 — 识别内容类型并差异化切分。"""

import logging
import re

from src.chunker.base import BaseContentTypeChunker, ContentType, DocumentChunk, count_tokens

logger = logging.getLogger(__name__)

# 指令参考页特征模式
INSTRUCTION_PATTERNS = [
    re.compile(r"\bOpcode\b.*\bInstruction\b", re.IGNORECASE),
    re.compile(r"\bDescription\b.*\bOperation\b", re.IGNORECASE),
    re.compile(r"^[A-Z]{2,}(?:cc|\/\w+)?\s*[-—]\s*\w+", re.MULTILINE),  # "MOV—Move"
]

# 寄存器位域特征
REGISTER_PATTERNS = [
    re.compile(r"\bBit(?:s)?\s+\d+", re.IGNORECASE),
    re.compile(r"\bField\b.*\bDescription\b", re.IGNORECASE),
    re.compile(r"\bMSR\b.*\b(?:Address|Index)\b", re.IGNORECASE),
]

# 伪代码特征
PSEUDOCODE_PATTERNS = [
    re.compile(r"^\s*IF\s+.+\s+THEN\b", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^\s*(?:DEST|SRC|TEMP)\s*(?:\[|←|:)", re.MULTILINE),
    re.compile(r"^\s*FI;?\s*$", re.MULTILINE),
]


class ContentTypeChunker(BaseContentTypeChunker):
    """L2：识别分片内容类型，按类型差异化再切分。

    策略：
    - 指令参考页 → 保持完整，不拆分
    - 表格 → 从文本中分离，整表一个分片
    - 寄存器 → 保持完整
    - 伪代码 → 提取为独立分片
    - 普通文本 → 按段落切分到 target_tokens
    """

    def __init__(self, target_tokens: int = 512, token_model: str = "cl100k_base"):
        self.target_tokens = target_tokens
        self.token_model = token_model

    def _detect_type(self, text: str) -> ContentType:
        """检测文本的内容类型。"""
        if any(p.search(text) for p in INSTRUCTION_PATTERNS):
            return ContentType.INSTRUCTION
        if any(p.search(text) for p in REGISTER_PATTERNS):
            return ContentType.REGISTER
        if any(p.search(text) for p in PSEUDOCODE_PATTERNS):
            return ContentType.PSEUDOCODE
        return ContentType.TEXT

    def split_by_type(self, chunk: DocumentChunk) -> list[DocumentChunk]:
        """对单个 L1 分片进行 L2 差异化切分。"""
        results: list[DocumentChunk] = []
        content = chunk.content
        if not content or not content.strip():
            return results

        # 1. 先分离表格（如果 metadata 中有 tables_raw）
        tables_raw = chunk.metadata.get("tables_raw", [])
        if tables_raw:
            for i, table in enumerate(tables_raw):
                table_text = self._table_to_text(table)
                if table_text.strip():
                    results.append(self._make_chunk(
                        chunk, table_text, ContentType.TABLE,
                        suffix=f"table_{i}",
                    ))

        # 2. 检测主体内容类型
        detected_type = self._detect_type(content)

        if detected_type == ContentType.INSTRUCTION:
            # 指令页：整体保留，不拆分
            results.append(self._make_chunk(chunk, content, ContentType.INSTRUCTION))
            return results

        if detected_type == ContentType.REGISTER:
            # 寄存器：整体保留
            results.append(self._make_chunk(chunk, content, ContentType.REGISTER))
            return results

        # 3. 提取伪代码块
        content, pseudocode_chunks = self._extract_pseudocode(chunk, content)
        results.extend(pseudocode_chunks)

        # 4. 普通文本：按段落切分
        if content.strip():
            text_chunks = self._split_text_by_paragraphs(chunk, content)
            results.extend(text_chunks)

        return results if results else [chunk]  # 至少返回原始分片

    def _split_text_by_paragraphs(
        self, parent: DocumentChunk, text: str
    ) -> list[DocumentChunk]:
        """按段落切分普通文本，目标约 target_tokens。"""
        paragraphs = re.split(r"\n\s*\n", text)
        chunks: list[DocumentChunk] = []
        buffer = ""
        seq = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            candidate = f"{buffer}\n\n{para}" if buffer else para
            tokens = count_tokens(candidate, self.token_model)

            if tokens > self.target_tokens and buffer:
                # 当前 buffer 已经够大，先输出
                seq += 1
                chunks.append(self._make_chunk(
                    parent, buffer, ContentType.TEXT, suffix=f"p{seq}",
                ))
                buffer = para
            else:
                buffer = candidate

        # 输出剩余
        if buffer.strip():
            seq += 1
            chunks.append(self._make_chunk(
                parent, buffer, ContentType.TEXT, suffix=f"p{seq}",
            ))

        return chunks

    def _extract_pseudocode(
        self, parent: DocumentChunk, text: str
    ) -> tuple[str, list[DocumentChunk]]:
        """从文本中提取伪代码块。返回 (剩余文本, 伪代码分片列表)。"""
        chunks: list[DocumentChunk] = []
        # 简单策略：匹配 IF...FI 或缩进代码块
        pattern = re.compile(
            r"((?:^[ \t]+(?:IF|DEST|SRC|TEMP|ELSE|FI|DO|OD|CASE).*\n?)+)",
            re.MULTILINE | re.IGNORECASE,
        )
        seq = 0
        for m in pattern.finditer(text):
            code = m.group(0).strip()
            if count_tokens(code, self.token_model) > 20:  # 忽略太短的
                seq += 1
                chunks.append(self._make_chunk(
                    parent, code, ContentType.PSEUDOCODE, suffix=f"code_{seq}",
                ))
        remaining = pattern.sub("", text)
        return remaining, chunks

    def _table_to_text(self, table: list[list[str]]) -> str:
        """将二维表格转为 Markdown 风格文本。"""
        if not table:
            return ""
        lines = []
        for i, row in enumerate(table):
            lines.append(" | ".join(str(c) for c in row))
            if i == 0:
                lines.append(" | ".join("---" for _ in row))
        return "\n".join(lines)

    def _make_chunk(
        self, parent: DocumentChunk, content: str,
        content_type: ContentType, suffix: str = "",
    ) -> DocumentChunk:
        """基于父分片创建子分片。"""
        chunk_id = f"{parent.chunk_id}:{suffix}" if suffix else parent.chunk_id
        return DocumentChunk(
            chunk_id=chunk_id,
            manual_type=parent.manual_type,
            manual_version=parent.manual_version,
            volume=parent.volume,
            chapter=parent.chapter,
            section=parent.section,
            section_title=parent.section_title,
            content_type=content_type,
            content=content,
            context_prefix=parent.context_prefix,
            page_start=parent.page_start,
            page_end=parent.page_end,
            token_count=count_tokens(content, self.token_model),
        )
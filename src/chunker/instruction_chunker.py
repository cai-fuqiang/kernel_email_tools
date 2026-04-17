"""指令参考页专用分片器。"""

import logging
import re

from src.chunker.base import ContentType, DocumentChunk, count_tokens

logger = logging.getLogger(__name__)

# 指令页内部分段模式
INSTRUCTION_SECTIONS = [
    ("opcode_table", re.compile(r"(?:Opcode|Instruction|Op/En|Description)\s*\n", re.IGNORECASE)),
    ("description", re.compile(r"^Description\s*$", re.MULTILINE | re.IGNORECASE)),
    ("operation", re.compile(r"^Operation\s*$", re.MULTILINE | re.IGNORECASE)),
    ("flags", re.compile(r"^(?:Flags Affected|EFLAGS)\s*$", re.MULTILINE | re.IGNORECASE)),
    ("exceptions", re.compile(r"^(?:Protected Mode Exceptions|Real-Address Mode Exceptions|Exceptions)\s*$", re.MULTILINE | re.IGNORECASE)),
]


class InstructionChunker:
    """指令参考页分片器。

    策略：
    - 如果指令页 token 数 <= max_tokens，保持完整不拆
    - 如果超长，按逻辑段拆分：概述+操作码表 / 描述 / 伪代码 / 标志位 / 异常
    """

    def __init__(self, max_tokens: int = 1024, token_model: str = "cl100k_base"):
        self.max_tokens = max_tokens
        self.token_model = token_model

    def chunk_instruction(self, chunk: DocumentChunk) -> list[DocumentChunk]:
        """对指令参考页分片进行细分。"""
        content = chunk.content
        tokens = count_tokens(content, self.token_model)

        if tokens <= self.max_tokens:
            return [chunk]

        # 按逻辑段切分
        segments = self._split_instruction_sections(content)
        results = []
        for name, text in segments:
            if text.strip():
                results.append(DocumentChunk(
                    chunk_id=f"{chunk.chunk_id}:{name}",
                    manual_type=chunk.manual_type,
                    manual_version=chunk.manual_version,
                    volume=chunk.volume,
                    chapter=chunk.chapter,
                    section=chunk.section,
                    section_title=chunk.section_title,
                    content_type=ContentType.INSTRUCTION,
                    content=text.strip(),
                    context_prefix=chunk.context_prefix,
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    token_count=count_tokens(text, self.token_model),
                    metadata={"instruction_part": name},
                ))

        return results if results else [chunk]

    def _split_instruction_sections(self, text: str) -> list[tuple[str, str]]:
        """按逻辑段拆分指令页内容。"""
        # 收集所有分段点
        splits: list[tuple[int, str]] = [(0, "overview")]
        for name, pattern in INSTRUCTION_SECTIONS:
            for m in pattern.finditer(text):
                splits.append((m.start(), name))

        splits.sort(key=lambda x: x[0])

        # 去重：同一位置只保留第一个
        deduped = []
        seen_pos = set()
        for pos, name in splits:
            if pos not in seen_pos:
                deduped.append((pos, name))
                seen_pos.add(pos)
        splits = deduped

        # 切分
        segments = []
        for i, (pos, name) in enumerate(splits):
            end = splits[i + 1][0] if i + 1 < len(splits) else len(text)
            segments.append((name, text[pos:end]))

        return segments
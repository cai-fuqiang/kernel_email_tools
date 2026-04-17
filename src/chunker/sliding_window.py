"""L3 滑动窗口补偿 — 长文切分 + 短文合并 + 上下文前缀。"""

import logging

from src.chunker.base import ContentType, DocumentChunk, count_tokens

logger = logging.getLogger(__name__)


class SlidingWindowAdjuster:
    """L3：对 L2 输出进行长度补偿。

    - 过长分片（> max_tokens）→ 滑动窗口切分，重叠 overlap_ratio
    - 过短分片（< min_tokens）→ 与相邻同类型分片合并
    - 所有分片添加上下文前缀
    """

    def __init__(
        self,
        max_tokens: int = 1024,
        min_tokens: int = 128,
        overlap_ratio: float = 0.2,
        token_model: str = "cl100k_base",
    ):
        self.max_tokens = max_tokens
        self.min_tokens = min_tokens
        self.overlap_ratio = overlap_ratio
        self.token_model = token_model

    def adjust(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """对分片列表进行长度调整。"""
        # Step 1: 拆分过长分片
        split_chunks = []
        for chunk in chunks:
            if chunk.token_count > self.max_tokens:
                split_chunks.extend(self._split_long(chunk))
            else:
                split_chunks.append(chunk)

        # Step 2: 合并过短分片
        merged = self._merge_short(split_chunks)

        # Step 3: 添加上下文前缀并重算 token
        for chunk in merged:
            if chunk.context_prefix and not chunk.content.startswith(chunk.context_prefix):
                chunk.content = f"[{chunk.context_prefix}]\n\n{chunk.content}"
                chunk.token_count = count_tokens(chunk.content, self.token_model)

        logger.info(
            "L3 SlidingWindow: %d → %d chunks (split/merge/prefix)",
            len(chunks), len(merged),
        )
        return merged

    def _split_long(self, chunk: DocumentChunk) -> list[DocumentChunk]:
        """滑动窗口切分过长分片。"""
        text = chunk.content
        sentences = text.split("\n")
        if len(sentences) <= 1:
            # 无法按行切分，按字符切
            sentences = [text[i:i + 500] for i in range(0, len(text), 400)]

        results = []
        buffer = []
        buffer_tokens = 0
        overlap_target = int(self.max_tokens * self.overlap_ratio)
        seq = 0

        for sent in sentences:
            sent_tokens = count_tokens(sent, self.token_model)
            if buffer_tokens + sent_tokens > self.max_tokens and buffer:
                # 输出当前窗口
                seq += 1
                content = "\n".join(buffer)
                results.append(self._make_window(chunk, content, seq))

                # 保留重叠部分
                overlap_buf = []
                overlap_tok = 0
                for s in reversed(buffer):
                    t = count_tokens(s, self.token_model)
                    if overlap_tok + t > overlap_target:
                        break
                    overlap_buf.insert(0, s)
                    overlap_tok += t
                buffer = overlap_buf
                buffer_tokens = overlap_tok

            buffer.append(sent)
            buffer_tokens += sent_tokens

        if buffer:
            seq += 1
            results.append(self._make_window(chunk, "\n".join(buffer), seq))

        return results

    def _merge_short(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """合并相邻的过短分片（同类型 + 同 section）。"""
        if not chunks:
            return []

        merged = [chunks[0]]
        for chunk in chunks[1:]:
            prev = merged[-1]
            if (
                prev.token_count < self.min_tokens
                and chunk.content_type == prev.content_type
                and chunk.section == prev.section
            ):
                prev.content = f"{prev.content}\n\n{chunk.content}"
                prev.token_count = count_tokens(prev.content, self.token_model)
                prev.page_end = max(prev.page_end, chunk.page_end)
            else:
                merged.append(chunk)

        return merged

    def _make_window(self, parent: DocumentChunk, content: str, seq: int) -> DocumentChunk:
        return DocumentChunk(
            chunk_id=f"{parent.chunk_id}:w{seq}",
            manual_type=parent.manual_type,
            manual_version=parent.manual_version,
            volume=parent.volume,
            chapter=parent.chapter,
            section=parent.section,
            section_title=parent.section_title,
            content_type=parent.content_type,
            content=content,
            context_prefix=parent.context_prefix,
            page_start=parent.page_start,
            page_end=parent.page_end,
            token_count=count_tokens(content, self.token_model),
        )
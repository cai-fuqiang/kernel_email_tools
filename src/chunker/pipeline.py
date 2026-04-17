"""分片编排管线 — L1 → L2 → L3 三层编排。"""

import logging
from collections import Counter

from src.chunker.base import ContentType, DocumentChunk
from src.chunker.content_type_chunker import ContentTypeChunker
from src.chunker.instruction_chunker import InstructionChunker
from src.chunker.section_chunker import SectionChunker
from src.chunker.sliding_window import SlidingWindowAdjuster
from src.parser.base import SectionNode

logger = logging.getLogger(__name__)


class ChunkPipeline:
    """L1 → L2 → L3 分片编排管线。

    Usage:
        pipeline = ChunkPipeline(manual_type="intel_sdm")
        chunks = pipeline.process(section_tree)
    """

    def __init__(
        self,
        manual_type: str = "intel_sdm",
        manual_version: str = "",
        target_tokens: int = 512,
        max_tokens: int = 1024,
        min_tokens: int = 128,
        overlap_ratio: float = 0.2,
        token_model: str = "cl100k_base",
    ):
        self.section_chunker = SectionChunker(
            manual_type=manual_type,
            manual_version=manual_version,
            token_model=token_model,
        )
        self.content_type_chunker = ContentTypeChunker(
            target_tokens=target_tokens,
            token_model=token_model,
        )
        self.instruction_chunker = InstructionChunker(
            max_tokens=max_tokens,
            token_model=token_model,
        )
        self.sliding_window = SlidingWindowAdjuster(
            max_tokens=max_tokens,
            min_tokens=min_tokens,
            overlap_ratio=overlap_ratio,
            token_model=token_model,
        )

    def process(
        self, sections: list[SectionNode], volume: str = ""
    ) -> list[DocumentChunk]:
        """执行完整的三层分片管线。

        Args:
            sections: 章节树（来自 Parser 的输出）。
            volume: 卷标识。

        Returns:
            最终分片列表。
        """
        # L1: 按章节展平
        l1_chunks = self.section_chunker.split_sections(sections, volume=volume)
        logger.info("L1 output: %d chunks", len(l1_chunks))

        # L2: 按内容类型差异化切分
        l2_chunks = []
        for chunk in l1_chunks:
            typed = self.content_type_chunker.split_by_type(chunk)
            # 对指令类型进一步细分
            for tc in typed:
                if tc.content_type == ContentType.INSTRUCTION:
                    l2_chunks.extend(self.instruction_chunker.chunk_instruction(tc))
                else:
                    l2_chunks.append(tc)
        logger.info("L2 output: %d chunks", len(l2_chunks))

        # L3: 长度补偿 + 上下文前缀
        final = self.sliding_window.adjust(l2_chunks)
        logger.info("L3 output: %d chunks (final)", len(final))

        return final

    @staticmethod
    def print_stats(chunks: list[DocumentChunk]) -> None:
        """打印分片统计信息。"""
        if not chunks:
            print("No chunks to report.")
            return

        type_counts = Counter(c.content_type.value for c in chunks)
        token_counts = [c.token_count for c in chunks]
        avg_tokens = sum(token_counts) / len(token_counts)
        min_t = min(token_counts)
        max_t = max(token_counts)

        print(f"\n{'='*60}")
        print(f"  Chunk Statistics")
        print(f"{'='*60}")
        print(f"  Total chunks:     {len(chunks)}")
        print(f"  Avg tokens:       {avg_tokens:.0f}")
        print(f"  Min tokens:       {min_t}")
        print(f"  Max tokens:       {max_t}")
        print(f"\n  By content type:")
        for ct, count in sorted(type_counts.items()):
            print(f"    {ct:20s}: {count}")
        print(f"{'='*60}\n")
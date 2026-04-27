"""邮件 RAG chunk 构建器。"""

import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.storage.models import EmailChunkORM, EmailORM
from src.storage.postgres import PostgresStorage

logger = logging.getLogger(__name__)


@dataclass
class ChunkBuildConfig:
    """邮件分片配置。"""

    target_chars: int = 1800
    overlap_chars: int = 250
    min_chars: int = 120
    max_body_chars: int = 50000


class EmailChunkIndexer:
    """从 emails 表构建 email_chunks。"""

    def __init__(self, storage: PostgresStorage, config: Optional[ChunkBuildConfig] = None):
        self.storage = storage
        self.config = config or ChunkBuildConfig()

    async def rebuild(self, list_name: Optional[str] = None, batch_size: int = 500) -> int:
        """重建邮件 chunk。

        Args:
            list_name: 限定邮件列表，None 表示全部。
            batch_size: 每批读取邮件数量。

        Returns:
            写入 chunk 数量。
        """
        async with self.storage.session_factory() as session:
            delete_stmt = delete(EmailChunkORM)
            if list_name:
                delete_stmt = delete_stmt.where(EmailChunkORM.list_name == list_name)
            await session.execute(delete_stmt)
            await session.commit()

        total_chunks = 0
        offset = 0
        while True:
            async with self.storage.session_factory() as session:
                stmt = select(EmailORM).order_by(EmailORM.id.asc()).offset(offset).limit(batch_size)
                if list_name:
                    stmt = stmt.where(EmailORM.list_name == list_name)
                emails = (await session.execute(stmt)).scalars().all()
            if not emails:
                break

            rows = []
            for email in emails:
                for chunk_index, content in enumerate(self._split_body(email.body or "")):
                    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    chunk_id = hashlib.sha256(
                        f"{email.message_id}:{chunk_index}:{content_hash}".encode("utf-8")
                    ).hexdigest()[:32]
                    rows.append({
                        "chunk_id": chunk_id,
                        "message_id": email.message_id,
                        "thread_id": email.thread_id,
                        "list_name": email.list_name,
                        "subject": email.subject,
                        "sender": email.sender,
                        "date": email.date,
                        "chunk_index": chunk_index,
                        "content": content,
                        "content_hash": content_hash,
                    })

            if rows:
                async with self.storage.session_factory() as session:
                    stmt = pg_insert(EmailChunkORM).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_email_chunks_message_chunk",
                        set_={
                            "chunk_id": stmt.excluded.chunk_id,
                            "thread_id": stmt.excluded.thread_id,
                            "list_name": stmt.excluded.list_name,
                            "subject": stmt.excluded.subject,
                            "sender": stmt.excluded.sender,
                            "date": stmt.excluded.date,
                            "content": stmt.excluded.content,
                            "content_hash": stmt.excluded.content_hash,
                        },
                    )
                    await session.execute(stmt)
                    await session.commit()
                total_chunks += len(rows)

            offset += batch_size
            logger.info("Built email chunks: emails=%d chunks=%d", offset, total_chunks)

        return total_chunks

    def _split_body(self, body: str) -> list[str]:
        """将邮件正文切成适合 RAG 的自然段 chunk。"""
        body = self._strip_patch_tail(body or "")[: self.config.max_body_chars]
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", body) if p.strip()]
        chunks: list[str] = []
        current = ""

        for paragraph in paragraphs:
            if self._is_low_value_paragraph(paragraph):
                continue
            if not current:
                current = paragraph
                continue
            if len(current) + len(paragraph) + 2 <= self.config.target_chars:
                current = f"{current}\n\n{paragraph}"
            else:
                chunks.extend(self._split_large_text(current))
                current = paragraph

        if current:
            chunks.extend(self._split_large_text(current))

        return [chunk for chunk in chunks if len(chunk) >= self.config.min_chars]

    def _split_large_text(self, text: str) -> list[str]:
        if len(text) <= self.config.target_chars:
            return [text]
        chunks = []
        start = 0
        while start < len(text):
            end = min(len(text), start + self.config.target_chars)
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            if end >= len(text):
                break
            start = max(end - self.config.overlap_chars, start + 1)
        return chunks

    def _strip_patch_tail(self, body: str) -> str:
        markers = ["\n---\n", "\ndiff --git ", "\n@@ -"]
        cut_points = [body.find(marker) for marker in markers if body.find(marker) >= 0]
        if not cut_points:
            return body
        return body[: min(cut_points)].strip()

    def _is_low_value_paragraph(self, paragraph: str) -> bool:
        stripped = paragraph.strip()
        if not stripped:
            return True
        if stripped.startswith((">", "|")) and len(stripped) > 300:
            return True
        if stripped.startswith(("Signed-off-by:", "Reviewed-by:", "Acked-by:", "Tested-by:")):
            return True
        return False

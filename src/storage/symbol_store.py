"""内核符号索引存储层。"""

from collections.abc import Iterable

from sqlalchemy import and_, case, delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import KernelSymbolORM, KernelSymbolRead


class KernelSymbolStore:
    """提供 kernel_symbols 的写入和查询能力。"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._session_factory = session_factory

    async def replace_version(self, version: str, symbols: Iterable[dict], batch_size: int = 1000) -> int:
        rows = list(symbols)
        async with self._session_factory() as session:
            await session.execute(
                delete(KernelSymbolORM).where(KernelSymbolORM.version == version)
            )
            inserted = 0
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i + batch_size]
                session.add_all(KernelSymbolORM(**row) for row in batch)
                await session.flush()
                inserted += len(batch)
            await session.commit()
            return inserted

    async def find_definitions(
        self,
        version: str,
        symbol: str,
        current_path: str | None = None,
        limit: int = 20,
    ) -> list[KernelSymbolRead]:
        normalized = symbol.strip()
        if not normalized:
            return []

        order_same_file = case((KernelSymbolORM.file_path == (current_path or ""), 0), else_=1)
        order_kind = case(
            (KernelSymbolORM.kind == "function", 0),
            (KernelSymbolORM.kind == "macro", 1),
            (KernelSymbolORM.kind == "struct", 2),
            (KernelSymbolORM.kind == "enum", 3),
            (KernelSymbolORM.kind == "typedef", 4),
            else_=9,
        )

        async with self._session_factory() as session:
            result = await session.execute(
                select(KernelSymbolORM)
                .where(KernelSymbolORM.version == version)
                .where(KernelSymbolORM.symbol == normalized)
                .order_by(order_same_file, order_kind, KernelSymbolORM.file_path, KernelSymbolORM.line)
                .limit(limit)
            )
            return [KernelSymbolRead.model_validate(row) for row in result.scalars().all()]

    async def find_by_file(self, version: str, file_path: str) -> list[KernelSymbolRead]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(KernelSymbolORM)
                .where(
                    and_(
                        KernelSymbolORM.version == version,
                        KernelSymbolORM.file_path == file_path,
                    )
                )
                .order_by(KernelSymbolORM.line, KernelSymbolORM.column)
            )
            return [KernelSymbolRead.model_validate(row) for row in result.scalars().all()]

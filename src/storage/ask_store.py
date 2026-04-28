"""Ask 对话历史存储层。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.storage.models import (
    AskConversationListItem,
    AskConversationORM,
    AskConversationRead,
    AskTurnORM,
    AskTurnRead,
)


class AskStore:
    """Ask 对话会话与轮次的持久化。"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._session_factory = session_factory

    async def save_conversation(
        self,
        conversation_id: Optional[str],
        user_id: str,
        display_name: str,
        title: str,
        model: str,
        turns: list[dict],
    ) -> AskConversationRead:
        """保存或更新对话（按 conversation_id upsert）。

        Args:
            conversation_id: 已有会话 ID（更新）或 None（新建）。
            user_id: 用户 ID。
            display_name: 用户显示名。
            title: 会话标题（取首个问题）。
            model: 使用的模型。
            turns: 完整的问答轮次列表，每项包含 question, answer, sources 等。
        """
        async with self._session_factory() as session:
            now = datetime.utcnow()

            if conversation_id:
                conv_result = await session.execute(
                    select(AskConversationORM).where(
                        AskConversationORM.conversation_id == conversation_id,
                        AskConversationORM.user_id == user_id,
                    )
                )
                conv = conv_result.scalar_one_or_none()
                if conv is None:
                    conversation_id = None  # 指定的 ID 不存在，新建

            if conversation_id is None:
                conversation_id = uuid.uuid4().hex
                conv = AskConversationORM(
                    conversation_id=conversation_id,
                    user_id=user_id,
                    display_name=display_name,
                    title=title or "New conversation",
                    model=model,
                    turn_count=0,
                    created_at=now,
                    updated_at=now,
                )
                session.add(conv)
            else:
                conv.title = title or conv.title
                conv.model = model or conv.model
                conv.updated_at = now

            # 删除旧轮次，重新插入
            await session.execute(
                delete(AskTurnORM).where(
                    AskTurnORM.conversation_id == conversation_id
                )
            )

            turn_reads: list[AskTurnRead] = []
            for i, t in enumerate(turns):
                turn = AskTurnORM(
                    turn_id=uuid.uuid4().hex,
                    conversation_id=conversation_id,
                    turn_index=i,
                    question=str(t.get("question") or "")[:65536],
                    answer=str(t.get("answer") or "")[:65536],
                    sources=t.get("sources") if isinstance(t.get("sources"), list) else [],
                    search_plan=t.get("search_plan") if isinstance(t.get("search_plan"), dict) else {},
                    threads=t.get("threads") if isinstance(t.get("threads"), list) else [],
                    retrieval_stats=t.get("retrieval_stats") if isinstance(t.get("retrieval_stats"), dict) else {},
                    model=str(t.get("model") or model or ""),
                    error=str(t.get("error") or "")[:4096] if t.get("error") else None,
                    created_at=now,
                )
                session.add(turn)
                turn_reads.append(AskTurnRead(
                    turn_id=turn.turn_id,
                    turn_index=i,
                    question=turn.question,
                    answer=turn.answer,
                    sources=turn.sources,
                    search_plan=turn.search_plan,
                    threads=turn.threads,
                    retrieval_stats=turn.retrieval_stats,
                    model=turn.model,
                    error=turn.error,
                    created_at=now,
                ))

            conv.turn_count = len(turns)
            await session.commit()

            return AskConversationRead(
                conversation_id=conv.conversation_id,
                user_id=conv.user_id,
                display_name=conv.display_name,
                title=conv.title,
                model=conv.model,
                turn_count=conv.turn_count,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                turns=turn_reads,
            )

    async def list_conversations(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AskConversationListItem], int]:
        """列出用户的对话列表（按更新时间倒序）。"""
        async with self._session_factory() as session:
            stmt = (
                select(AskConversationORM)
                .where(AskConversationORM.user_id == user_id)
            )
            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0
            result = await session.execute(
                stmt.order_by(AskConversationORM.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            items = [
                AskConversationListItem(
                    conversation_id=row.conversation_id,
                    title=row.title,
                    model=row.model,
                    turn_count=row.turn_count,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                )
                for row in result.scalars().all()
            ]
            return items, total

    async def get_conversation(self, conversation_id: str) -> Optional[AskConversationRead]:
        """获取完整对话（含所有轮次）。"""
        async with self._session_factory() as session:
            conv_result = await session.execute(
                select(AskConversationORM).where(
                    AskConversationORM.conversation_id == conversation_id
                )
            )
            conv = conv_result.scalar_one_or_none()
            if conv is None:
                return None

            turns_result = await session.execute(
                select(AskTurnORM)
                .where(AskTurnORM.conversation_id == conversation_id)
                .order_by(AskTurnORM.turn_index.asc())
            )
            turns = [
                AskTurnRead(
                    turn_id=t.turn_id,
                    turn_index=t.turn_index,
                    question=t.question,
                    answer=t.answer,
                    sources=t.sources,
                    search_plan=t.search_plan,
                    threads=t.threads,
                    retrieval_stats=t.retrieval_stats,
                    model=t.model,
                    error=t.error,
                    created_at=t.created_at,
                )
                for t in turns_result.scalars().all()
            ]

            return AskConversationRead(
                conversation_id=conv.conversation_id,
                user_id=conv.user_id,
                display_name=conv.display_name,
                title=conv.title,
                model=conv.model,
                turn_count=conv.turn_count,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                turns=turns,
            )

    async def delete_conversation(self, conversation_id: str) -> bool:
        """删除对话及其所有轮次。"""
        async with self._session_factory() as session:
            conv_result = await session.execute(
                select(AskConversationORM).where(
                    AskConversationORM.conversation_id == conversation_id
                )
            )
            conv = conv_result.scalar_one_or_none()
            if conv is None:
                return False
            await session.execute(
                delete(AskTurnORM).where(
                    AskTurnORM.conversation_id == conversation_id
                )
            )
            await session.delete(conv)
            await session.commit()
            return True

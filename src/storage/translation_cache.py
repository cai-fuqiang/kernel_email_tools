"""翻译缓存存储 - 管理翻译结果缓存。"""

import hashlib
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, Integer, String, Text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.storage.postgres import Base

logger = logging.getLogger(__name__)


class TranslationCache(Base):
    """翻译缓存表 ORM 模型。"""
    
    __tablename__ = "translation_cache"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    source_hash = Column(String(64), unique=True, nullable=False, index=True)
    source_text = Column(Text, nullable=False)
    translated_text = Column(Text, nullable=False)
    source_lang = Column(String(10), nullable=False, default="auto")
    target_lang = Column(String(10), nullable=False, default="zh-CN")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    @classmethod
    def compute_hash(cls, text: str) -> str:
        """计算文本的 SHA256 哈希值。
        
        Args:
            text: 原始文本
            
        Returns:
            64字符的 SHA256 哈希值
        """
        return hashlib.sha256(text.encode("utf-8")).hexdigest()


class TranslationCacheStore:
    """翻译缓存存储器。
    
    提供翻译结果的缓存和查询功能，避免重复翻译相同内容。
    """
    
    # 单条翻译文本的最大长度限制
    MAX_TEXT_LENGTH = 5000
    
    def __init__(self, session: AsyncSession):
        """初始化缓存存储器。
        
        Args:
            session: SQLAlchemy 异步会话
        """
        self.session = session
    
    async def get(
        self,
        text: str,
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> Optional[str]:
        """查询翻译缓存。
        
        Args:
            text: 原始文本
            source_lang: 源语言
            target_lang: 目标语言
            
        Returns:
            缓存的翻译结果，未命中返回 None
        """
        source_hash = TranslationCache.compute_hash(text)
        
        stmt = select(TranslationCache).where(
            TranslationCache.source_hash == source_hash,
            TranslationCache.source_lang == source_lang,
            TranslationCache.target_lang == target_lang,
        )
        result = await self.session.execute(stmt)
        cached = result.scalar_one_or_none()
        
        if cached:
            logger.debug(f"Translation cache hit for hash: {source_hash[:16]}...")
            return cached.translated_text
        return None
    
    async def set(
        self,
        text: str,
        translated_text: str,
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> bool:
        """存储翻译结果到缓存。
        
        Args:
            text: 原始文本
            translated_text: 翻译后的文本
            source_lang: 源语言
            target_lang: 目标语言
            
        Returns:
            是否成功存储（可能因重复而跳过）
        """
        # 检查是否已存在
        existing = await self.get(text, source_lang, target_lang)
        if existing is not None:
            logger.debug(f"Translation already cached, skipping insert")
            return False
        
        source_hash = TranslationCache.compute_hash(text)
        cache_entry = TranslationCache(
            source_hash=source_hash,
            source_text=text[: self.MAX_TEXT_LENGTH],
            translated_text=translated_text,
            source_lang=source_lang,
            target_lang=target_lang,
        )
        
        self.session.add(cache_entry)
        await self.session.commit()
        logger.debug(f"Translation cached with hash: {source_hash[:16]}...")
        return True
    
    async def get_batch(
        self,
        texts: list[str],
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> dict[str, Optional[str]]:
        """批量查询翻译缓存。
        
        Args:
            texts: 原始文本列表
            source_lang: 源语言
            target_lang: 目标语言
            
        Returns:
            字典，key 为原文，value 为翻译结果（未命中为 None）
        """
        hashes = [TranslationCache.compute_hash(t) for t in texts]
        
        stmt = select(TranslationCache).where(
            TranslationCache.source_hash.in_(hashes),
            TranslationCache.source_lang == source_lang,
            TranslationCache.target_lang == target_lang,
        )
        result = await self.session.execute(stmt)
        cached_entries = result.scalars().all()
        
        # 构建缓存字典
        cache_map = {entry.source_text: entry.translated_text for entry in cached_entries}
        
        # 返回结果，未命中的为 None
        return {text: cache_map.get(text) for text in texts}
    
    async def set_batch(
        self,
        translations: list[tuple[str, str]],
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> int:
        """批量存储翻译结果。
        
        Args:
            translations: 元组列表 (原文, 翻译后文本)
            source_lang: 源语言
            target_lang: 目标语言
            
        Returns:
            成功存储的数量
        """
        count = 0
        for source_text, translated_text in translations:
            try:
                success = await self.set(
                    source_text, translated_text, source_lang, target_lang
                )
                if success:
                    count += 1
            except Exception as e:
                logger.warning(f"Failed to cache translation: {e}")
        
        return count

    async def delete(self, text_hash: str) -> bool:
        """删除单条缓存。

        Args:
            text_hash: 原文的 SHA256 哈希

        Returns:
            是否成功删除
        """
        from sqlalchemy import delete

        stmt = delete(TranslationCache).where(
            TranslationCache.source_hash == text_hash
        )
        result = await self.session.execute(stmt)
        await self.session.commit()

        deleted = result.rowcount > 0
        if deleted:
            logger.info(f"Deleted translation cache for hash: {text_hash[:16]}...")
        return deleted

    async def clear_all(self) -> int:
        """清除所有翻译缓存。

        Returns:
            删除的记录数
        """
        from sqlalchemy import delete, func

        # 先统计数量
        count_stmt = select(func.count()).select_from(TranslationCache)
        result = await self.session.execute(count_stmt)
        total = result.scalar() or 0

        # 再删除所有
        stmt = delete(TranslationCache)
        await self.session.execute(stmt)
        await self.session.commit()

        logger.info(f"Cleared all translation cache: {total} entries deleted")
        return total

    async def set_manual_translation(
        self,
        original_text: str,
        translated_text: str,
        source_lang: str = "en",
        target_lang: str = "zh-CN",
    ) -> str:
        """缓存人工翻译结果。

        Args:
            original_text: 原文
            translated_text: 人工翻译后的文本
            source_lang: 源语言
            target_lang: 目标语言

        Returns:
            缓存 key（原文哈希）
        """
        source_hash = TranslationCache.compute_hash(original_text)

        # 检查是否已存在，存在则更新
        stmt = select(TranslationCache).where(
            TranslationCache.source_hash == source_hash
        )
        result = await self.session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.translated_text = translated_text
            existing.source_lang = source_lang
            existing.target_lang = target_lang
            existing.created_at = datetime.utcnow()
            logger.info(f"Updated manual translation for hash: {source_hash[:16]}...")
        else:
            cache_entry = TranslationCache(
                source_hash=source_hash,
                source_text=original_text[: self.MAX_TEXT_LENGTH],
                translated_text=translated_text,
                source_lang=source_lang,
                target_lang=target_lang,
            )
            self.session.add(cache_entry)
            logger.info(f"Saved manual translation for hash: {source_hash[:16]}...")

        await self.session.commit()
        return source_hash


async def create_translation_cache_table(engine) -> None:
    """创建翻译缓存表。
    
    Args:
        engine: SQLAlchemy 引擎
    """
    from src.storage.postgres import Base
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Translation cache table created/verified")
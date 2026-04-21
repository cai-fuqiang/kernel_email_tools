"""翻译器抽象基类 - 定义翻译接口契约。"""

from abc import ABC, abstractmethod
from typing import Optional


class BaseTranslator(ABC):
    """翻译器抽象基类。
    
    所有翻译实现必须继承此类并实现 translate 方法。
    支持插件化设计，可替换不同翻译后端（Google/有道/DeepL等）。
    """

    @abstractmethod
    async def translate(
        self,
        text: str,
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> str:
        """翻译文本。
        
        Args:
            text: 原文文本
            source_lang: 源语言（默认 auto 自动检测）
            target_lang: 目标语言（默认 zh-CN 中文）
            
        Returns:
            翻译后的文本
            
        Raises:
            TranslationError: 翻译失败时抛出
        """
        pass

    @abstractmethod
    async def batch_translate(
        self,
        texts: list[str],
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> list[str]:
        """批量翻译文本。
        
        Args:
            texts: 原文文本列表
            source_lang: 源语言（默认 auto 自动检测）
            target_lang: 目标语言（默认 zh-CN 中文）
            
        Returns:
            翻译后的文本列表（顺序与输入一致）
        """
        pass


class TranslationError(Exception):
    """翻译错误异常。"""
    
    def __init__(self, message: str, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.original_error = original_error
"""翻译模块 - 提供邮件内容中英翻译功能。"""

from .base import BaseTranslator
from .google_translator import GoogleTranslator

__all__ = ["BaseTranslator", "GoogleTranslator"]
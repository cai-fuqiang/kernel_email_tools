"""Google Translate 翻译器实现 - 直接调用 Google Translate API。"""

import asyncio
import logging
import urllib.request
import urllib.parse
import json
from typing import Optional

from .base import BaseTranslator, TranslationError

logger = logging.getLogger(__name__)


class GoogleTranslator(BaseTranslator):
    """Google Translate 翻译器。
    
    直接调用 Google Translate API，无需 API key。
    支持代理配置。
    
    Args:
        timeout: 请求超时时间（秒）
        proxy_http: HTTP 代理地址（如 http://127.0.0.1:7890）
        proxy_https: HTTPS 代理地址
    """

    def __init__(
        self,
        timeout: int = 10,
        proxy_http: str = "",
        proxy_https: str = "",
    ):
        self.timeout = timeout
        self.proxy_http = proxy_http
        self.proxy_https = proxy_https or proxy_http  # 默认 HTTPS 使用 HTTP 代理

    async def translate(
        self,
        text: str,
        source_lang: str = "auto",
        target_lang: str = "zh-CN",
    ) -> str:
        """翻译单段文本。
        
        Args:
            text: 原文文本
            source_lang: 源语言（默认 auto 自动检测）
            target_lang: 目标语言（默认 zh-CN 中文）
            
        Returns:
            翻译后的文本
            
        Raises:
            TranslationError: 翻译失败时抛出
        """
        if not text or not text.strip():
            return text

        # 清理语言代码
        source = _map_language_code(source_lang)
        target = _map_language_code(target_lang)

        return await asyncio.to_thread(self._translate_direct_sync, text, source, target)

    def _translate_direct_sync(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
    ) -> str:
        """直接调用 Google Translate API。
        
        Args:
            text: 原文
            source_lang: 源语言
            target_lang: 目标语言
            
        Returns:
            翻译结果
            
        Raises:
            TranslationError: 翻译失败时抛出
        """
        # 清理文本中的换行符和多余空格
        clean_text = ' '.join(text.split())
        
        # 确保目标语言是 zh-CN 或 zh
        if target_lang not in ("zh-CN", "zh"):
            target_lang = "zh-CN"
        
        # Google Translate API 端点（无需 API key）
        url = "https://translate.googleapis.com/translate_a/single"
        
        params = {
            'client': 'gtx',
            'sl': source_lang,
            'tl': target_lang,
            'dt': 't',
            'ie': 'UTF-8',  # 输入编码
            'oe': 'UTF-8',  # 输出编码
            'q': clean_text
        }
        
        url_with_params = f"{url}?{urllib.parse.urlencode(params)}"
        
        try:
            req = urllib.request.Request(
                url_with_params,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            )
            
            # 配置代理
            if self.proxy_https:
                proxy_handler = urllib.request.ProxyHandler({
                    'http': self.proxy_http,
                    'https': self.proxy_https,
                })
                opener = urllib.request.build_opener(proxy_handler)
                logger.debug(f"Using proxy: {self.proxy_https}")
            else:
                opener = urllib.request.build_opener()
            
            with opener.open(req, timeout=self.timeout) as response:
                raw = response.read().decode('utf-8')
                result = json.loads(raw)
                
                # Google Translate API 返回格式：
                # [[translations], original, lang, ...]
                # translations 是嵌套数组 [[text, src_text, null, null, 3], ...]
                if result and len(result) > 0:
                    translations = []
                    first_elem = result[0]
                    
                    if isinstance(first_elem, list):
                        # 遍历每个翻译片段
                        for item in first_elem:
                            if isinstance(item, list) and len(item) > 0:
                                trans = item[0]
                                if trans:
                                    translations.append(trans)
                    
                    if translations:
                        result_text = ''.join(translations)
                        logger.debug(f"Translation API raw response: {raw[:200]}...")
                        return result_text
                
                logger.warning(f"Empty translation result for: '{clean_text[:50]}...'")
                return text
                
        except Exception as e:
            logger.error(f"Direct translation API failed: {e}")
            raise TranslationError(f"Translation failed: {str(e)}", original_error=e)

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
            翻译后的文本列表
        """
        if not texts:
            return []

        results = []
        for text in texts:
            if not text or not text.strip():
                results.append(text)
            else:
                try:
                    translation = await self.translate(text, source_lang, target_lang)
                    results.append(translation)
                except Exception as e:
                    logger.warning(f"Failed to translate text: {e}")
                    results.append(text)  # 返回原文作为 fallback

        return results


def _map_language_code(code: str) -> str:
    """映射语言代码到 Google Translate 格式。
    
    Args:
        code: 标准语言代码
        
    Returns:
        Google Translate 兼容的语言代码
    """
    if code == "auto":
        return "auto"
    # Google Translate 使用 "zh-CN" 或 "zh"
    if code in ("zh-CN", "zh", "zh-TW", "zh-HK"):
        return "zh-CN"
    return code


def is_available() -> bool:
    """检查翻译器是否可用。"""
    return True

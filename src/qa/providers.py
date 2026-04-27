"""LLM 与 embedding provider 工具。"""

import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


def resolve_api_key(provider: str, configured_key: str = "") -> str:
    """按环境变量优先级解析 API key。"""
    env_var_map = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "dashscope": "DASHSCOPE_API_KEY",
        "minimax": "MINIMAX_API_KEY",
    }
    return os.environ.get(env_var_map.get(provider, "")) or configured_key or ""


class DashScopeEmbeddingProvider:
    """DashScope OpenAI-compatible embeddings provider。"""

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-v3",
        dimension: int = 1536,
        base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.model = model
        self.dimension = dimension
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not self.api_key:
            raise RuntimeError("DashScope API key is required for embeddings")
        if not texts:
            return []

        payload: dict[str, Any] = {
            "model": self.model,
            "input": texts,
        }
        if self.dimension:
            payload["dimensions"] = self.dimension

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        items = sorted(data.get("data", []), key=lambda item: item.get("index", 0))
        embeddings = [item.get("embedding", []) for item in items]
        if len(embeddings) != len(texts) or any(not emb for emb in embeddings):
            raise RuntimeError("DashScope embedding response did not match input texts")
        return embeddings


class ChatLLMClient:
    """Small async chat client for AskAgent planning and answering."""

    def __init__(
        self,
        provider: str,
        model: str,
        api_key: str = "",
        timeout: float = 90.0,
    ):
        self.provider = provider
        self.model = model
        self.api_key = resolve_api_key(provider, api_key)
        self.timeout = timeout

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 1500,
    ) -> str:
        if not self.api_key:
            return ""
        try:
            if self.provider == "dashscope":
                return await self._complete_openai_compatible(
                    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                    system_prompt,
                    user_prompt,
                    temperature,
                    max_tokens,
                )
            if self.provider == "openai":
                from openai import AsyncOpenAI

                client = AsyncOpenAI(api_key=self.api_key)
                response = await client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("LLM call failed: %s", exc)
        return ""

    async def _complete_openai_compatible(
        self,
        url: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""


def parse_json_object(text: str) -> Optional[dict]:
    """Parse a JSON object from raw LLM text, accepting fenced output."""
    if not text:
        return None
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        stripped = stripped.removeprefix("json").strip()
    try:
        value = json.loads(stripped)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start >= 0 and end > start:
            try:
                value = json.loads(stripped[start : end + 1])
                return value if isinstance(value, dict) else None
            except json.JSONDecodeError:
                return None
    return None

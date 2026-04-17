"""手册问答 Pipeline — 基于文档检索的 RAG 问答。"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from src.qa.base import Answer, SourceReference
from src.retriever.manual import ManualRetriever, ManualSearchQuery

logger = logging.getLogger(__name__)

# RAG prompt 模板
MANUAL_SYSTEM_PROMPT = """You are an expert on chip architecture and processor manuals.
Answer the user's question based ONLY on the provided manual content.
If the context doesn't contain enough information, say so clearly.
Cite the specific section and page numbers when referencing information.
Keep your answer concise and technically accurate."""

MANUAL_USER_PROMPT_TEMPLATE = """Context from chip manual documents:

{context}

---

Question: {question}

Please answer based on the above manual content. Cite sources using [section: page] format."""


@dataclass
class ManualSourceReference:
    """手册来源引用。"""

    chunk_id: str
    section: str = ""
    section_title: str = ""
    manual_type: str = ""
    page_start: int = 0
    page_end: int = 0
    snippet: str = ""


@dataclass
class ManualAnswer:
    """手册问答结果。"""

    question: str
    answer: str = ""
    sources: list[ManualSourceReference] = field(default_factory=list)
    model: str = ""
    retrieval_mode: str = ""


class ManualQA:
    """手册文档 RAG 问答。

    Pipeline: 用户问题 → 文档检索 → 上下文构建 → LLM 生成 → 来源引用

    Attributes:
        retriever: 手册检索器。
        llm_provider: LLM 提供商。
        model: LLM 模型名称。
        max_context_chunks: 上下文最大分片数。
        max_context_chars: 上下文最大字符数。
    """

    def __init__(
        self,
        retriever: ManualRetriever,
        llm_provider: str = "openai",
        model: str = "gpt-4",
        api_key: str = "",
        max_context_chunks: int = 5,
        max_context_chars: int = 6000,
    ):
        """初始化 ManualQA。

        Args:
            retriever: 手册检索器。
            llm_provider: LLM 提供商。
            model: LLM 模型名称。
            api_key: API Key。
            max_context_chunks: 上下文最大分片数量。
            max_context_chars: 上下文最大字符数。
        """
        self.retriever = retriever
        self.llm_provider = llm_provider
        self.model = model
        self.api_key = api_key
        self.max_context_chunks = max_context_chunks
        self.max_context_chars = max_context_chars

    async def ask(
        self,
        question: str,
        manual_type: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> ManualAnswer:
        """回答问题。

        Args:
            question: 用户问题。
            manual_type: 限定手册类型。
            content_type: 限定内容类型。

        Returns:
            ManualAnswer 对象。
        """
        # 1. 检索相关文档
        search_query = ManualSearchQuery(
            text=question,
            manual_type=manual_type,
            content_type=content_type,
            page=1,
            page_size=self.max_context_chunks,
        )
        search_result = await self.retriever.search(search_query)

        if not search_result.hits:
            return ManualAnswer(
                question=question,
                answer="No relevant manual content found for your question.",
                sources=[],
                model=self.model,
                retrieval_mode=search_result.mode,
            )

        # 2. 构建上下文
        context_parts = []
        sources = []
        total_chars = 0

        for hit in search_result.hits:
            chunk_context = (
                f"[{hit.section}] {hit.section_title}\n"
                f"Manual: {hit.manual_type} | Pages: {hit.page_start + 1}-{hit.page_end + 1}\n"
                f"Content:\n{hit.content[:1500]}\n"
            )

            # 检查上下文字符数限制
            if total_chars + len(chunk_context) > self.max_context_chars:
                break

            context_parts.append(chunk_context)
            total_chars += len(chunk_context)

            sources.append(ManualSourceReference(
                chunk_id=hit.chunk_id,
                section=hit.section,
                section_title=hit.section_title,
                manual_type=hit.manual_type,
                page_start=hit.page_start,
                page_end=hit.page_end,
                snippet=hit.content[:300],
            ))

        context = "\n---\n".join(context_parts)

        # 3. 尝试调用 LLM
        answer_text = await self._call_llm(question, context)

        # 4. LLM 不可用时 fallback 到检索摘要
        if not answer_text:
            answer_text = self._build_fallback_answer(question, sources)

        return ManualAnswer(
            question=question,
            answer=answer_text,
            sources=sources,
            model=self.model,
            retrieval_mode=search_result.mode,
        )

    async def _call_llm(self, question: str, context: str) -> str:
        """调用 LLM 生成回答。"""
        import os

        # API Key 优先级：环境变量 > 配置文件
        env_var_map = {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "dashscope": "DASHSCOPE_API_KEY",
            "minimax": "MINIMAX_API_KEY",
        }
        api_key = os.environ.get(env_var_map.get(self.llm_provider, "")) or self.api_key or ""
        if not api_key:
            logger.info("No LLM API key found, using fallback")
            return ""

        try:
            if self.llm_provider == "openai":
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=api_key)
                response = await client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": MANUAL_SYSTEM_PROMPT},
                        {"role": "user", "content": MANUAL_USER_PROMPT_TEMPLATE.format(
                            context=context, question=question
                        )},
                    ],
                    temperature=0.7,
                    max_tokens=1000,
                )
                return response.choices[0].message.content or ""

            elif self.llm_provider == "anthropic":
                from anthropic import AsyncAnthropic
                client = AsyncAnthropic(api_key=api_key)
                response = await client.messages.create(
                    model=self.model,
                    max_tokens=1000,
                    system=MANUAL_SYSTEM_PROMPT,
                    messages=[
                        {"role": "user", "content": MANUAL_USER_PROMPT_TEMPLATE.format(
                            context=context, question=question
                        )},
                    ],
                )
                return response.content[0].text if response.content else ""

            elif self.llm_provider == "dashscope":
                import httpx
                async with httpx.AsyncClient() as client:
                    resp = await client.post(
                        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model or "qwen-plus",
                            "messages": [
                                {"role": "system", "content": MANUAL_SYSTEM_PROMPT},
                                {"role": "user", "content": MANUAL_USER_PROMPT_TEMPLATE.format(
                                    context=context, question=question
                                )},
                            ],
                            "temperature": 0.7,
                            "max_tokens": 1000,
                        },
                        timeout=60.0,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")

        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return ""

    def _build_fallback_answer(
        self, question: str, sources: list[ManualSourceReference]
    ) -> str:
        """构建 fallback 回答（当 LLM 不可用时）。"""
        if not sources:
            return "No relevant manual content found."

        lines = [
            f"Found {len(sources)} relevant section(s) for: \"{question}\"\n",
        ]
        for i, src in enumerate(sources, 1):
            lines.append(
                f"{i}. [{src.section}] {src.section_title}\n"
                f"   Manual: {src.manual_type} | Pages: {src.page_start + 1}-{src.page_end + 1}\n"
                f"   Preview: {src.snippet[:200]}...\n"
            )

        lines.append(
            "\n(LLM summarization not available. "
            "Configure an API key in settings.yaml to enable AI-powered answers.)"
        )
        return "\n".join(lines)
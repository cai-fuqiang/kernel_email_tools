"""RAG 问答 Pipeline — 检索 + LLM 生成 + 来源引用。"""

import logging
from typing import Optional

from src.qa.base import Answer, BaseQA, SourceReference
from src.retriever.base import SearchQuery, SearchResult
from src.retriever.hybrid import HybridRetriever
from src.storage.postgres import PostgresStorage

logger = logging.getLogger(__name__)

# RAG prompt 模板
RAG_SYSTEM_PROMPT = """You are an expert on Linux kernel development and mailing list discussions.
Answer the user's question based ONLY on the provided email context from kernel mailing lists.
If the context doesn't contain enough information, say so clearly.
Always cite the source emails by their Message-ID when referencing specific information.
Keep your answer concise and technically accurate."""

RAG_USER_PROMPT_TEMPLATE = """Context from kernel mailing list emails:

{context}

---

Question: {question}

Please answer based on the above email context. Cite sources using [Message-ID] format."""


class RagQA(BaseQA):
    """RAG 问答实现。

    Pipeline: 用户问题 → 混合检索 → 上下文构建 → LLM 生成 → 来源引用

    MVP 阶段：
    - 当 LLM 不可用时，返回检索结果摘要作为回答
    - LLM 可用时，走完整 RAG Pipeline

    Attributes:
        retriever: 混合检索器。
        storage: 存储层（用于获取邮件全文）。
        llm_provider: LLM 提供商（openai / anthropic）。
        model: LLM 模型名称。
        max_context_emails: RAG 上下文最大邮件数。
        max_context_chars: RAG 上下文最大字符数。
    """

    def __init__(
        self,
        retriever: HybridRetriever,
        storage: PostgresStorage,
        llm_provider: str = "openai",
        model: str = "gpt-4",
        api_key: str = "",
        max_context_emails: int = 10,
        max_context_chars: int = 8000,
    ):
        """初始化 RagQA。

        Args:
            retriever: 混合检索器。
            storage: 存储层实例。
            llm_provider: LLM 提供商。
            model: LLM 模型名称。
            api_key: API Key（环境变量优先）。
            max_context_emails: 上下文最大邮件数量。
            max_context_chars: 上下文最大字符数。
        """
        self.retriever = retriever
        self.storage = storage
        self.llm_provider = llm_provider
        self.model = model
        self.api_key = api_key
        self.max_context_emails = max_context_emails
        self.max_context_chars = max_context_chars

    async def ask(self, question: str, list_name: Optional[str] = None) -> Answer:
        """回答问题。

        Pipeline:
        1. 通过混合检索器获取相关邮件
        2. 从数据库获取邮件全文
        3. 构建 RAG 上下文
        4. 调用 LLM 生成回答（不可用时 fallback 到摘要）

        Args:
            question: 用户问题。
            list_name: 限定邮件列表。

        Returns:
            Answer 对象。
        """
        # 1. 检索相关邮件
        search_query = SearchQuery(
            text=question,
            list_name=list_name,
            page=1,
            page_size=self.max_context_emails,
            top_k=self.max_context_emails,
        )
        search_result = await self.retriever.search(search_query)

        if not search_result.hits:
            return Answer(
                question=question,
                answer="No relevant emails found for your question.",
                sources=[],
                model=self.model,
                retrieval_mode=search_result.mode,
            )

        # 2. 获取邮件全文构建上下文
        context_parts = []
        sources = []
        total_chars = 0

        for hit in search_result.hits:
            email_data = await self.storage.get_email(hit.message_id)
            if not email_data:
                continue

            # 截断单封邮件正文
            body_preview = email_data.body[:2000] if email_data.body else ""

            email_context = (
                f"[{email_data.message_id}]\n"
                f"Subject: {email_data.subject}\n"
                f"From: {email_data.sender}\n"
                f"Date: {email_data.date}\n"
                f"Body:\n{body_preview}\n"
            )

            # 检查上下文字符数限制
            if total_chars + len(email_context) > self.max_context_chars:
                break

            context_parts.append(email_context)
            total_chars += len(email_context)

            sources.append(SourceReference(
                message_id=email_data.message_id,
                subject=email_data.subject,
                sender=email_data.sender,
                date=email_data.date.isoformat() if email_data.date else "",
                snippet=hit.snippet or body_preview[:200],
            ))

        context = "\n---\n".join(context_parts)

        # 3. 尝试调用 LLM
        answer_text = await self._call_llm(question, context)

        # 4. LLM 不可用时 fallback 到检索摘要
        if not answer_text:
            answer_text = self._build_fallback_answer(question, sources)

        return Answer(
            question=question,
            answer=answer_text,
            sources=sources,
            model=self.model,
            retrieval_mode=search_result.mode,
        )

    async def _call_llm(self, question: str, context: str) -> str:
        """调用 LLM 生成回答。

        支持的提供商：
        - openai: OpenAI GPT 系列
        - anthropic: Anthropic Claude 系列
        - dashscope: 阿里云千问 (Qwen)
        - minimax: MiniMax 海螺 AI

        API Key 优先级：环境变量 > 配置文件

        Args:
            question: 用户问题。
            context: RAG 上下文。

        Returns:
            LLM 生成的回答文本，不可用时返回空字符串。
        """
        import os

        # API Key 优先级：环境变量 > 配置文件
        env_var_map = {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "dashscope": "DASHSCOPE_API_KEY",
            "minimax": "MINIMAX_API_KEY",
        }
        api_key = os.environ.get(env_var_map.get(self.llm_provider, "")) or getattr(self, "api_key", "") or ""
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
                        {"role": "system", "content": RAG_SYSTEM_PROMPT},
                        {"role": "user", "content": RAG_USER_PROMPT_TEMPLATE.format(
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
                    system=RAG_SYSTEM_PROMPT,
                    messages=[
                        {"role": "user", "content": RAG_USER_PROMPT_TEMPLATE.format(
                            context=context, question=question
                        )},
                    ],
                )
                return response.content[0].text if response.content else ""

            elif self.llm_provider == "dashscope":
                # 阿里云千问 (Qwen)
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
                                {"role": "system", "content": RAG_SYSTEM_PROMPT},
                                {"role": "user", "content": RAG_USER_PROMPT_TEMPLATE.format(
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

            elif self.llm_provider == "minimax":
                # MiniMax 海螺 AI
                import httpx
                async with httpx.AsyncClient() as client:
                    resp = await client.post(
                        "https://api.minimax.chat/v1/text/chatcompletion_v2",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model or "MiniMax-Text-01",
                            "messages": [
                                {"role": "system", "content": RAG_SYSTEM_PROMPT},
                                {"role": "user", "content": RAG_USER_PROMPT_TEMPLATE.format(
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
        self, question: str, sources: list[SourceReference]
    ) -> str:
        """构建 fallback 回答（当 LLM 不可用时）。

        基于检索结果生成结构化摘要。

        Args:
            question: 原始问题。
            sources: 来源引用列表。

        Returns:
            格式化的回答文本。
        """
        if not sources:
            return "No relevant emails found."

        lines = [
            f"Found {len(sources)} relevant email(s) for: \"{question}\"\n",
        ]
        for i, src in enumerate(sources, 1):
            lines.append(
                f"{i}. [{src.subject}]\n"
                f"   From: {src.sender} | Date: {src.date}\n"
                f"   Message-ID: {src.message_id}\n"
                f"   Preview: {src.snippet[:150]}...\n"
            )

        lines.append(
            "\n(LLM summarization not available. "
            "Configure an API key in settings.yaml to enable AI-powered answers.)"
        )
        return "\n".join(lines)
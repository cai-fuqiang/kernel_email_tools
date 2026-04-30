"""AI 邮件检索代理：规划检索、多路召回、thread 扩展、证据回答。"""

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from src.qa.providers import ChatLLMClient, DashScopeEmbeddingProvider, parse_json_object
from src.retriever.base import SearchQuery
from src.retriever.hybrid import HybridRetriever
from src.storage.models import EmailChunkSearchResult
from src.storage.postgres import PostgresStorage
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.storage.knowledge_store import KnowledgeStore

logger = logging.getLogger(__name__)


PLAN_SYSTEM_PROMPT = """You are a search planner for Linux kernel mailing list research.
Create compact, high-signal search queries to find evidence in kernel mailing list emails.
The email corpus is mostly English. If the user's question is Chinese or another non-English
language, translate the search intent into English kernel terminology for keyword_queries and
semantic_queries. Preserve exact code symbols, subsystem names, error messages, and acronyms.
Return only JSON."""

PLAN_USER_TEMPLATE = """Question:
{question}

Conversation context:
{conversation_context}

Available filters:
list_name={list_name}
sender={sender}
date_from={date_from}
date_to={date_to}
tags={tags}

Return JSON with this shape:
{{
  "goal": "one sentence research goal",
  "keyword_queries": ["query 1", "query 2"],
  "semantic_queries": ["natural language query 1"],
  "rationale": "brief explanation"
}}
Use at most 6 keyword queries and 3 semantic queries."""

REWRITE_SYSTEM_PROMPT = """You rewrite follow-up questions for Linux kernel mailing list research.
Given recent conversation turns, produce a standalone research question that preserves the
user's intent, concrete kernel terms, cited Message-IDs, subsystem names, versions, and dates.
If the latest question is already standalone, return it unchanged. Return only JSON."""

REWRITE_USER_TEMPLATE = """Recent conversation:
{conversation_context}

Latest user question:
{question}

Return JSON:
{{
  "standalone_question": "self-contained question for retrieval",
  "rationale": "brief note"
}}"""

QUERY_TRANSLATION_HINTS = {
    "为什么": "why rationale reason",
    "为何": "why rationale reason",
    "引入": "introduce introduced introduction",
    "加入": "add introduce",
    "调度器": "scheduler",
    "进程": "process",
    "性能": "performance",
    "扩展性": "scalability",
    "可扩展": "scalability",
    "内存": "memory",
    "虚拟内存": "virtual memory",
    "页": "page",
    "文件系统": "filesystem",
    "锁": "lock locking",
    "补丁": "patch",
    "回归": "regression",
    "问题": "issue problem",
    "原因": "reason rationale",
    "区别": "difference compare",
    "争议": "objection concern discussion",
    "反对": "objection nack concern",
}

QUERY_PHRASE_HINTS = {
    "o(1)": "O(1)",
    "o（1）": "O(1)",
    "调度器": "scheduler",
    "o(1)调度器": "O(1) scheduler",
    "o（1）调度器": "O(1) scheduler",
}

ANSWER_SYSTEM_PROMPT = """You are an expert Linux kernel mailing list research assistant.
Answer based ONLY on the provided evidence. If evidence is insufficient, say so clearly.
Cite sources with Message-ID in square brackets. Keep the answer concise and technical.
Answer in the same language as the user's question."""

ANSWER_USER_TEMPLATE = """Question:
{question}

Conversation context:
{conversation_context}

Search plan:
{plan}

Existing knowledge (from the knowledge graph):
{knowledge_context}

Evidence (from mailing list):
{evidence}

Relevant thread context:
{threads}

Write the final answer using the evidence above. When existing knowledge is relevant, cite the knowledge entity
by its canonical name in brackets. If new evidence contradicts existing knowledge, note the discrepancy.
Include email citations like [Message-ID]."""


def _clean_history(history: Optional[list[dict]], limit: int = 6) -> list[dict]:
    cleaned: list[dict] = []
    for item in (history or [])[-limit:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        cleaned.append({
            "role": role,
            "content": content[:2000],
        })
    return cleaned


@dataclass
class AskSource:
    chunk_id: str
    message_id: str
    subject: str = ""
    sender: str = ""
    date: str = ""
    list_name: str = ""
    thread_id: str = ""
    chunk_index: int = 0
    snippet: str = ""
    score: float = 0.0
    source: str = ""


@dataclass
class ExecutedQuery:
    query: str
    mode: str
    hits: int


@dataclass
class ThreadSummary:
    thread_id: str
    subject: str = ""
    message_count: int = 0
    messages: list[dict] = field(default_factory=list)


@dataclass
class AskAgentAnswer:
    question: str
    answer: str
    sources: list[AskSource] = field(default_factory=list)
    model: str = ""
    retrieval_mode: str = "agentic_rag"
    search_plan: dict = field(default_factory=dict)
    executed_queries: list[ExecutedQuery] = field(default_factory=list)
    threads: list[ThreadSummary] = field(default_factory=list)
    retrieval_stats: dict = field(default_factory=dict)


class AskAgent:
    """邮件 Ask Agent。"""

    def __init__(
        self,
        storage: PostgresStorage,
        retriever: HybridRetriever,
        llm: ChatLLMClient,
        embedding_provider: Optional[DashScopeEmbeddingProvider] = None,
        embedding_provider_name: str = "dashscope",
        knowledge_store: Optional["KnowledgeStore"] = None,
        max_queries: int = 6,
        per_query_limit: int = 12,
        max_sources: int = 12,
        max_threads: int = 4,
    ):
        self.storage = storage
        self.retriever = retriever
        self.llm = llm
        self.embedding_provider = embedding_provider
        self.embedding_provider_name = embedding_provider_name
        self.knowledge_store = knowledge_store
        self.max_queries = max_queries
        self.per_query_limit = per_query_limit
        self.max_sources = max_sources
        self.max_threads = max_threads

    async def ask(
        self,
        question: str,
        list_name: Optional[str] = None,
        sender: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        tags: Optional[list[str]] = None,
        history: Optional[list[dict]] = None,
    ) -> AskAgentAnswer:
        cleaned_history = _clean_history(history)
        conversation_context = self._format_history(cleaned_history)
        retrieval_question, rewrite_meta = await self._rewrite_question(question, cleaned_history)
        plan = await self._build_search_plan(
            retrieval_question,
            list_name,
            sender,
            date_from,
            date_to,
            tags,
            conversation_context,
        )
        chunks, executed = await self._retrieve_chunks(
            plan, retrieval_question, list_name, sender, date_from, date_to, tags
        )
        sources = self._select_sources(chunks)
        threads = await self._expand_threads(sources)

        knowledge_context = await self._retrieve_knowledge(
            plan, retrieval_question
        )

        answer_text = await self._answer(question, conversation_context, plan, knowledge_context, sources, threads)
        if not answer_text:
            answer_text = self._fallback_answer(question, sources)

        return AskAgentAnswer(
            question=question,
            answer=answer_text,
            sources=sources,
            model=self.llm.model,
            search_plan=plan,
            executed_queries=executed,
            threads=threads,
            retrieval_stats={
                "source_count": len(sources),
                "thread_count": len(threads),
                "query_count": len(executed),
                "vector_enabled": bool(self.embedding_provider),
                "knowledge_entities_found": 1 if knowledge_context else 0,
                "history_turns": len(cleaned_history),
                "standalone_question": retrieval_question,
                "rewrite": rewrite_meta,
            },
        )

    async def _rewrite_question(self, question: str, history: list[dict]) -> tuple[str, dict]:
        if not history:
            return question, {"rewritten": False}
        context = self._format_history(history)
        raw = await self.llm.complete(
            REWRITE_SYSTEM_PROMPT,
            REWRITE_USER_TEMPLATE.format(conversation_context=context, question=question),
            temperature=0.0,
            max_tokens=500,
        )
        parsed = parse_json_object(raw) if raw else None
        standalone = str((parsed or {}).get("standalone_question") or "").strip()
        if not standalone:
            standalone = f"{context}\n\nFollow-up question: {question}"
        return standalone, {
            "rewritten": standalone != question,
            "original_question": question,
            "rationale": str((parsed or {}).get("rationale") or ""),
        }

    def _format_history(self, history: list[dict]) -> str:
        if not history:
            return "None"
        lines = []
        for item in history[-6:]:
            label = "User" if item["role"] == "user" else "Assistant"
            lines.append(f"{label}: {item['content']}")
        return "\n\n".join(lines)

    async def _build_search_plan(
        self,
        question: str,
        list_name: Optional[str],
        sender: Optional[str],
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        tags: Optional[list[str]],
        conversation_context: str = "None",
    ) -> dict:
        prompt = PLAN_USER_TEMPLATE.format(
            question=question,
            conversation_context=conversation_context,
            list_name=list_name or "",
            sender=sender or "",
            date_from=date_from.isoformat() if date_from else "",
            date_to=date_to.isoformat() if date_to else "",
            tags=", ".join(tags or []),
        )
        raw = await self.llm.complete(PLAN_SYSTEM_PROMPT, prompt, temperature=0.1, max_tokens=900)
        parsed = parse_json_object(raw) if raw else None
        if parsed:
            keyword_queries = [
                str(q).strip() for q in parsed.get("keyword_queries", []) if str(q).strip()
            ][: self.max_queries]
            semantic_queries = [
                str(q).strip() for q in parsed.get("semantic_queries", []) if str(q).strip()
            ][:3]
            if keyword_queries or semantic_queries:
                keyword_queries = self._augment_queries(question, keyword_queries)[: self.max_queries]
                semantic_queries = self._augment_queries(question, semantic_queries)[:3]
                return {
                    "goal": str(parsed.get("goal") or question),
                    "keyword_queries": keyword_queries or [question],
                    "semantic_queries": semantic_queries or [question],
                    "rationale": str(parsed.get("rationale") or ""),
                    "planner": "llm",
                    "standalone_question": question,
                }
        fallback_queries = self._fallback_queries(question)
        return {
            "goal": question,
            "keyword_queries": fallback_queries[: self.max_queries],
            "semantic_queries": fallback_queries[:3],
            "rationale": "Fallback plan because LLM planning was unavailable.",
            "planner": "fallback",
            "standalone_question": question,
        }

    def _augment_queries(self, question: str, queries: list[str]) -> list[str]:
        """Add English fallback queries for non-English questions."""
        combined = [q for q in queries if q.strip()]
        if self._contains_cjk(question):
            combined.extend(self._fallback_queries(question))
        return list(dict.fromkeys(combined))

    def _fallback_queries(self, question: str) -> list[str]:
        """Build deterministic English-ish queries when LLM planning is unavailable."""
        queries = [question.strip()] if question.strip() else []
        hints = []
        lowered = question.lower()
        for phrase, replacement in QUERY_PHRASE_HINTS.items():
            if phrase in lowered or phrase in question:
                hints.append(replacement)
        for phrase, replacement in QUERY_TRANSLATION_HINTS.items():
            if phrase in question:
                hints.extend(replacement.split())

        protected = re.sub(r"(?i)o\s*[（(]\s*1\s*[）)]", " ", question)
        ascii_terms = re.findall(r"[A-Za-z_][A-Za-z0-9_./:+-]*", protected)
        terms = list(dict.fromkeys(ascii_terms + hints))
        if terms:
            queries.append(" ".join(terms))
        if "O(1)" in terms and "scheduler" in terms:
            queries.extend([
                "O(1) scheduler",
                "O(1) scheduler scalability",
                "Ingo Molnar O(1) scheduler",
            ])
        return list(dict.fromkeys(q for q in queries if q.strip()))

    def _contains_cjk(self, text: str) -> bool:
        return bool(re.search(r"[\u4e00-\u9fff]", text))

    async def _retrieve_chunks(
        self,
        plan: dict,
        question: str,
        list_name: Optional[str],
        sender: Optional[str],
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        tags: Optional[list[str]],
    ) -> tuple[list[EmailChunkSearchResult], list[ExecutedQuery]]:
        chunk_map: dict[str, EmailChunkSearchResult] = {}
        executed: list[ExecutedQuery] = []

        keyword_queries = plan.get("keyword_queries") or [question]
        for query in keyword_queries[: self.max_queries]:
            hits = await self.storage.search_email_chunks_fulltext(
                query=query,
                list_name=list_name,
                sender=sender,
                date_from=date_from,
                date_to=date_to,
                tags=tags,
                limit=self.per_query_limit,
            )
            executed.append(ExecutedQuery(query=query, mode="chunk_keyword", hits=len(hits)))
            self._merge_chunks(chunk_map, hits)

        if self.embedding_provider:
            for query in (plan.get("semantic_queries") or [question])[:3]:
                try:
                    vector = (await self.embedding_provider.embed_texts([query]))[0]
                    hits = await self.storage.search_email_chunks_vector(
                        embedding=vector,
                        provider=self.embedding_provider_name,
                        model=self.embedding_provider.model,
                        list_name=list_name,
                        sender=sender,
                        date_from=date_from,
                        date_to=date_to,
                        tags=tags,
                        limit=self.per_query_limit,
                    )
                except Exception as exc:
                    logger.warning("Vector retrieval failed for query '%s': %s", query, exc)
                    hits = []
                executed.append(ExecutedQuery(query=query, mode="chunk_vector", hits=len(hits)))
                self._merge_chunks(chunk_map, hits)

        if not chunk_map:
            fallback_queries = list(dict.fromkeys(
                (plan.get("keyword_queries") or []) + (plan.get("semantic_queries") or []) + [question]
            ))
            for fallback_text in fallback_queries[: self.max_queries]:
                fallback_query = SearchQuery(
                    text=fallback_text,
                    list_name=list_name,
                    sender=sender,
                    date_from=date_from,
                    date_to=date_to,
                    tags=tags,
                    page=1,
                    page_size=self.per_query_limit,
                )
                result = await self.retriever.search(fallback_query)
                executed.append(
                    ExecutedQuery(query=fallback_text, mode="email_fallback", hits=len(result.hits))
                )
                for hit in result.hits:
                    email = await self.storage.get_email(hit.message_id)
                    if not email:
                        continue
                    content = hit.snippet or (email.body or "")[:500]
                    chunk = EmailChunkSearchResult(
                        chunk_id=f"email:{hit.message_id}",
                        message_id=hit.message_id,
                        thread_id=hit.thread_id,
                        list_name=hit.list_name,
                        subject=hit.subject,
                        sender=hit.sender,
                        date=email.date,
                        chunk_index=0,
                        content=content,
                        content_hash="",
                        score=hit.score,
                        snippet=hit.snippet or content,
                        source="email_fallback",
                    )
                    chunk_map[chunk.chunk_id] = chunk
                if chunk_map:
                    break

        return sorted(chunk_map.values(), key=lambda c: c.score, reverse=True), executed

    def _merge_chunks(
        self,
        chunk_map: dict[str, EmailChunkSearchResult],
        hits: list[EmailChunkSearchResult],
    ) -> None:
        for hit in hits:
            existing = chunk_map.get(hit.chunk_id)
            if existing is None or hit.score > existing.score:
                chunk_map[hit.chunk_id] = hit

    def _select_sources(self, chunks: list[EmailChunkSearchResult]) -> list[AskSource]:
        sources = []
        seen_messages = set()
        for chunk in chunks:
            if len(sources) >= self.max_sources:
                break
            message_key = (chunk.message_id, chunk.chunk_index)
            if message_key in seen_messages:
                continue
            seen_messages.add(message_key)
            sources.append(AskSource(
                chunk_id=chunk.chunk_id,
                message_id=chunk.message_id,
                subject=chunk.subject,
                sender=chunk.sender,
                date=chunk.date.isoformat() if chunk.date else "",
                list_name=chunk.list_name,
                thread_id=chunk.thread_id,
                chunk_index=chunk.chunk_index,
                snippet=chunk.snippet or chunk.content[:400],
                score=chunk.score,
                source=chunk.source,
            ))
        return sources

    async def _expand_threads(self, sources: list[AskSource]) -> list[ThreadSummary]:
        summaries: list[ThreadSummary] = []
        seen = set()
        for source in sources:
            if not source.thread_id or source.thread_id in seen:
                continue
            seen.add(source.thread_id)
            emails = await self.storage.get_thread(source.thread_id)
            messages = [
                {
                    "message_id": email.message_id,
                    "subject": email.subject,
                    "sender": email.sender,
                    "date": email.date.isoformat() if email.date else "",
                    "preview": (email.body or "")[:600],
                }
                for email in emails[:8]
            ]
            summaries.append(ThreadSummary(
                thread_id=source.thread_id,
                subject=emails[0].subject if emails else source.subject,
                message_count=len(emails),
                messages=messages,
            ))
            if len(summaries) >= self.max_threads:
                break
        return summaries

    async def _retrieve_knowledge(
        self,
        plan: dict,
        question: str,
    ) -> str:
        if not self.knowledge_store:
            return ""
        queries = list(dict.fromkeys(
            [question] + (plan.get("keyword_queries") or [])
        ))[:5]
        try:
            entities = await self.knowledge_store.search_entities(queries, limit=8)
        except Exception as exc:
            logger.warning("Knowledge entity search failed: %s", exc)
            return ""
        if not entities:
            return ""
        lines = []
        for entity in entities:
            parts = [f"[{entity.canonical_name}]"]
            if entity.entity_type:
                parts.append(f"(type: {entity.entity_type})")
            if entity.summary:
                parts.append(f"\n  Summary: {entity.summary}")
            if entity.description:
                parts.append(f"\n  Description: {entity.description[:500]}")
            lines.append(" ".join(parts))
        return "\n\n".join(lines)

    async def _answer(
        self,
        question: str,
        conversation_context: str,
        plan: dict,
        knowledge_context: str,
        sources: list[AskSource],
        threads: list[ThreadSummary],
    ) -> str:
        if not sources:
            return ""
        evidence = "\n\n".join(
            f"[{source.message_id}]\n"
            f"Subject: {source.subject}\n"
            f"From: {source.sender}\n"
            f"Date: {source.date}\n"
            f"Snippet: {source.snippet}"
            for source in sources
        )
        thread_text = "\n\n".join(
            f"Thread {thread.thread_id} ({thread.message_count} messages):\n"
            + "\n".join(
                f"- [{msg['message_id']}] {msg['sender']} {msg['date']}: {msg['preview']}"
                for msg in thread.messages
            )
            for thread in threads
        )
        return await self.llm.complete(
            ANSWER_SYSTEM_PROMPT,
            ANSWER_USER_TEMPLATE.format(
                question=question,
                conversation_context=conversation_context,
                plan=plan,
                knowledge_context=knowledge_context or "None",
                evidence=evidence[:10000],
                threads=thread_text[:10000],
            ),
            temperature=0.2,
            max_tokens=1800,
        )

    def _fallback_answer(self, question: str, sources: list[AskSource]) -> str:
        if not sources:
            return (
                f"没有找到足够相关的邮件证据来回答：\"{question}\"。\n"
                "可以尝试加入子系统、函数名、错误信息或邮件列表过滤条件。"
            )
        lines = [f"找到 {len(sources)} 条候选邮件证据，但 LLM 回答不可用。相关来源如下："]
        for index, source in enumerate(sources[:8], 1):
            lines.append(
                f"{index}. {source.subject}\n"
                f"   From: {source.sender} | Date: {source.date}\n"
                f"   Message-ID: {source.message_id}\n"
                f"   Preview: {source.snippet[:220]}"
            )
        return "\n\n".join(lines)

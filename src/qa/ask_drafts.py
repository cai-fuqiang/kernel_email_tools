"""Ask 结果转 Knowledge / Annotation / Tag 草稿。"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from src.qa.providers import ChatLLMClient, parse_json_object
from src.storage.tag_store import slugify_tag


DRAFT_SYSTEM_PROMPT = """You turn Linux kernel mailing list Q&A results into editable knowledge-base drafts.
Return only JSON. Do not invent facts beyond the answer and sources."""

DRAFT_USER_TEMPLATE = """Question:
{question}

Answer:
{answer}

Sources:
{sources}

Search plan:
{search_plan}

Threads:
{threads}

Return JSON:
{{
  "knowledge_drafts": [
    {{
      "entity_type": "topic|subsystem|mechanism|issue|patch_discussion|symbol",
      "canonical_name": "short stable name",
      "aliases": ["optional alias"],
      "summary": "1-3 sentence summary",
      "description": "markdown description with evidence",
      "tags": ["existing-looking short tag names"]
    }}
  ],
  "annotation_drafts": [
    {{
      "annotation_type": "email",
      "body": "markdown annotation body",
      "target_type": "email_thread|email_message|knowledge_entity",
      "target_ref": "target id",
      "target_label": "title",
      "target_subtitle": "subtitle",
      "thread_id": "thread id when target is email",
      "in_reply_to": "message id when available",
      "anchor": {{}}
    }}
  ],
  "tag_assignment_drafts": [
    {{
      "tag_name": "existing tag name",
      "target_type": "email_thread|email_message|knowledge_entity",
      "target_ref": "target id",
      "anchor": {{}},
      "confidence": 0.0
    }}
  ]
}}"""


@dataclass
class AskDraftBundle:
    knowledge_drafts: list[dict] = field(default_factory=list)
    annotation_drafts: list[dict] = field(default_factory=list)
    tag_assignment_drafts: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class AskDraftService:
    """Generate editable drafts from Ask responses."""

    def __init__(self, llm: Optional[ChatLLMClient] = None):
        self.llm = llm

    async def generate(
        self,
        query: str,
        summary: str,
        sources: list[dict],
        tag_exists,
    ) -> AskDraftBundle:
        """Generate normalized drafts from AI summary results.

        Args:
            query: Original search query.
            summary: AI-generated summary text.
            sources: List of source dicts with message_id, subject, sender, date, snippet, thread_id.
            tag_exists: async callable accepting tag name and returning bool.
        """
        payload = {"question": query, "answer": summary, "sources": sources}
        parsed = await self._generate_with_llm(query, summary, sources)
        bundle = self._normalize_bundle(parsed or self._fallback_bundle(query, summary, sources), payload)
        await self._mark_tag_existence(bundle, tag_exists)
        return bundle

    async def _generate_with_llm(
        self, query: str, summary: str, sources: list[dict]
    ) -> Optional[dict]:
        if not self.llm or not self.llm.available:
            return None
        raw = await self.llm.complete(
            DRAFT_SYSTEM_PROMPT,
            DRAFT_USER_TEMPLATE.format(
                question=query,
                answer=summary,
                sources=sources,
                search_plan={},
                threads=[],
            ),
            temperature=0.1,
            max_tokens=1800,
        )
        return parse_json_object(raw) if raw else None

    def _fallback_bundle(self, query: str, summary: str, sources: list[dict]) -> dict:
        question = query.strip()
        answer = summary.strip()
        primary_source = sources[0] if sources else {}
        thread_id = primary_source.get("thread_id") or ""
        canonical_name = self._make_name(question, primary_source)
        citations = ", ".join(
            f"[{source.get('message_id')}]" for source in sources[:6] if source.get("message_id")
        )
        description = (
            f"## Background\n\nGenerated from Ask question: {question}\n\n"
            f"## Summary\n\n{answer[:1800]}\n\n"
            f"## Evidence\n\n{citations or 'No source Message-ID captured.'}\n"
        )
        annotation_body = (
            f"**AI draft from Search Summarize**\n\n"
            f"Query: {question}\n\n"
            f"{answer}\n\n"
            f"Sources: {citations or 'none'}"
        )
        tags = self._candidate_tags(sources)
        return {
            "knowledge_drafts": [{
                "entity_type": "topic",
                "canonical_name": canonical_name,
                "aliases": [],
                "summary": answer[:500] if answer else question,
                "description": description,
                "tags": tags,
            }],
            "annotation_drafts": [{
                "annotation_type": "email",
                "body": annotation_body,
                "target_type": "email_thread" if thread_id else "email_message",
                "target_ref": thread_id or primary_source.get("message_id", ""),
                "target_label": primary_thread.get("subject") or primary_source.get("subject") or canonical_name,
                "target_subtitle": f"Ask draft: {question}",
                "thread_id": thread_id,
                "in_reply_to": primary_source.get("message_id", ""),
                "anchor": {
                    "source": "ask_agent",
                    "source_message_ids": [
                        source.get("message_id") for source in sources[:8] if source.get("message_id")
                    ],
                    "source_chunks": [
                        source.get("chunk_id") for source in sources[:8] if source.get("chunk_id")
                    ],
                },
            }],
            "tag_assignment_drafts": [
                {
                    "tag_name": tag,
                    "target_type": "email_thread" if thread_id else "email_message",
                    "target_ref": thread_id or primary_source.get("message_id", ""),
                    "anchor": {},
                    "confidence": 0.55,
                }
                for tag in tags
                if thread_id or primary_source.get("message_id")
            ],
        }

    def _normalize_bundle(self, raw: dict, payload: dict) -> AskDraftBundle:
        warnings = []
        knowledge = raw.get("knowledge_drafts") or []
        annotations = raw.get("annotation_drafts") or []
        tags = raw.get("tag_assignment_drafts") or []
        if not isinstance(knowledge, list):
            knowledge = []
            warnings.append("knowledge_drafts was not a list")
        if not isinstance(annotations, list):
            annotations = []
            warnings.append("annotation_drafts was not a list")
        if not isinstance(tags, list):
            tags = []
            warnings.append("tag_assignment_drafts was not a list")

        sources = payload.get("sources") or []
        source_message_ids = [s.get("message_id") for s in sources if s.get("message_id")]
        thread_ids = sorted({s.get("thread_id") for s in sources if s.get("thread_id")})
        now = datetime.utcnow().isoformat()

        normalized_knowledge = []
        for item in knowledge[:3]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("canonical_name") or "").strip()
            if not name:
                continue
            normalized_knowledge.append({
                "selected": True,
                "entity_type": self._clean_choice(
                    item.get("entity_type"),
                    {"topic", "subsystem", "mechanism", "issue", "patch_discussion", "symbol"},
                    "topic",
                ),
                "canonical_name": name[:256],
                "slug": str(item.get("slug") or slugify_tag(name))[:160],
                "entity_id": str(item.get("entity_id") or ""),
                "aliases": [str(a).strip() for a in item.get("aliases", []) if str(a).strip()][:10],
                "summary": str(item.get("summary") or "")[:2000],
                "description": str(item.get("description") or "")[:20000],
                "status": "draft",
                "meta": {
                    **(item.get("meta") if isinstance(item.get("meta"), dict) else {}),
                    "ask": {
                        "question": payload.get("question", ""),
                        "answer_excerpt": str(payload.get("answer") or "")[:1000],
                        "source_message_ids": source_message_ids,
                        "thread_ids": thread_ids,
                        "generated_at": now,
                    },
                },
                "tags": [str(t).strip() for t in item.get("tags", []) if str(t).strip()][:8],
            })

        normalized_annotations = []
        for item in annotations[:8]:
            if not isinstance(item, dict) or not str(item.get("body") or "").strip():
                continue
            normalized_annotations.append({
                "selected": True,
                "annotation_type": str(item.get("annotation_type") or "email"),
                "body": str(item.get("body") or "").strip(),
                "visibility": str(item.get("visibility") or "private"),
                "target_type": str(item.get("target_type") or ""),
                "target_ref": str(item.get("target_ref") or ""),
                "target_label": str(item.get("target_label") or ""),
                "target_subtitle": str(item.get("target_subtitle") or ""),
                "anchor": item.get("anchor") if isinstance(item.get("anchor"), dict) else {},
                "thread_id": str(item.get("thread_id") or ""),
                "in_reply_to": str(item.get("in_reply_to") or ""),
                "meta": {
                    **(item.get("meta") if isinstance(item.get("meta"), dict) else {}),
                    "ask": {"question": payload.get("question", ""), "generated_at": now},
                },
            })

        normalized_tags = []
        for item in tags[:16]:
            if not isinstance(item, dict):
                continue
            tag_name = str(item.get("tag_name") or "").strip()
            target_ref = str(item.get("target_ref") or "").strip()
            if not tag_name or not target_ref:
                continue
            normalized_tags.append({
                "selected": True,
                "tag_name": tag_name[:128],
                "target_type": str(item.get("target_type") or "email_thread"),
                "target_ref": target_ref[:1024],
                "anchor": item.get("anchor") if isinstance(item.get("anchor"), dict) else {},
                "assignment_scope": "direct",
                "source_type": "ask_agent",
                "evidence": {
                    **(item.get("evidence") if isinstance(item.get("evidence"), dict) else {}),
                    "question": payload.get("question", ""),
                    "source_message_ids": source_message_ids,
                    "source_chunks": [s.get("chunk_id") for s in sources if s.get("chunk_id")],
                    "confidence": item.get("confidence", 0.5),
                },
            })

        if not normalized_knowledge and not normalized_annotations and not normalized_tags:
            warnings.append("No usable drafts were generated")

        return AskDraftBundle(
            knowledge_drafts=normalized_knowledge,
            annotation_drafts=normalized_annotations,
            tag_assignment_drafts=normalized_tags,
            warnings=warnings,
        )

    async def _mark_tag_existence(self, bundle: AskDraftBundle, tag_exists) -> None:
        missing = []
        for draft in bundle.tag_assignment_drafts:
            exists = await tag_exists(draft["tag_name"])
            draft["tag_exists"] = exists
            if not exists:
                draft["selected"] = False
                missing.append(draft["tag_name"])
        if missing:
            bundle.warnings.append(
                "Some tag drafts reference missing tags and are unselected: "
                + ", ".join(sorted(set(missing)))
            )

    def _candidate_tags(self, sources: list[dict]) -> list[str]:
        tags = []
        for source in sources:
            if source.get("list_name"):
                tags.append(str(source["list_name"]))
            snippet = str(source.get("snippet") or source.get("subject") or "")
            parts = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", snippet)
            tags.extend(parts[:2])
        return list(dict.fromkeys(tags))[:5]

    def _make_name(self, question: str, source: dict) -> str:
        subject = str(source.get("subject") or "").strip()
        if subject:
            return subject[:120]
        cleaned = re.sub(r"\s+", " ", question).strip(" ?？")
        return (cleaned or "Ask generated knowledge")[:120]

    def _clean_choice(self, value, allowed: set[str], default: str) -> str:
        text = str(value or "").strip()
        return text if text in allowed else default

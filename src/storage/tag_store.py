"""通用标签存储层。"""

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Select, and_, func, inspect, or_, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm.attributes import NO_VALUE
from sqlalchemy.orm import selectinload

from src.storage.models import (
    AnnotationORM,
    EmailORM,
    TagAliasORM,
    TagAssignmentCreate,
    TagAssignmentORM,
    TagAssignmentRead,
    TagBundle,
    TagCreate,
    TagORM,
    TagRead,
    TagTree,
)

logger = logging.getLogger(__name__)

TARGET_TYPE_EMAIL_THREAD = "email_thread"
TARGET_TYPE_EMAIL_MESSAGE = "email_message"
TARGET_TYPE_EMAIL_PARAGRAPH = "email_paragraph"
TARGET_TYPE_KERNEL_LINE_RANGE = "kernel_line_range"
TARGET_TYPE_ANNOTATION = "annotation"

DEFAULT_TAG_COLOR = "#6366f1"


def slugify_tag(value: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return raw or f"tag-{uuid.uuid4().hex[:8]}"


def normalize_anchor(anchor: Optional[dict]) -> dict:
    if not anchor or not isinstance(anchor, dict):
        return {}
    return json.loads(json.dumps(anchor, sort_keys=True, ensure_ascii=True))


def hash_anchor(anchor: Optional[dict]) -> str:
    normalized = normalize_anchor(anchor)
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def build_paragraph_anchor(paragraph_index: int, paragraph_text: str) -> dict:
    return {
        "paragraph_index": paragraph_index,
        "paragraph_hash": hashlib.sha256(paragraph_text.encode()).hexdigest()[:16],
    }


class TagStore:
    """标签本体、别名、绑定关系的统一存储层。"""

    def __init__(self, session_factory: async_sessionmaker, default_actor: str = "me"):
        self.session_factory = session_factory
        self.default_actor = default_actor

    def _visibility_filter(self, viewer_user_id: Optional[str]):
        if viewer_user_id:
            return or_(TagORM.visibility == "public", TagORM.owner_user_id == viewer_user_id)
        return TagORM.visibility == "public"

    async def create_tag(
        self,
        data: TagCreate,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> TagORM:
        slug = slugify_tag(data.slug or data.name)
        async with self.session_factory() as session:
            await self._ensure_tag_name_available(session, data.name)
            await self._ensure_tag_slug_available(session, slug)
            if data.parent_tag_id is not None:
                parent = await session.get(TagORM, data.parent_tag_id)
                if not parent:
                    raise ValueError(f"Parent tag {data.parent_tag_id} not found")

            now = datetime.utcnow()
            tag = TagORM(
                slug=slug,
                name=data.name.strip(),
                description=data.description.strip(),
                parent_tag_id=data.parent_tag_id,
                color=data.color or DEFAULT_TAG_COLOR,
                status=data.status or "active",
                tag_kind=data.tag_kind or "topic",
                visibility=data.visibility or "public",
                owner_user_id=actor_user_id or data.owner_user_id,
                created_by=actor_display_name or data.created_by or self.default_actor,
                updated_by=actor_display_name or data.created_by or self.default_actor,
                created_by_user_id=actor_user_id or data.created_by_user_id,
                updated_by_user_id=actor_user_id or data.created_by_user_id,
                created_at=now,
                updated_at=now,
            )
            session.add(tag)
            await session.flush()

            for alias in data.aliases:
                alias_value = alias.strip()
                if not alias_value:
                    continue
                await self._ensure_alias_available(session, alias_value)
                session.add(TagAliasORM(tag_id=tag.id, alias=alias_value))

            await session.commit()
            tag = await self._load_tag_with_aliases(session, tag.id)
            logger.info("Created tag %s (%s)", tag.name, tag.slug)
            return tag

    async def update_tag(
        self,
        tag_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        color: Optional[str] = None,
        parent_tag_id: Optional[int] = None,
        status: Optional[str] = None,
        tag_kind: Optional[str] = None,
        aliases: Optional[list[str]] = None,
        updated_by: str = "",
        updated_by_user_id: str = "",
        visibility: Optional[str] = None,
    ) -> Optional[TagORM]:
        async with self.session_factory() as session:
            tag = await session.get(TagORM, tag_id, options=[selectinload(TagORM.aliases)])
            if not tag:
                return None

            if name is not None and name.strip() != tag.name:
                await self._ensure_tag_name_available(session, name.strip(), exclude_id=tag_id)
                tag.name = name.strip()
            if description is not None:
                tag.description = description.strip()
            if color is not None:
                tag.color = color
            if status is not None:
                tag.status = status
            if tag_kind is not None:
                tag.tag_kind = tag_kind
            if visibility is not None:
                tag.visibility = visibility
            if parent_tag_id is not None:
                if parent_tag_id == tag_id:
                    raise ValueError("Tag cannot be its own parent")
                parent = await session.get(TagORM, parent_tag_id)
                if not parent:
                    raise ValueError(f"Parent tag {parent_tag_id} not found")
                tag.parent_tag_id = parent_tag_id
            tag.updated_by = updated_by or self.default_actor
            tag.updated_by_user_id = updated_by_user_id or tag.updated_by_user_id
            tag.updated_at = datetime.utcnow()

            if aliases is not None:
                existing = {item.alias: item for item in tag.aliases}
                desired = {item.strip() for item in aliases if item.strip()}
                for alias_value in desired - set(existing):
                    await self._ensure_alias_available(session, alias_value)
                    session.add(TagAliasORM(tag_id=tag.id, alias=alias_value))
                for alias_value, alias_obj in existing.items():
                    if alias_value not in desired:
                        await session.delete(alias_obj)

            await session.commit()
            return await self._load_tag_with_aliases(session, tag.id)

    async def get_tag(self, tag_id: int) -> Optional[TagORM]:
        async with self.session_factory() as session:
            return await self._load_tag_with_aliases(session, tag_id)

    async def get_tag_by_name(self, name: str) -> Optional[TagORM]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(TagORM)
                .where(TagORM.name == name)
                .options(selectinload(TagORM.aliases))
            )
            return result.scalar_one_or_none()

    async def get_tag_by_slug(self, slug: str) -> Optional[TagORM]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(TagORM)
                .where(TagORM.slug == slug)
                .options(selectinload(TagORM.aliases))
            )
            return result.scalar_one_or_none()

    async def get_or_create_tag(
        self,
        name: str,
        parent_tag_id: Optional[int] = None,
        color: str = DEFAULT_TAG_COLOR,
        tag_kind: str = "topic",
        visibility: str = "public",
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> TagORM:
        async with self.session_factory() as session:
            result = await session.execute(
                select(TagORM)
                .outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
                .where(or_(TagORM.name == name, TagAliasORM.alias == name))
                .where(self._visibility_filter(actor_user_id or None))
            )
            existing = result.scalars().first()
            if existing:
                return existing
        return await self.create_tag(
            TagCreate(
                name=name,
                parent_tag_id=parent_tag_id,
                color=color,
                tag_kind=tag_kind,
                visibility=visibility,
                created_by=actor_display_name or self.default_actor,
                owner_user_id=actor_user_id or None,
                created_by_user_id=actor_user_id or None,
            ),
            actor_user_id=actor_user_id,
            actor_display_name=actor_display_name,
        )

    async def delete_tag(self, tag_id: int) -> bool:
        async with self.session_factory() as session:
            tag = await session.get(TagORM, tag_id)
            if not tag:
                return False
            await session.delete(tag)
            await session.commit()
            return True

    async def get_all_tags(self, viewer_user_id: Optional[str] = None) -> list[TagORM]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(TagORM)
                .where(self._visibility_filter(viewer_user_id))
                .options(selectinload(TagORM.aliases))
                .order_by(TagORM.name)
            )
            return list(result.scalars().all())

    async def get_tag_tree(self, viewer_user_id: Optional[str] = None) -> list[TagTree]:
        tags = await self.get_all_tags(viewer_user_id=viewer_user_id)
        stats = await self.get_tag_stats(viewer_user_id=viewer_user_id)
        count_map = {row["slug"]: row["count"] for row in stats}

        tag_map: dict[int, TagTree] = {}
        for tag in tags:
            tag_map[tag.id] = TagTree(
                id=tag.id,
                slug=tag.slug,
                name=tag.name,
                description=tag.description or "",
                color=tag.color,
                status=tag.status,
                tag_kind=tag.tag_kind,
                visibility=tag.visibility,
                assignment_count=count_map.get(tag.slug, 0),
                children=[],
            )

        roots: list[TagTree] = []
        for tag in tags:
            node = tag_map[tag.id]
            if tag.parent_tag_id is None:
                roots.append(node)
            else:
                parent = tag_map.get(tag.parent_tag_id)
                if parent:
                    parent.children.append(node)
                else:
                    roots.append(node)

        return roots

    async def list_tags(self, flat: bool = False, viewer_user_id: Optional[str] = None) -> list[TagTree]:
        if flat:
            tags = await self.get_all_tags(viewer_user_id=viewer_user_id)
            stats = await self.get_tag_stats(viewer_user_id=viewer_user_id)
            count_map = {row["slug"]: row["count"] for row in stats}
            return [
                TagTree(
                    id=tag.id,
                    slug=tag.slug,
                    name=tag.name,
                    description=tag.description or "",
                    color=tag.color,
                    status=tag.status,
                    tag_kind=tag.tag_kind,
                    visibility=tag.visibility,
                    assignment_count=count_map.get(tag.slug, 0),
                    children=[],
                )
                for tag in tags
            ]
        return await self.get_tag_tree(viewer_user_id=viewer_user_id)

    async def assign_tag(
        self,
        data: TagAssignmentCreate,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> TagAssignmentRead:
        async with self.session_factory() as session:
            tag = await self._resolve_tag(
                session,
                data.tag_id,
                data.tag_slug,
                data.tag_name,
                actor_user_id=actor_user_id,
                actor_display_name=actor_display_name,
            )
            if not tag:
                raise ValueError("tag_id, tag_slug or tag_name is required")

            normalized_anchor = normalize_anchor(data.anchor)
            assignment = TagAssignmentORM(
                assignment_id=f"tagas-{uuid.uuid4().hex[:12]}",
                tag_id=tag.id,
                target_type=data.target_type,
                target_ref=data.target_ref,
                anchor=normalized_anchor,
                anchor_hash=hash_anchor(normalized_anchor),
                assignment_scope=data.assignment_scope or "direct",
                source_type=data.source_type or "manual",
                evidence=normalize_anchor(data.evidence),
                created_by=actor_display_name or data.created_by or self.default_actor,
                created_by_user_id=actor_user_id or data.created_by_user_id,
                created_at=datetime.utcnow(),
            )
            session.add(assignment)
            try:
                await session.commit()
            except Exception:
                await session.rollback()
                result = await session.execute(
                    select(TagAssignmentORM)
                    .where(TagAssignmentORM.tag_id == tag.id)
                    .where(TagAssignmentORM.target_type == data.target_type)
                    .where(TagAssignmentORM.target_ref == data.target_ref)
                    .where(TagAssignmentORM.anchor_hash == hash_anchor(normalized_anchor))
                )
                existing = result.scalar_one_or_none()
                if existing:
                    return self._to_assignment_read(existing, tag)
                raise

            await session.refresh(assignment)
            return self._to_assignment_read(assignment, tag)

    async def remove_assignment(self, assignment_id: str) -> bool:
        async with self.session_factory() as session:
            result = await session.execute(
                select(TagAssignmentORM).where(TagAssignmentORM.assignment_id == assignment_id)
            )
            assignment = result.scalar_one_or_none()
            if not assignment:
                return False
            await session.delete(assignment)
            await session.commit()
            return True

    async def list_assignments(
        self,
        target_type: Optional[str] = None,
        target_ref: Optional[str] = None,
        anchor: Optional[dict] = None,
        tag: Optional[str] = None,
        tag_kind: Optional[str] = None,
        status: Optional[str] = None,
        viewer_user_id: Optional[str] = None,
    ) -> list[TagAssignmentRead]:
        async with self.session_factory() as session:
            stmt = (
                select(TagAssignmentORM, TagORM)
                .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
                .where(self._visibility_filter(viewer_user_id))
                .order_by(TagAssignmentORM.created_at.desc())
            )
            if target_type:
                stmt = stmt.where(TagAssignmentORM.target_type == target_type)
            if target_ref:
                stmt = stmt.where(TagAssignmentORM.target_ref == target_ref)
            if anchor is not None:
                stmt = stmt.where(TagAssignmentORM.anchor_hash == hash_anchor(anchor))
            if tag:
                stmt = stmt.where(or_(TagORM.slug == tag, TagORM.name == tag))
            if tag_kind:
                stmt = stmt.where(TagORM.tag_kind == tag_kind)
            if status:
                stmt = stmt.where(TagORM.status == status)
            result = await session.execute(stmt)
            return [self._to_assignment_read(assignment, tag_obj) for assignment, tag_obj in result.all()]

    async def get_target_bundle(
        self,
        target_type: str,
        target_ref: str,
        anchor: Optional[dict] = None,
        viewer_user_id: Optional[str] = None,
    ) -> TagBundle:
        direct = await self._get_tags_for_target(target_type, target_ref, anchor=anchor, viewer_user_id=viewer_user_id)
        inherited: list[TagRead] = []
        aggregated = await self._get_aggregated_tags(target_type, target_ref, viewer_user_id=viewer_user_id)
        return TagBundle(direct_tags=direct, inherited_tags=inherited, aggregated_tags=aggregated)

    async def get_target_tag_names(
        self,
        target_type: str,
        target_ref: str,
        viewer_user_id: Optional[str] = None,
    ) -> list[str]:
        bundle = await self.get_target_bundle(target_type, target_ref, viewer_user_id=viewer_user_id)
        names = {tag.name for tag in bundle.direct_tags}
        names.update(tag.name for tag in bundle.aggregated_tags)
        return sorted(names)

    async def get_email_tags(self, message_id: str, viewer_user_id: Optional[str] = None) -> list[str]:
        return await self.get_target_tag_names(TARGET_TYPE_EMAIL_MESSAGE, message_id, viewer_user_id=viewer_user_id)

    async def add_email_tag(
        self,
        message_id: str,
        tag_name: str,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> bool:
        async with self.session_factory() as session:
            result = await session.execute(
                select(EmailORM.id).where(EmailORM.message_id == message_id)
            )
            if result.scalar_one_or_none() is None:
                return False
        await self.assign_tag(
            TagAssignmentCreate(
                tag_name=tag_name,
                target_type=TARGET_TYPE_EMAIL_MESSAGE,
                target_ref=message_id,
                created_by=actor_display_name or self.default_actor,
                created_by_user_id=actor_user_id or None,
            ),
            actor_user_id=actor_user_id,
            actor_display_name=actor_display_name,
        )
        return True

    async def remove_email_tag(self, message_id: str, tag_name: str) -> bool:
        async with self.session_factory() as session:
            email_exists = await session.execute(
                select(EmailORM.id).where(EmailORM.message_id == message_id)
            )
            if email_exists.scalar_one_or_none() is None:
                return False
            tag = await self._resolve_tag(session, None, "", tag_name)
            if not tag:
                return True
            result = await session.execute(
                select(TagAssignmentORM)
                .where(TagAssignmentORM.tag_id == tag.id)
                .where(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_MESSAGE)
                .where(TagAssignmentORM.target_ref == message_id)
            )
            assignments = result.scalars().all()
            for assignment in assignments:
                await session.delete(assignment)
            await session.commit()
            return True

    async def get_emails_by_tag(
        self,
        tag_name: str,
        page: int = 1,
        page_size: int = 20,
        viewer_user_id: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        async with self.session_factory() as session:
            tag_ids = await self._resolve_tag_ids(session, tag_name, viewer_user_id=viewer_user_id)
            if not tag_ids:
                return [], 0

            assignment_rows = (
                await session.execute(
                    select(TagAssignmentORM.target_type, TagAssignmentORM.target_ref)
                    .where(TagAssignmentORM.tag_id.in_(tag_ids))
                )
            ).all()

            message_ids: set[str] = set()
            thread_ids: set[str] = set()
            annotation_ids: set[str] = set()

            for target_type, target_ref in assignment_rows:
                if target_type == TARGET_TYPE_EMAIL_MESSAGE:
                    message_ids.add(target_ref)
                elif target_type == TARGET_TYPE_EMAIL_PARAGRAPH:
                    message_ids.add(target_ref)
                elif target_type == TARGET_TYPE_EMAIL_THREAD:
                    thread_ids.add(target_ref)
                elif target_type == TARGET_TYPE_ANNOTATION:
                    annotation_ids.add(target_ref)

            if annotation_ids:
                annotation_rows = (
                    await session.execute(
                        select(AnnotationORM.in_reply_to, AnnotationORM.thread_id)
                        .where(AnnotationORM.annotation_id.in_(annotation_ids))
                    )
                ).all()
                for in_reply_to, thread_id in annotation_rows:
                    if in_reply_to:
                        message_ids.add(in_reply_to)
                    elif thread_id:
                        thread_ids.add(thread_id)

            if not message_ids and not thread_ids:
                return [], 0

            conditions = []
            if message_ids:
                conditions.append(EmailORM.message_id.in_(message_ids))
            if thread_ids:
                conditions.append(EmailORM.thread_id.in_(thread_ids))
            condition = or_(*conditions)

            count_stmt = select(func.count()).select_from(EmailORM).where(condition)
            total = (await session.execute(count_stmt)).scalar() or 0
            if total == 0:
                return [], 0

            stmt = (
                select(EmailORM)
                .where(condition)
                .order_by(EmailORM.date.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
            rows = (await session.execute(stmt)).scalars().all()
            items = []
            for email in rows:
                items.append(
                    {
                        "message_id": email.message_id,
                        "subject": email.subject,
                        "sender": email.sender,
                        "date": email.date,
                        "list_name": email.list_name,
                        "thread_id": email.thread_id,
                        "has_patch": email.has_patch,
                        "snippet": (email.body or "")[:200],
                    }
                )
            return items, total

    async def _resolve_tag_ids(
        self,
        session,
        tag_value: str,
        viewer_user_id: Optional[str] = None,
    ) -> list[int]:
        stmt = (
            select(TagORM.id)
            .outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
            .where(or_(TagORM.name == tag_value, TagORM.slug == tag_value, TagAliasORM.alias == tag_value))
            .where(self._visibility_filter(viewer_user_id))
        )
        result = await session.execute(stmt)
        return sorted({row[0] for row in result.all()})

    async def get_tag_stats(self, viewer_user_id: Optional[str] = None) -> list[dict]:
        async with self.session_factory() as session:
            stmt = (
                select(
                    TagORM.slug,
                    TagORM.name,
                    func.count(TagAssignmentORM.id).label("count"),
                    func.count(
                        func.distinct(func.concat(TagAssignmentORM.target_type, ":", TagAssignmentORM.target_ref))
                    ).label("target_count"),
                )
                .outerjoin(TagAssignmentORM, TagAssignmentORM.tag_id == TagORM.id)
                .where(self._visibility_filter(viewer_user_id))
                .group_by(TagORM.id)
                .order_by(func.count(TagAssignmentORM.id).desc(), TagORM.name.asc())
            )
            result = await session.execute(stmt)
            return [
                {
                    "slug": row.slug,
                    "name": row.name,
                    "count": int(row.count or 0),
                    "target_count": int(row.target_count or 0),
                }
                for row in result.all()
            ]

    async def get_targets_by_tag(
        self,
        tag: str,
        target_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        viewer_user_id: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        async with self.session_factory() as session:
            stmt = (
                select(TagAssignmentORM, TagORM)
                .join(TagORM, TagORM.id == TagAssignmentORM.tag_id)
                .where(or_(TagORM.slug == tag, TagORM.name == tag))
                .where(self._visibility_filter(viewer_user_id))
            )
            if target_type:
                stmt = stmt.where(TagAssignmentORM.target_type == target_type)

            count_stmt = select(func.count()).select_from(stmt.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0
            paged = stmt.order_by(TagAssignmentORM.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
            result = await session.execute(paged)
            items = []
            for assignment, tag_obj in result.all():
                target_meta: dict = {}
                if assignment.target_type == TARGET_TYPE_EMAIL_THREAD:
                    email_result = await session.execute(
                        select(EmailORM.subject, EmailORM.sender, EmailORM.date, EmailORM.list_name)
                        .where(EmailORM.thread_id == assignment.target_ref)
                        .order_by(EmailORM.date.asc())
                        .limit(1)
                    )
                    row = email_result.first()
                    if row:
                        target_meta = {
                            "subject": row.subject or "",
                            "sender": row.sender or "",
                            "date": row.date.isoformat() if row.date else None,
                            "list_name": row.list_name or "",
                            "thread_id": assignment.target_ref,
                        }
                elif assignment.target_type == TARGET_TYPE_EMAIL_MESSAGE:
                    email_result = await session.execute(
                        select(
                            EmailORM.subject,
                            EmailORM.sender,
                            EmailORM.date,
                            EmailORM.list_name,
                            EmailORM.thread_id,
                        ).where(EmailORM.message_id == assignment.target_ref)
                    )
                    row = email_result.first()
                    if row:
                        target_meta = {
                            "subject": row.subject or "",
                            "sender": row.sender or "",
                            "date": row.date.isoformat() if row.date else None,
                            "list_name": row.list_name or "",
                            "thread_id": row.thread_id or "",
                            "message_id": assignment.target_ref,
                        }
                elif assignment.target_type == TARGET_TYPE_EMAIL_PARAGRAPH:
                    email_result = await session.execute(
                        select(
                            EmailORM.subject,
                            EmailORM.sender,
                            EmailORM.date,
                            EmailORM.list_name,
                            EmailORM.thread_id,
                        ).where(EmailORM.message_id == assignment.target_ref)
                    )
                    row = email_result.first()
                    if row:
                        target_meta = {
                            "subject": row.subject or "",
                            "sender": row.sender or "",
                            "date": row.date.isoformat() if row.date else None,
                            "list_name": row.list_name or "",
                            "thread_id": row.thread_id or "",
                            "message_id": assignment.target_ref,
                            "paragraph_index": assignment.anchor.get("paragraph_index", 0),
                        }
                elif assignment.target_type == TARGET_TYPE_ANNOTATION:
                    ann_result = await session.execute(
                        select(
                            AnnotationORM.annotation_type,
                            AnnotationORM.body,
                            AnnotationORM.thread_id,
                            AnnotationORM.in_reply_to,
                            AnnotationORM.target_label,
                            AnnotationORM.target_subtitle,
                            AnnotationORM.version,
                            AnnotationORM.file_path,
                            AnnotationORM.start_line,
                            AnnotationORM.end_line,
                        ).where(AnnotationORM.annotation_id == assignment.target_ref)
                    )
                    row = ann_result.first()
                    if row:
                        target_meta = {
                            "annotation_id": assignment.target_ref,
                            "annotation_type": row.annotation_type,
                            "body": row.body or "",
                            "thread_id": row.thread_id or "",
                            "in_reply_to": row.in_reply_to or "",
                            "target_label": row.target_label or "",
                            "target_subtitle": row.target_subtitle or "",
                            "version": row.version or "",
                            "file_path": row.file_path or "",
                            "start_line": row.start_line or 0,
                            "end_line": row.end_line or 0,
                        }
                elif assignment.target_type == TARGET_TYPE_KERNEL_LINE_RANGE:
                    version = ""
                    file_path = ""
                    if ":" in assignment.target_ref:
                        version, file_path = assignment.target_ref.split(":", 1)
                    target_meta = {
                        "version": version,
                        "file_path": file_path,
                        "start_line": assignment.anchor.get("start_line", 0),
                        "end_line": assignment.anchor.get("end_line", 0),
                    }

                items.append(
                    {
                        "assignment_id": assignment.assignment_id,
                        "target_type": assignment.target_type,
                        "target_ref": assignment.target_ref,
                        "anchor": assignment.anchor or {},
                        "target_meta": target_meta,
                        "tag": self._to_tag_read(tag_obj).model_dump(mode="json"),
                    }
                )
            return items, total

    async def _get_tags_for_target(
        self,
        target_type: str,
        target_ref: str,
        anchor: Optional[dict] = None,
        viewer_user_id: Optional[str] = None,
    ) -> list[TagRead]:
        async with self.session_factory() as session:
            stmt = (
                select(TagORM)
                .join(TagAssignmentORM, TagAssignmentORM.tag_id == TagORM.id)
                .where(TagAssignmentORM.target_type == target_type)
                .where(TagAssignmentORM.target_ref == target_ref)
                .where(self._visibility_filter(viewer_user_id))
                .order_by(TagORM.name.asc())
            )
            if anchor is not None:
                stmt = stmt.where(TagAssignmentORM.anchor_hash == hash_anchor(anchor))
            result = await session.execute(stmt)
            return [self._to_tag_read(tag) for tag in result.scalars().unique().all()]

    async def _get_aggregated_tags(
        self,
        target_type: str,
        target_ref: str,
        viewer_user_id: Optional[str] = None,
    ) -> list[TagRead]:
        async with self.session_factory() as session:
            stmt = await self._build_aggregated_tag_stmt(target_type, target_ref)
            if stmt is None:
                return []
            stmt = stmt.where(self._visibility_filter(viewer_user_id))
            result = await session.execute(stmt)
            return [self._to_tag_read(tag) for tag in result.scalars().unique().all()]

    async def _build_aggregated_tag_stmt(self, target_type: str, target_ref: str) -> Optional[Select]:
        if target_type == TARGET_TYPE_EMAIL_THREAD:
            message_ids = select(EmailORM.message_id).where(EmailORM.thread_id == target_ref)
            annotation_ids = select(AnnotationORM.annotation_id).where(AnnotationORM.thread_id == target_ref)
            return (
                select(TagORM)
                .join(TagAssignmentORM, TagAssignmentORM.tag_id == TagORM.id)
                .where(
                    or_(
                        and_(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_MESSAGE, TagAssignmentORM.target_ref.in_(message_ids)),
                        and_(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_PARAGRAPH, TagAssignmentORM.target_ref.in_(message_ids)),
                        and_(TagAssignmentORM.target_type == TARGET_TYPE_ANNOTATION, TagAssignmentORM.target_ref.in_(annotation_ids)),
                    )
                )
                .order_by(TagORM.name.asc())
            )
        if target_type == TARGET_TYPE_EMAIL_MESSAGE:
            annotation_ids = select(AnnotationORM.annotation_id).where(AnnotationORM.in_reply_to == target_ref)
            return (
                select(TagORM)
                .join(TagAssignmentORM, TagAssignmentORM.tag_id == TagORM.id)
                .where(
                    or_(
                        and_(TagAssignmentORM.target_type == TARGET_TYPE_EMAIL_PARAGRAPH, TagAssignmentORM.target_ref == target_ref),
                        and_(TagAssignmentORM.target_type == TARGET_TYPE_ANNOTATION, TagAssignmentORM.target_ref.in_(annotation_ids)),
                    )
                )
                .order_by(TagORM.name.asc())
            )
        if target_type == "kernel_file":
            return (
                select(TagORM)
                .join(TagAssignmentORM, TagAssignmentORM.tag_id == TagORM.id)
                .where(TagAssignmentORM.target_type == TARGET_TYPE_KERNEL_LINE_RANGE)
                .where(TagAssignmentORM.target_ref == target_ref)
                .order_by(TagORM.name.asc())
            )
        return None

    async def _resolve_tag(
        self,
        session,
        tag_id: Optional[int],
        tag_slug: str,
        tag_name: str,
        actor_user_id: str = "",
        actor_display_name: str = "",
    ) -> Optional[TagORM]:
        if tag_id is not None:
            result = await session.execute(
                select(TagORM)
                .where(TagORM.id == tag_id)
                .where(self._visibility_filter(actor_user_id or None))
            )
            return result.scalar_one_or_none()
        if tag_slug:
            result = await session.execute(
                select(TagORM)
                .where(TagORM.slug == tag_slug)
                .where(self._visibility_filter(actor_user_id or None))
            )
            tag = result.scalar_one_or_none()
            if tag:
                return tag
        if tag_name:
            result = await session.execute(
                select(TagORM)
                .outerjoin(TagAliasORM, TagAliasORM.tag_id == TagORM.id)
                .where(or_(TagORM.name == tag_name, TagAliasORM.alias == tag_name))
                .where(self._visibility_filter(actor_user_id or None))
            )
            tag = result.scalars().first()
            if tag:
                return tag
            tag = TagORM(
                slug=slugify_tag(tag_name),
                name=tag_name.strip(),
                description="",
                color=DEFAULT_TAG_COLOR,
                status="active",
                tag_kind="topic",
                visibility="public",
                owner_user_id=actor_user_id or None,
                created_by=actor_display_name or self.default_actor,
                updated_by=actor_display_name or self.default_actor,
                created_by_user_id=actor_user_id or None,
                updated_by_user_id=actor_user_id or None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(tag)
            await session.flush()
            return tag
        return None

    async def _ensure_tag_name_available(self, session, name: str, exclude_id: Optional[int] = None) -> None:
        stmt = select(TagORM).where(TagORM.name == name)
        if exclude_id is not None:
            stmt = stmt.where(TagORM.id != exclude_id)
        if (await session.execute(stmt)).scalar_one_or_none():
            raise ValueError(f"Tag '{name}' already exists")

    async def _ensure_tag_slug_available(self, session, slug: str, exclude_id: Optional[int] = None) -> None:
        stmt = select(TagORM).where(TagORM.slug == slug)
        if exclude_id is not None:
            stmt = stmt.where(TagORM.id != exclude_id)
        if (await session.execute(stmt)).scalar_one_or_none():
            raise ValueError(f"Tag slug '{slug}' already exists")

    async def _ensure_alias_available(self, session, alias: str) -> None:
        if (await session.execute(select(TagAliasORM).where(TagAliasORM.alias == alias))).scalar_one_or_none():
            raise ValueError(f"Tag alias '{alias}' already exists")

    async def _load_tag_with_aliases(self, session, tag_id: int) -> Optional[TagORM]:
        result = await session.execute(
            select(TagORM)
            .where(TagORM.id == tag_id)
            .options(selectinload(TagORM.aliases))
        )
        return result.scalar_one_or_none()

    def _to_tag_read(self, tag: TagORM) -> TagRead:
        aliases = []
        state = inspect(tag)
        aliases_attr = state.attrs.aliases
        if aliases_attr.loaded_value is not NO_VALUE:
            aliases = sorted(alias.alias for alias in (tag.aliases or []))
        return TagRead(
            id=tag.id,
            slug=tag.slug,
            name=tag.name,
            description=tag.description or "",
            parent_tag_id=tag.parent_tag_id,
            color=tag.color,
            status=tag.status,
            tag_kind=tag.tag_kind,
            visibility=tag.visibility or "public",
            aliases=aliases,
            owner_user_id=tag.owner_user_id,
            created_by=tag.created_by,
            updated_by=tag.updated_by,
            created_by_user_id=tag.created_by_user_id,
            updated_by_user_id=tag.updated_by_user_id,
            created_at=tag.created_at,
            updated_at=tag.updated_at,
        )

    def _to_assignment_read(self, assignment: TagAssignmentORM, tag: TagORM) -> TagAssignmentRead:
        return TagAssignmentRead(
            id=assignment.id,
            assignment_id=assignment.assignment_id,
            tag_id=tag.id,
            tag_slug=tag.slug,
            tag_name=tag.name,
            target_type=assignment.target_type,
            target_ref=assignment.target_ref,
            anchor=assignment.anchor or {},
            anchor_hash=assignment.anchor_hash or "",
            assignment_scope=assignment.assignment_scope or "direct",
            source_type=assignment.source_type or "manual",
            evidence=assignment.evidence or {},
            created_by=assignment.created_by or self.default_actor,
            created_by_user_id=assignment.created_by_user_id,
            created_at=assignment.created_at,
        )

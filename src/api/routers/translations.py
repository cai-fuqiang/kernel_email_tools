"""translations API routes."""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from src.api import state
from src.api.deps import (
    CurrentUser, get_current_user, get_optional_current_user, require_roles,
    _is_admin, _normalize_role, _normalize_visibility, _normalize_approval_status,
    _normalize_publish_status, _ensure_public_write_allowed, _capabilities_for_role,
    _ensure_tag_manage_access, _resolve_tag_for_write, _ensure_tag_assignment_write_allowed,
    _ensure_tag_assignment_delete_access, _ensure_annotation_manage_access,
    _ensure_annotation_publish_request_access, _to_current_user_read, _get_user_orm,
    _hash_password, _verify_password, _hash_session_token, _serialize_user,
    _create_user_session, _clear_session_cookie, _revoke_session_by_token,
    _set_session_cookie, _session_cookie_name, _session_ttl_hours,
    _allow_public_registration, _require_admin_approval, _allow_header_auth_fallback,
    _local_auth_config, _header_name, _pbkdf2_iterations, _fallback_user,
    _resolve_user_from_session,
)
from src.api.schemas import AnnotationResponse, DraftApplyRequest, DraftApplyResponse
from src.storage.tag_store import TARGET_TYPE_EMAIL_THREAD

logger = logging.getLogger(__name__)

router = APIRouter(tags=["translations"])

class TranslateRequest(BaseModel):
    """翻译请求。"""
    text: str = Field(..., min_length=1, description="待翻译的原文")
    source_lang: str = Field("auto", description="源语言（默认 auto 自动检测）")
    target_lang: str = Field("zh-CN", description="目标语言（默认 zh-CN 中文）")


class TranslateResponse(BaseModel):
    """翻译响应。"""
    translation: str
    cached: bool = False


class TranslateBatchRequest(BaseModel):
    """批量翻译请求。"""
    texts: list[str] = Field(..., min_length=1, max_length=50, description="待翻译的原文列表（最多 50 条）")
    source_lang: str = Field("auto", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")
    message_id: Optional[str] = Field(None, description="关联的邮件 Message-ID（可选，用于翻译缓存关联邮件标签）")


class TranslateBatchResponse(BaseModel):
    """批量翻译响应。"""
    translations: list[str]
    cached_count: int = 0


class ThreadTranslateRequest(BaseModel):
    """线程翻译任务请求。"""
    thread_id: str = Field(..., min_length=1, description="线程 ID")
    source_lang: str = Field("auto", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")


class TranslationJobItem(BaseModel):
    """线程翻译任务中的单条结果。"""
    source_text: str
    translated_text: str = ""
    message_id: str = ""
    cached: bool = False
    error: str = ""


class TranslationJobResponse(BaseModel):
    """线程翻译任务状态。"""
    job_id: str
    thread_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    email_count: int = 0
    status: str
    total: int = 0
    completed: int = 0
    cached_count: int = 0
    failed_count: int = 0
    progress_percent: float = 0.0
    items: list[TranslationJobItem] = Field(default_factory=list)
    error: str = ""
    created_at: str
    updated_at: str


class TranslationJobListResponse(BaseModel):
    """运行中的线程翻译任务列表。"""
    jobs: list[TranslationJobResponse]
    total: int


@router.post("/api/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """翻译文本。
    
    支持单条翻译，自动缓存结果避免重复翻译相同内容。
    """
    if not state._translator:
        raise HTTPException(
            status_code=503,
            detail="Translation service not available. Please install deep-translator: pip install deep-translator"
        )

    text = request.text.strip()
    if not text:
        return TranslateResponse(translation="", cached=False)

    # 先检查缓存
    if state._translation_cache:
        cached = await state._translation_cache.get(
            text, request.source_lang, request.target_lang
        )
        if cached is not None:
            return TranslateResponse(translation=cached, cached=True)

    # 调用翻译服务
    try:
        translation = await state._translator.translate(
            text, request.source_lang, request.target_lang
        )
    except TranslationError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 缓存结果
    if state._translation_cache:
        await state._translation_cache.set(
            text, translation, request.source_lang, request.target_lang
        )

    return TranslateResponse(translation=translation, cached=False)


@router.post("/api/translate/batch", response_model=TranslateBatchResponse)
async def translate_batch(request: TranslateBatchRequest):
    """批量翻译文本。
    
    最多支持 50 条文本批量翻译，自动利用缓存。
    """
    if not state._translator:
        raise HTTPException(
            status_code=503,
            detail="Translation service not available"
        )
    
    # 确保 target_lang 是有效的中文
    target_lang = request.target_lang
    if target_lang not in ("zh-CN", "zh"):
        logger.info(f"Invalid target_lang '{target_lang}', using 'zh-CN'")
        target_lang = "zh-CN"
    
    texts = [t.strip() for t in request.texts if t.strip()]
    if not texts:
        return TranslateBatchResponse(translations=[], cached_count=0)
    
    translations = []
    cached_count = 0
    
    # 批量查询缓存
    if state._translation_cache:
        cache_results = await state._translation_cache.get_batch(
            texts, request.source_lang, target_lang
        )
    else:
        cache_results = {text: None for text in texts}
    
    # 处理每条文本
    for text in texts:
        cached = cache_results.get(text)
        if cached is not None:
            translations.append(cached)
            cached_count += 1
            logger.debug(f"Cache hit for text: '{text[:50]}...' -> '{cached[:50]}...'")
        else:
            try:
                translation = await state._translator.translate(
                    text, request.source_lang, target_lang
                )
                translations.append(translation)
                logger.debug(f"Translated: '{text[:30]}...' -> '{translation[:30]}...'")
                # 缓存翻译结果
                if state._translation_cache:
                    await state._translation_cache.set(
                        text, translation, request.source_lang, target_lang,
                        message_id=request.message_id,
                    )
            except TranslationError as e:
                logger.warning(f"Translation failed for text: {str(e)}")
                translations.append(text)  # 返回原文作为 fallback
    
    return TranslateBatchResponse(translations=translations, cached_count=cached_count)


@router.post("/api/translate/thread", response_model=TranslationJobResponse)
async def translate_thread(request: ThreadTranslateRequest):
    """创建线程翻译后台任务。"""
    if not state._translator or not state._storage:
        raise HTTPException(status_code=503, detail="Translation service not available")

    existing_job_id = state._translation_jobs_by_thread.get(request.thread_id)
    if existing_job_id:
        existing = state._translation_jobs.get(existing_job_id)
        if existing and existing.get("status") in {"pending", "running"}:
            return _translation_job_to_response(existing)

    now = datetime.utcnow().isoformat()
    job_id = f"translate-job-{uuid.uuid4().hex[:12]}"
    job = {
        "job_id": job_id,
        "thread_id": request.thread_id,
        "source_lang": request.source_lang,
        "target_lang": request.target_lang if request.target_lang in {"zh-CN", "zh"} else "zh-CN",
        "status": "pending",
        "total": 0,
        "completed": 0,
        "cached_count": 0,
        "failed_count": 0,
        "items": [],
        "error": "",
        "created_at": now,
        "updated_at": now,
    }
    state._translation_jobs[job_id] = job
    state._translation_jobs_by_thread[request.thread_id] = job_id
    asyncio.create_task(_run_thread_translation_job(job_id))
    return _translation_job_to_response(job)


@router.get("/api/translate/jobs/{job_id}", response_model=TranslationJobResponse)
async def get_translation_job(job_id: str):
    """查询线程翻译任务状态。"""
    job = state._translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Translation job not found: {job_id}")
    return _translation_job_to_response(job)


@router.get("/api/translate/jobs", response_model=TranslationJobListResponse)
async def list_translation_jobs(
    status: str = Query("active", description="active | all"),
):
    """列出线程翻译任务。"""
    if status == "active":
        jobs = [
            _translation_job_to_response(job)
            for job in state._translation_jobs.values()
            if job.get("status") in {"pending", "running"}
        ]
    else:
        jobs = [_translation_job_to_response(job) for job in state._translation_jobs.values()]

    jobs.sort(key=lambda job: job.updated_at, reverse=True)
    return TranslationJobListResponse(jobs=jobs, total=len(jobs))


@router.get("/api/translate/health")
async def translate_health():
    """翻译服务健康检查。"""
    return {
        "available": is_translator_available(),
        "translator": "google",
        "cache_enabled": state._translation_cache is not None,
    }


class ClearCacheRequest(BaseModel):
    """清除缓存请求模型。"""
    scope: str = Field("paragraph", description="清除范围: 'paragraph' 清除单条, 'all' 清除全部")
    text_hash: Optional[str] = Field(None, description="段落文本的 SHA256 哈希（scope='paragraph' 时必填）")


class ClearCacheResponse(BaseModel):
    """清除缓存响应模型。"""
    success: bool
    message: str
    cleared_count: int = 0


@router.delete("/api/translate/cache", response_model=ClearCacheResponse)
async def clear_translation_cache(request: ClearCacheRequest = Body(...)):
    """清除翻译缓存。

    - scope='paragraph': 清除指定段落的缓存（需要提供 text_hash）
    - scope='all': 清除全部翻译缓存
    """
    if not state._translation_cache:
        return ClearCacheResponse(
            success=False,
            message="Translation cache not initialized",
            cleared_count=0,
        )

    try:
        if request.scope == "all":
            cleared = await state._translation_cache.clear_all()
            logger.info(f"Cleared all translation cache: {cleared} entries")
            return ClearCacheResponse(
                success=True,
                message=f"All translation cache cleared ({cleared} entries)",
                cleared_count=cleared,
            )
        elif request.scope == "paragraph":
            if not request.text_hash:
                raise HTTPException(status_code=400, detail="text_hash is required for 'paragraph' scope")
            deleted = await state._translation_cache.delete(request.text_hash)
            logger.info(f"Cleared translation cache for hash: {request.text_hash}, deleted={deleted}")
            return ClearCacheResponse(
                success=True,
                message="Paragraph cache cleared" if deleted else "Cache entry not found",
                cleared_count=1 if deleted else 0,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid scope. Must be 'paragraph' or 'all'"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear translation cache: {e}")
        return ClearCacheResponse(
            success=False,
            message=f"Failed to clear cache: {str(e)}",
            cleared_count=0,
        )


class TranslatedThreadInfo(BaseModel):
    """已翻译线程信息。"""
    thread_id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    list_name: str = ""
    email_count: int = 0
    cached_paragraphs: int = 0
    tags: list[str] = []
    last_translated_at: Optional[str] = None


class TranslatedThreadsResponse(BaseModel):
    """已翻译线程列表响应。"""
    threads: list[TranslatedThreadInfo]
    total: int


@router.get("/api/translate/threads", response_model=TranslatedThreadsResponse)
async def get_translated_threads():
    """获取有翻译缓存的线程列表（含邮件标签）。

    通过 translation_cache.message_id 关联 emails 表，
    按 thread_id 分组，返回每个线程的翻译统计和标签信息。
    每次请求创建新 session，避免长生命周期 session 过期问题。
    """
    if not state._storage:
        return TranslatedThreadsResponse(threads=[], total=0)

    try:
        from src.storage.translation_cache import TranslationCache
        from src.storage.models import EmailORM
        from sqlalchemy import func as sa_func

        async with state._storage.session_factory() as session:
            # 查询有缓存的 message_id 及其缓存数量和最近翻译时间
            cache_stmt = (
                select(
                    TranslationCache.message_id,
                    sa_func.count().label("cached_count"),
                    sa_func.max(TranslationCache.created_at).label("last_translated"),
                )
                .where(TranslationCache.message_id.isnot(None))
                .group_by(TranslationCache.message_id)
            )
            cache_result = await session.execute(cache_stmt)
            cache_rows = cache_result.all()

            if not cache_rows:
                return TranslatedThreadsResponse(threads=[], total=0)

            # 构建 message_id -> cache_info 映射
            cache_map = {
                row.message_id: {
                    "cached_count": row.cached_count,
                    "last_translated": row.last_translated,
                }
                for row in cache_rows
            }

            # 查询这些邮件的详细信息
            email_stmt = select(EmailORM).where(
                EmailORM.message_id.in_(list(cache_map.keys()))
            )
            email_result = await session.execute(email_stmt)
            emails = email_result.scalars().all()

            # 按 thread_id 分组
            thread_groups: dict[str, dict] = {}
            for email in emails:
                tid = email.thread_id or email.message_id
                if tid not in thread_groups:
                    thread_groups[tid] = {
                        "thread_id": tid,
                        "subject": email.subject,
                        "sender": email.sender,
                        "date": email.date.isoformat() if email.date else None,
                        "list_name": email.list_name,
                        "email_count": 0,
                        "cached_paragraphs": 0,
                        "tags": set(),
                        "last_translated_at": None,
                    }
                group = thread_groups[tid]
                group["email_count"] += 1
                cache_info = cache_map.get(email.message_id, {})
                group["cached_paragraphs"] += cache_info.get("cached_count", 0)
                # 合并标签
                if state._tag_store:
                    thread_tags = await state._tag_store.get_target_tag_names(
                        TARGET_TYPE_EMAIL_THREAD,
                        tid,
                    )
                    group["tags"].update(thread_tags)
                # 更新最近翻译时间
                lt = cache_info.get("last_translated")
                if lt:
                    lt_str = lt.isoformat() if hasattr(lt, "isoformat") else str(lt)
                    if not group["last_translated_at"] or lt_str > group["last_translated_at"]:
                        group["last_translated_at"] = lt_str

            # 转为列表并排序
            threads = [
                TranslatedThreadInfo(
                    thread_id=g["thread_id"],
                    subject=g["subject"],
                    sender=g["sender"],
                    date=g["date"],
                    list_name=g["list_name"],
                    email_count=g["email_count"],
                    cached_paragraphs=g["cached_paragraphs"],
                    tags=sorted(g["tags"]),
                    last_translated_at=g["last_translated_at"],
                )
                for g in thread_groups.values()
            ]
            threads.sort(key=lambda t: t.last_translated_at or "", reverse=True)

            return TranslatedThreadsResponse(threads=threads, total=len(threads))

    except Exception as e:
        logger.error(f"Failed to get translated threads: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get translated threads: {str(e)}")


class ManualTranslateRequest(BaseModel):
    """人工翻译请求模型。"""
    original_text: str = Field(..., description="原文")
    translated_text: str = Field(..., description="人工翻译后的文本")
    source_lang: str = Field("en", description="源语言")
    target_lang: str = Field("zh-CN", description="目标语言")


class ManualTranslateResponse(BaseModel):
    """人工翻译响应模型。"""
    success: bool
    message: str
    cache_key: Optional[str] = None


@router.put("/api/translate/manual", response_model=ManualTranslateResponse)
async def manual_translate(request: ManualTranslateRequest = Body(...)):
    """人工翻译接口 - 将用户提供的翻译缓存起来。

    用于用户手动翻译特定段落并保存到缓存，
    下次翻译相同内容时直接返回人工翻译结果。
    """
    if not state._translation_cache:
        return ManualTranslateResponse(
            success=False,
            message="Translation cache not initialized",
        )

    try:
        cache_key = await state._translation_cache.set_manual_translation(
            original_text=request.original_text,
            translated_text=request.translated_text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
        )
        logger.info(f"Manual translation cached: key={cache_key}")
        return ManualTranslateResponse(
            success=True,
            message="Manual translation saved to cache",
            cache_key=cache_key,
        )
    except Exception as e:
        logger.error(f"Failed to save manual translation: {e}")
        return ManualTranslateResponse(
            success=False,
            message=f"Failed to save: {str(e)}",
        )



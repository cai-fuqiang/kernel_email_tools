"""kernel API routes."""

import asyncio
import re
from datetime import datetime
from urllib.parse import quote
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
from src.api.schemas import (
    AnnotationResponse,
    DraftApplyRequest,
    DraftApplyResponse,
    _annotation_to_response,
)
from src.kernel_source.fallback import FallbackKernelSource
from src.kernel_source.elixir import ElixirSource
from src.kernel_source.git_local import GitLocalSource
from src.storage.models import AnnotationCreate, AnnotationORM, AnnotationUpdate

router = APIRouter(tags=["kernel"])


def _encode_kernel_path(path: str) -> str:
    return "/".join(quote(part, safe="") for part in path.split("/") if part)


def _external_links_cfg() -> dict:
    return state._app_config.get("external_links", {}) or {}


def _elixir_supports_version(version: str) -> bool:
    if not version:
        return False
    v = version.strip()
    if v in {"latest", "master"}:
        return True
    import re

    m = re.match(r"^v?(\d+)\.(\d+)(?:\.(\d+))?", v)
    if not m:
        return True
    major = int(m.group(1))
    minor = int(m.group(2))
    patch = int(m.group(3) or 0)
    if major < 2:
        return False
    if major == 2 and minor < 6:
        return False
    if major == 2 and minor == 6 and patch < 12:
        return False
    return True


def _elixir_url(version: str, path: str, line: int | None = None) -> str:
    base = (_external_links_cfg().get("elixir_base") or "https://elixir.bootlin.com/linux").rstrip("/")
    url = f"{base}/{quote(version, safe='')}/source/{_encode_kernel_path(path)}"
    if line and line > 0:
        url += f"#L{line}"
    return url


def _git_kernel_url(version: str, path: str, line: int | None = None) -> str:
    base = (
        _external_links_cfg().get("git_base")
        or "https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git"
    ).rstrip("/")
    url = f"{base}/tree/{_encode_kernel_path(path)}?h={quote(version, safe='')}"
    if line and line > 0:
        url += f"#n{line}"
    return url


def _fallback_source_url(version: str, path: str, line: int | None = None) -> tuple[str, str]:
    if _elixir_supports_version(version):
        return _elixir_url(version, path, line), "elixir"
    return _git_kernel_url(version, path, line), "git.kernel.org"


def _local_code_url(version: str, path: str, line: int | None = None) -> str:
    params = f"v={quote(version, safe='')}&path={quote(path, safe='')}"
    if line and line > 0:
        params += f"&line={line}"
    return f"/app/kernel-code?{params}"


def _local_git_source():
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")
    source = state._kernel_source
    local_source = source._primary if isinstance(source, FallbackKernelSource) else source
    if not isinstance(local_source, GitLocalSource):
        raise HTTPException(status_code=503, detail="Local git source is not available")
    return local_source


def _normalize_kernel_path(path: str) -> str:
    normalized_path = path.strip().lstrip("/")
    if not normalized_path or ".." in normalized_path.split("/"):
        raise HTTPException(status_code=400, detail="Invalid kernel source path")
    return normalized_path


def _normalize_kernel_symbol(symbol: str) -> str:
    normalized_symbol = symbol.strip()
    if not normalized_symbol or not re.match(r"^[A-Za-z_][A-Za-z0-9_]{1,127}$", normalized_symbol):
        raise HTTPException(status_code=400, detail="Invalid kernel symbol")
    return normalized_symbol


async def _run_local_git(source: GitLocalSource, *args: str, timeout: float = 20.0) -> str:
    try:
        return await asyncio.wait_for(source._run_git(*args), timeout=timeout)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git command timed out")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


_TRAILER_RE = re.compile(r"^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$")
_LORE_RE = re.compile(r"https?://lore\.kernel\.org/\S+")
_URL_RE = re.compile(r"https?://[^\s>]+")


def _parse_commit_trailers(message: str) -> dict[str, list[str]]:
    trailers: dict[str, list[str]] = {}
    for raw_line in message.splitlines():
        line = raw_line.strip()
        match = _TRAILER_RE.match(line)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        trailers.setdefault(key, []).append(value)
    return trailers


def _extract_urls(message: str) -> list[str]:
    urls: list[str] = []
    seen = set()
    for match in _URL_RE.finditer(message):
        url = match.group(0).rstrip(".,);]")
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def _history_entry(
    commit_hash: str,
    short_hash: str,
    author_name: str,
    author_email: str,
    author_time: str,
    subject: str,
    message: str = "",
    changed_files: list[dict] | None = None,
    patch: str = "",
) -> dict:
    commit_hash = commit_hash.lstrip("^")
    short_hash = short_hash.lstrip("^") or commit_hash[:12]
    trailers = _parse_commit_trailers(message)
    urls = _extract_urls(message)
    lore_links = [url for url in urls if _LORE_RE.match(url)]
    return {
        "commit_hash": commit_hash,
        "short_hash": short_hash,
        "author_name": author_name,
        "author_email": author_email,
        "author_time": author_time,
        "subject": subject,
        "message": message,
        "trailers": trailers,
        "urls": urls,
        "lore_links": lore_links,
        "has_lore_link": bool(lore_links or trailers.get("Link")),
        "changed_files": changed_files or [],
        "patch": patch,
    }


def _normalize_commit_hash(commit_hash: str) -> str:
    normalized = commit_hash.strip().lstrip("^")
    if not re.match(r"^[0-9a-fA-F]{7,64}$", normalized):
        raise HTTPException(status_code=400, detail="Invalid commit hash")
    return normalized

@router.get("/api/kernel/versions")
async def kernel_versions(
    filter: str = Query("release", description="版本过滤: release(正式版) 或 all(含rc)"),
):
    """获取所有可用的内核版本列表。

    返回按版本号降序排列的版本信息列表，支持过滤 rc 版本。
    """
    if not state._kernel_source:
        raise HTTPException(
            status_code=503,
            detail="Kernel source not initialized. Please configure kernel_source.repo_path in settings.yaml",
        )

    include_rc = (filter == "all")
    versions = await state._kernel_source.list_versions(include_rc=include_rc)
    return {
        "versions": [
            {
                "tag": v.tag,
                "major": v.major,
                "minor": v.minor,
                "patch": v.patch,
                "rc": v.rc,
                "is_release": v.is_release,
            }
            for v in versions
        ],
        "total": len(versions),
    }


@router.get("/api/kernel/tree/{version}/{path:path}")
async def kernel_tree(version: str, path: str = ""):
    """获取指定版本、指定路径下的目录树。

    Args:
        version: 版本 tag（如 v6.1）。
        path: 相对路径（空字符串表示根目录）。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        entries = await state._kernel_source.list_tree(version, path)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "version": version,
        "path": path,
        "entries": [
            {
                "name": e.name,
                "path": e.path,
                "type": e.entry_type.value,
                "size": e.size,
            }
            for e in entries
        ],
        "total": len(entries),
    }


@router.get("/api/kernel/tree/{version}")
async def kernel_tree_root(version: str):
    """获取指定版本根目录树（无 path 参数时的路由）。"""
    return await kernel_tree(version, "")


@router.get("/api/kernel/file/{version}/{path:path}")
async def kernel_file(version: str, path: str):
    """获取指定版本、指定文件的内容。

    Args:
        version: 版本 tag。
        path: 文件相对路径。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    try:
        file_content = await state._kernel_source.get_file(version, path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "version": file_content.version,
        "path": file_content.path,
        "content": file_content.content,
        "line_count": file_content.line_count,
        "size": file_content.size,
        "truncated": file_content.truncated,
    }




class CodeAnnotationCreateRequest(BaseModel):
    """创建代码注释请求。"""
    version: str = Field(..., description="内核版本 tag")
    file_path: str = Field(..., description="文件相对路径")
    start_line: int = Field(..., ge=1, description="起始行号")
    end_line: int = Field(..., ge=1, description="结束行号")
    body: str = Field(..., min_length=1, description="注释正文（支持 Markdown）")
    author: Optional[str] = Field(None, description="作者名称")
    visibility: str = Field("public", description="public | private")
    in_reply_to: Optional[str] = Field(None, description="回复的父 annotation_id")


class CodeAnnotationUpdateRequest(BaseModel):
    """更新代码注释请求。"""
    body: str = Field(..., min_length=1, description="注释正文")
    visibility: Optional[str] = Field(None, description="public | private")


class KernelSymbolCandidateResponse(BaseModel):
    version: str
    path: str
    line: int
    local_url: str
    external_url: str
    local_file_available: bool
    source: str


class KernelSymbolResolveResponse(BaseModel):
    symbol: str
    version: str
    query_url: str
    source: str
    resolved: bool
    candidates: list[KernelSymbolCandidateResponse]
    fallback_reason: str | None = None


@router.get("/api/kernel/resolve")
async def kernel_resolve(
    version: str = Query(..., min_length=1, description="内核版本 tag"),
    path: str = Query(..., min_length=1, description="仓库内相对文件路径"),
    line: Optional[int] = Query(None, ge=1, description="可选行号"),
):
    """解析源码跳转目标，优先返回本系统本地 Code Browser。

    这是 PLAN-30002 Phase 6 的最小 resolver：只处理 path/line，不做符号解析。
    本地 git 有对应文件时返回 `source=local`；否则返回 Elixir/git.kernel.org
    fallback URL，前端可用同一响应决定点击目标和 tooltip。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    normalized_path = path.strip().lstrip("/")
    if not normalized_path or ".." in normalized_path.split("/"):
        raise HTTPException(status_code=400, detail="Invalid kernel source path")

    source = state._kernel_source
    local_source = source._primary if isinstance(source, FallbackKernelSource) else source

    local_error = None
    try:
        file_content = await local_source.get_file(version, normalized_path)
        fallback_url, fallback_source = _fallback_source_url(version, normalized_path, line)
        return {
            "source": "local",
            "url": _local_code_url(version, normalized_path, line),
            "external_url": fallback_url,
            "external_source": fallback_source,
            "local_file_available": True,
            "resolved_version": file_content.version,
            "path": file_content.path,
            "line": line,
            "line_count": file_content.line_count,
            "fallback_reason": None,
        }
    except (FileNotFoundError, ValueError) as e:
        local_error = str(e)

    fallback_url, fallback_source = _fallback_source_url(version, normalized_path, line)
    return {
        "source": fallback_source,
        "url": fallback_url,
        "external_url": fallback_url,
        "external_source": fallback_source,
        "local_file_available": False,
        "resolved_version": version,
        "path": normalized_path,
        "line": line,
        "line_count": None,
        "fallback_reason": local_error,
    }


@router.get("/api/kernel/symbol-resolve", response_model=KernelSymbolResolveResponse)
async def kernel_symbol_resolve(
    version: str = Query(..., min_length=1, description="内核版本 tag"),
    symbol: str = Query(..., min_length=1, description="符号名"),
    limit: int = Query(10, ge=1, le=20, description="最多返回候选数"),
):
    """解析符号并返回候选源码位置。

    这条路径把符号请求交给 Elixir ident 页面，再把解析出的候选行号回填给
    本地 Code Browser。前端拿到 `local_url` 后就能直接跳到本地代码行。
    """
    if not state._kernel_source:
        raise HTTPException(status_code=503, detail="Kernel source not initialized")

    normalized_symbol = _normalize_kernel_symbol(symbol)
    limit_value = limit if isinstance(limit, int) else 10
    query_url = f"https://elixir.bootlin.com/linux/{quote(version, safe='')}/ident/{quote(normalized_symbol, safe='')}"

    source = state._kernel_source
    local_source = source._primary if isinstance(source, FallbackKernelSource) else source
    local_available = hasattr(local_source, "get_file")

    elixir_source = ElixirSource()
    try:
        elixir_candidates = await elixir_source.resolve_symbol(version, normalized_symbol, limit=limit_value)
    except FileNotFoundError as e:
        return KernelSymbolResolveResponse(
            symbol=normalized_symbol,
            version=version,
            query_url=query_url,
            source="elixir",
            resolved=False,
            candidates=[],
            fallback_reason=str(e),
        )
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    candidates: list[KernelSymbolCandidateResponse] = []
    for candidate in elixir_candidates:
        candidate_path = _normalize_kernel_path(str(candidate.get("path", "")))
        candidate_line = int(candidate.get("line") or 0)
        external_url = str(candidate.get("url") or _elixir_url(version, candidate_path, candidate_line))
        local_file_available = False
        if local_available:
            try:
                await local_source.get_file(version, candidate_path)  # type: ignore[attr-defined]
                local_file_available = True
            except (FileNotFoundError, ValueError):
                local_file_available = False

        candidates.append(
            KernelSymbolCandidateResponse(
                version=str(candidate.get("version") or version),
                path=candidate_path,
                line=candidate_line,
                local_url=_local_code_url(version, candidate_path, candidate_line),
                external_url=external_url,
                local_file_available=local_file_available,
                source="local" if local_file_available else "elixir",
            )
        )

    return KernelSymbolResolveResponse(
        symbol=normalized_symbol,
        version=version,
        query_url=query_url,
        source="elixir",
        resolved=bool(candidates),
        candidates=candidates,
        fallback_reason=None,
    )


@router.get("/api/kernel/blame")
async def kernel_blame(
    version: str = Query(..., min_length=1, description="内核版本 tag"),
    path: str = Query(..., min_length=1, description="仓库内相对文件路径"),
    line: int = Query(..., ge=1, description="行号"),
):
    """返回某行最后一次修改的 commit 摘要。"""
    source = _local_git_source()
    normalized_path = _normalize_kernel_path(path)
    output = await _run_local_git(
        source,
        "blame",
        "--porcelain",
        "-L",
        f"{line},{line}",
        version,
        "--",
        normalized_path,
    )
    lines = output.splitlines()
    if not lines:
        raise HTTPException(status_code=404, detail="No blame information found")
    commit_hash = lines[0].split()[0].lstrip("^")
    meta: dict[str, str] = {}
    for raw_line in lines[1:]:
        if raw_line.startswith("\t"):
            break
        key, _, value = raw_line.partition(" ")
        if key and value:
            meta[key] = value
    return _history_entry(
        commit_hash=commit_hash,
        short_hash=commit_hash[:12],
        author_name=meta.get("author", ""),
        author_email=meta.get("author-mail", "").strip("<>"),
        author_time=meta.get("author-time", ""),
        subject=meta.get("summary", ""),
    )


@router.get("/api/kernel/line-history")
async def kernel_line_history(
    version: str = Query(..., min_length=1, description="内核版本 tag"),
    path: str = Query(..., min_length=1, description="仓库内相对文件路径"),
    start_line: int = Query(..., ge=1, description="起始行号"),
    end_line: int = Query(..., ge=1, description="结束行号"),
    limit: int = Query(12, ge=1, le=40, description="最多返回 commit 数"),
):
    """返回某段代码的历史 commit 列表。

    使用 `git log -L` 追踪选区历史。响应只返回 commit 元数据、trailers 和
    URL 线索，不返回完整 patch，避免前端列表过重。
    """
    source = _local_git_source()
    normalized_path = _normalize_kernel_path(path)
    if end_line < start_line:
        start_line, end_line = end_line, start_line
    if end_line - start_line > 79:
        raise HTTPException(status_code=400, detail="Line history range is limited to 80 lines")

    fmt = "%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B"
    output = await _run_local_git(
        source,
        "log",
        "--no-color",
        f"--max-count={limit}",
        f"--format={fmt}",
        "-L",
        f"{start_line},{end_line}:{normalized_path}",
        version,
        timeout=35.0,
    )
    entries = []
    for chunk in output.split("\x1e"):
        chunk = chunk.strip()
        if not chunk:
            continue
        header, _, _patch = chunk.partition("\ndiff --git")
        parts = header.split("\x1f", 6)
        if len(parts) < 7:
            continue
        commit_hash, short_hash, author_name, author_email, author_time, subject, message = parts
        entries.append(
            _history_entry(
                commit_hash=commit_hash.strip(),
                short_hash=short_hash.strip(),
                author_name=author_name.strip(),
                author_email=author_email.strip(),
                author_time=author_time.strip(),
                subject=subject.strip(),
                message=message.strip(),
            )
        )
    return {
        "version": version,
        "path": normalized_path,
        "start_line": start_line,
        "end_line": end_line,
        "commits": entries[:limit],
        "total": len(entries[:limit]),
    }


@router.get("/api/kernel/commit")
async def kernel_commit(
    version: str = Query(..., min_length=1, description="内核版本 tag"),
    commit_hash: str = Query(..., min_length=7, max_length=64, description="commit hash"),
):
    """返回 commit 详情、trailers、URL 和 changed files。"""
    source = _local_git_source()
    normalized_commit_hash = _normalize_commit_hash(commit_hash)

    fmt = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B"
    message_output = await _run_local_git(
        source,
        "show",
        "--no-patch",
        f"--format={fmt}",
        normalized_commit_hash,
    )
    parts = message_output.split("\x1f", 6)
    if len(parts) < 7:
        raise HTTPException(status_code=404, detail="Commit not found")

    files_output = await _run_local_git(
        source,
        "show",
        "--numstat",
        "--format=",
        normalized_commit_hash,
    )
    patch_output = await _run_local_git(
        source,
        "show",
        "--no-ext-diff",
        "--find-renames",
        "--format=",
        "--patch",
        normalized_commit_hash,
        timeout=20.0,
    )
    max_patch_chars = 180_000
    patch_truncated = len(patch_output) > max_patch_chars
    changed_files = []
    for raw_line in files_output.splitlines():
        fields = raw_line.split("\t")
        if len(fields) < 3:
            continue
        changed_files.append({
            "added": fields[0],
            "deleted": fields[1],
            "path": fields[2],
        })

    commit_hash_full, short_hash, author_name, author_email, author_time, subject, message = parts
    entry = _history_entry(
        commit_hash=commit_hash_full.strip(),
        short_hash=short_hash.strip(),
        author_name=author_name.strip(),
        author_email=author_email.strip(),
        author_time=author_time.strip(),
        subject=subject.strip(),
        message=message.strip(),
        changed_files=changed_files,
        patch=patch_output[:max_patch_chars],
    )
    entry["version"] = version
    entry["patch_truncated"] = patch_truncated
    return entry


@router.get("/api/kernel/annotations")
async def list_code_annotations(
    q: Optional[str] = Query(None, description="搜索关键词"),
    version: Optional[str] = Query(None, description="限定版本"),
    publish_status: Optional[str] = Query(None, description="公开申请状态过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """代码标注总览，基于统一 annotation store。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    if q and q.strip():
        extra_filters = [AnnotationORM.version == version] if version else []
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)
        annotations, total = await state._annotation_store.search(
            keyword=q.strip(),
            annotation_type="code",
            page=page,
            page_size=page_size,
            extra_filters=extra_filters or None,
            viewer_user_id=current_user.user_id if current_user else None,
            include_all_private=bool(current_user and _is_admin(current_user)),
        )
    else:
        extra_filters = [AnnotationORM.version == version] if version else []
        normalized_publish_status = _normalize_publish_status(publish_status or "")
        if publish_status and normalized_publish_status != "none":
            extra_filters.append(AnnotationORM.publish_status == normalized_publish_status)
        annotations, total = await state._annotation_store.list_all(
            annotation_type="code",
            page=page,
            page_size=page_size,
            extra_filters=extra_filters or None,
            viewer_user_id=current_user.user_id if current_user else None,
            include_all_private=bool(current_user and _is_admin(current_user)),
        )

    return {
        "annotations": annotations,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/api/kernel/annotations/{version}/{path:path}")
async def get_file_code_annotations(
    version: str,
    path: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_current_user),
):
    """获取指定文件的注释列表。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")

    annotations = await state._annotation_store.list_by_code(
        version,
        path,
        viewer_user_id=current_user.user_id if current_user else None,
        include_all_private=bool(current_user and _is_admin(current_user)),
    )
    return [_annotation_to_response(a).model_dump() for a in annotations]


@router.post("/api/kernel/annotations")
async def create_code_annotation(
    request: CodeAnnotationCreateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """创建代码注释。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    visibility = _normalize_visibility(request.visibility)
    if request.in_reply_to and not _is_admin(current_user):
        visibility = "private"
    _ensure_public_write_allowed(visibility, current_user)

    try:
        annotation = await state._annotation_store.create(
            AnnotationCreate(
                annotation_type="code",
                body=request.body,
                author=current_user.display_name,
                author_user_id=current_user.user_id,
                visibility=visibility,
                parent_annotation_id=request.in_reply_to or "",
                target_type="kernel_file",
                target_ref=f"{request.version}:{request.file_path}",
                target_label=request.file_path,
                target_subtitle=request.version,
                anchor={
                    "start_line": request.start_line,
                    "end_line": request.end_line,
                },
                version=request.version,
                file_path=request.file_path,
                start_line=request.start_line,
                end_line=request.end_line,
            ),
            actor_user_id=current_user.user_id,
            actor_display_name=current_user.display_name,
        )
        return _annotation_to_response(annotation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/kernel/annotations/{annotation_id}")
async def update_code_annotation(
    annotation_id: str,
    request: CodeAnnotationUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """更新代码注释正文。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)
    if request.visibility is not None:
        _ensure_public_write_allowed(request.visibility, current_user)

    updated = await state._annotation_store.update(
        annotation_id,
        AnnotationUpdate(body=request.body, visibility=request.visibility),
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")

    return _annotation_to_response(updated)


@router.delete("/api/kernel/annotations/{annotation_id}")
async def delete_code_annotation(
    annotation_id: str,
    current_user: CurrentUser = Depends(require_roles("admin", "editor")),
):
    """删除代码注释。"""
    if not state._annotation_store:
        raise HTTPException(status_code=503, detail="Annotation store not initialized")
    await _ensure_annotation_manage_access(annotation_id, current_user)

    deleted = await state._annotation_store.delete(annotation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Annotation {annotation_id} not found")
    return {"status": "ok", "annotation_id": annotation_id}

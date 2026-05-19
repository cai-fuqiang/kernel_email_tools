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

_PATCH_EXPAND_STEP_SIZE = 20


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
_DIFF_GIT_RE = re.compile(r"^diff --git a/(.+?) b/(.+)$")
_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


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


def _new_patch_file(path: str, old_path: str | None = None, new_path: str | None = None) -> dict:
    resolved_old = old_path or path
    resolved_new = new_path or path
    return {
        "path": resolved_new or resolved_old,
        "old_path": resolved_old,
        "new_path": resolved_new,
        "status": "modified",
        "added": "0",
        "deleted": "0",
        "is_binary": False,
        "truncated": False,
        "current_version_target": None,
        "nearest_tag_target": None,
        "hunks": [],
    }


def _line_row(kind: str, text: str, old_line: int | None, new_line: int | None) -> dict:
    return {
        "type": "line",
        "kind": kind,
        "text": text,
        "old_line": old_line,
        "new_line": new_line,
    }


def _expander_row(
    *,
    row_id: str,
    direction: str,
    hidden_count: int,
    old_start: int | None,
    old_end: int | None,
    new_start: int | None,
    new_end: int | None,
    expand_key: str,
    step_size: int = _PATCH_EXPAND_STEP_SIZE,
) -> dict:
    return {
        "type": "expander",
        "id": row_id,
        "direction": direction,
        "hidden_count": hidden_count,
        "step_size": step_size,
        "old_start": old_start,
        "old_end": old_end,
        "new_start": new_start,
        "new_end": new_end,
        "expand_key": expand_key,
    }


def _hidden_span(start: int | None, end: int | None) -> int:
    if start is None or end is None or end < start:
        return 0
    return end - start + 1


def _finalize_hunk_rows(commit_hash: str, file_entry: dict, hunk: dict, prev_hunk: dict | None, next_hunk: dict | None) -> None:
    rows: list[dict] = []
    prefix_old_start = (int(prev_hunk["old_start"]) + int(prev_hunk["old_count"])) if prev_hunk else 1
    prefix_new_start = (int(prev_hunk["new_start"]) + int(prev_hunk["new_count"])) if prev_hunk else 1
    prefix_old_end = int(hunk["old_start"]) - 1
    prefix_new_end = int(hunk["new_start"]) - 1
    prefix_hidden_count = max(
        _hidden_span(prefix_old_start, prefix_old_end),
        _hidden_span(prefix_new_start, prefix_new_end),
    )
    if prefix_hidden_count > 0:
        rows.append(_expander_row(
            row_id=f'{file_entry["path"]}:{hunk["header"]}:up',
            direction="up",
            hidden_count=prefix_hidden_count,
            old_start=prefix_old_start if prefix_old_end >= prefix_old_start else None,
            old_end=prefix_old_end if prefix_old_end >= prefix_old_start else None,
            new_start=prefix_new_start if prefix_new_end >= prefix_new_start else None,
            new_end=prefix_new_end if prefix_new_end >= prefix_new_start else None,
            expand_key=f'{commit_hash}:{file_entry["path"]}:{hunk["old_start"]}:{hunk["new_start"]}:up',
        ))

    rows.extend(hunk["lines"])

    suffix_old_start = int(hunk["old_start"]) + int(hunk["old_count"])
    suffix_new_start = int(hunk["new_start"]) + int(hunk["new_count"])
    suffix_old_end = (int(next_hunk["old_start"]) - 1) if next_hunk else None
    suffix_new_end = (int(next_hunk["new_start"]) - 1) if next_hunk else None
    suffix_hidden_count = (
        max(
            _hidden_span(suffix_old_start, suffix_old_end),
            _hidden_span(suffix_new_start, suffix_new_end),
        )
        if next_hunk
        else _PATCH_EXPAND_STEP_SIZE
    )
    if suffix_hidden_count > 0:
        rows.append(_expander_row(
            row_id=f'{file_entry["path"]}:{hunk["header"]}:down',
            direction="down",
            hidden_count=suffix_hidden_count,
            old_start=suffix_old_start if suffix_old_start > 0 else None,
            old_end=suffix_old_end,
            new_start=suffix_new_start if suffix_new_start > 0 else None,
            new_end=suffix_new_end,
            expand_key=f'{commit_hash}:{file_entry["path"]}:{hunk["old_start"]}:{hunk["new_start"]}:down',
        ))

    hunk["rows"] = rows
    hunk.pop("lines", None)


def _parse_commit_patch(patch: str, context_radius: int = 3, commit_hash: str = "") -> list[dict]:
    del context_radius
    files: list[dict] = []
    current_file: dict | None = None
    current_hunk: dict | None = None
    old_line = 0
    new_line = 0

    for raw_line in patch.splitlines():
        diff_match = _DIFF_GIT_RE.match(raw_line)
        if diff_match:
            old_path, new_path = diff_match.group(1), diff_match.group(2)
            path = new_path if new_path != "/dev/null" else old_path
            current_file = _new_patch_file(path, old_path, new_path)
            files.append(current_file)
            current_hunk = None
            continue
        if current_file is None:
            continue
        if raw_line.startswith("rename from "):
            current_file["status"] = "renamed"
            current_file["old_path"] = raw_line.replace("rename from ", "", 1).strip()
            continue
        if raw_line.startswith("rename to "):
            current_file["status"] = "renamed"
            current_file["new_path"] = raw_line.replace("rename to ", "", 1).strip()
            current_file["path"] = current_file["new_path"]
            continue
        if raw_line.startswith("new file mode "):
            current_file["status"] = "added"
            continue
        if raw_line.startswith("deleted file mode "):
            current_file["status"] = "deleted"
            continue
        if raw_line.startswith("Binary files "):
            current_file["is_binary"] = True
            current_file["status"] = "binary"
            current_hunk = None
            continue
        if raw_line.startswith("@@ "):
            hunk_match = _HUNK_RE.match(raw_line)
            if not hunk_match:
                continue
            old_start = int(hunk_match.group(1))
            old_count = int(hunk_match.group(2) or "1")
            new_start = int(hunk_match.group(3))
            new_count = int(hunk_match.group(4) or "1")
            old_line = old_start
            new_line = new_start
            current_hunk = {
                "header": raw_line,
                "old_start": old_start,
                "old_count": old_count,
                "new_start": new_start,
                "new_count": new_count,
                "lines": [],
                "rows": [],
                "current_version_target": None,
                "nearest_tag_target": None,
            }
            current_file["hunks"].append(current_hunk)
            continue
        if current_hunk is None:
            continue
        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            current_hunk["lines"].append(_line_row("add", raw_line, None, new_line))
            new_line += 1
            continue
        if raw_line.startswith("-") and not raw_line.startswith("---"):
            current_hunk["lines"].append(_line_row("del", raw_line, old_line, None))
            old_line += 1
            continue
        if raw_line.startswith("\\ "):
            current_hunk["lines"].append(_line_row("meta", raw_line, None, None))
            continue
        current_hunk["lines"].append(_line_row("context", raw_line[1:] if raw_line.startswith(" ") else raw_line, old_line, new_line))
        old_line += 1
        new_line += 1

    for file_entry in files:
        hunks = file_entry["hunks"]
        for index, hunk in enumerate(hunks):
            prev_hunk = hunks[index - 1] if index > 0 else None
            next_hunk = hunks[index + 1] if index + 1 < len(hunks) else None
            _finalize_hunk_rows(commit_hash, file_entry, hunk, prev_hunk, next_hunk)
    return files


class KernelCommitPatchExpandRequest(BaseModel):
    version: str = Field(..., min_length=1)
    commit_hash: str = Field(..., min_length=7)
    file_path: str = Field(..., min_length=1)
    hunk_header: str = Field(..., min_length=1)
    expander_id: str = Field(..., min_length=1)
    direction: str = Field(..., pattern="^(up|down)$")


async def _load_commit_file_lines(
    source: GitLocalSource,
    commit_hash: str,
    file_entry: dict,
) -> list[str]:
    if file_entry.get("status") == "deleted":
        blob = await _run_local_git(source, "show", f"{commit_hash}^:{file_entry['old_path']}")
    else:
        blob = await _run_local_git(source, "show", f"{commit_hash}:{file_entry['new_path']}")
    return blob.splitlines()


def _slice_expander_rows(*, file_lines: list[str], expander: dict, direction: str) -> tuple[list[dict], dict | None]:
    old_start = expander.get("old_start")
    old_end = expander.get("old_end")
    new_start = expander.get("new_start")
    new_end = expander.get("new_end")
    anchor_start = int(new_start or old_start or 1)

    if direction == "up":
        anchor_end = int(new_end or old_end or anchor_start)
        reveal_start = max(anchor_start, anchor_end - (_PATCH_EXPAND_STEP_SIZE - 1))
        reveal_end = anchor_end
    else:
        reveal_start = anchor_start
        if new_end is not None or old_end is not None:
            anchor_end = int(new_end or old_end or anchor_start)
        else:
            anchor_end = len(file_lines)
        reveal_end = min(anchor_end, reveal_start + (_PATCH_EXPAND_STEP_SIZE - 1))

    inserted_rows: list[dict] = []
    for line_number in range(reveal_start, reveal_end + 1):
        old_line = None if old_start is None else int(old_start) + (line_number - anchor_start)
        new_line = None if new_start is None else int(new_start) + (line_number - anchor_start)
        if 1 <= line_number <= len(file_lines):
            inserted_rows.append(_line_row("context", file_lines[line_number - 1], old_line, new_line))

    if direction == "up":
        remaining_old_end = (int(old_start) + (reveal_start - anchor_start) - 1) if old_start is not None else None
        remaining_new_end = (int(new_start) + (reveal_start - anchor_start) - 1) if new_start is not None else None
        remaining_hidden = max(
            _hidden_span(old_start, remaining_old_end),
            _hidden_span(new_start, remaining_new_end),
        )
        remaining_expander = (
            _expander_row(
                row_id=expander["id"],
                direction=direction,
                hidden_count=remaining_hidden,
                old_start=old_start,
                old_end=remaining_old_end,
                new_start=new_start,
                new_end=remaining_new_end,
                expand_key=expander["expand_key"],
            )
            if remaining_hidden > 0
            else None
        )
        return inserted_rows, remaining_expander

    remaining_old_start = (int(old_start) + (reveal_end - anchor_start) + 1) if old_start is not None else None
    remaining_new_start = (int(new_start) + (reveal_end - anchor_start) + 1) if new_start is not None else None
    remaining_old_end = old_end
    remaining_new_end = new_end
    if remaining_new_start is not None:
        remaining_hidden = max(0, len(file_lines) - remaining_new_start + 1)
    elif remaining_old_start is not None:
        remaining_hidden = max(0, len(file_lines) - remaining_old_start + 1)
    else:
        remaining_hidden = 0
    if remaining_old_end is not None or remaining_new_end is not None:
        remaining_hidden = max(
            _hidden_span(remaining_old_start, remaining_old_end),
            _hidden_span(remaining_new_start, remaining_new_end),
        )
    remaining_expander = (
        _expander_row(
            row_id=expander["id"],
            direction=direction,
            hidden_count=remaining_hidden,
            old_start=remaining_old_start,
            old_end=remaining_old_end,
            new_start=remaining_new_start,
            new_end=remaining_new_end,
            expand_key=expander["expand_key"],
        )
        if remaining_hidden > 0
        else None
    )
    return inserted_rows, remaining_expander


def _make_jump_target(
    available: bool,
    version: str,
    path: str,
    line: int,
    reason: str | None = None,
) -> dict:
    return {
        "available": available,
        "version": version,
        "path": path,
        "line": line,
        "reason": reason,
    }


def _pick_hunk_target(hunk: dict, new_path: str, old_path: str) -> tuple[str, int]:
    if new_path and int(hunk.get("new_start") or 0) > 0:
        return new_path, int(hunk["new_start"])
    if old_path and int(hunk.get("old_start") or 0) > 0:
        return old_path, int(hunk["old_start"])
    return "", 0


def _normalized_patch_path(path: str | None) -> str:
    value = str(path or "")
    return "" if value == "/dev/null" else value


def _pick_file_target(file_entry: dict, prefer_current_path: bool) -> tuple[str, int]:
    current_path = _normalized_patch_path(file_entry.get("new_path"))
    previous_path = _normalized_patch_path(file_entry.get("old_path"))
    first_hunk = file_entry.get("hunks", [None])[0] if file_entry.get("hunks") else None

    if prefer_current_path:
        if not current_path:
            return "", 0
        if first_hunk and int(first_hunk.get("new_start") or 0) > 0:
            return current_path, int(first_hunk["new_start"])
        return current_path, 1

    if current_path:
        if first_hunk and int(first_hunk.get("new_start") or 0) > 0:
            return current_path, int(first_hunk["new_start"])
        return current_path, 1
    if previous_path:
        if first_hunk and int(first_hunk.get("old_start") or 0) > 0:
            return previous_path, int(first_hunk["old_start"])
        return previous_path, 1
    return "", 0


def _attach_hunk_targets(files: list[dict], current_version: str, nearest_tag_version: str | None) -> list[dict]:
    for file_entry in files:
        current_path, current_line = _pick_file_target(file_entry, prefer_current_path=True)
        if current_path and current_line > 0:
            file_entry["current_version_target"] = _make_jump_target(
                True,
                current_version,
                current_path,
                current_line,
            )
        else:
            file_entry["current_version_target"] = _make_jump_target(
                False,
                "",
                "",
                0,
                "No navigable file target",
            )

        tag_path, tag_line = _pick_file_target(file_entry, prefer_current_path=False)
        if nearest_tag_version and tag_path and tag_line > 0:
            file_entry["nearest_tag_target"] = _make_jump_target(
                True,
                nearest_tag_version,
                tag_path,
                tag_line,
            )
        else:
            file_entry["nearest_tag_target"] = _make_jump_target(
                False,
                "",
                "",
                0,
                "No browsable tag mapping found",
            )

        for hunk in file_entry.get("hunks", []):
            path, line = _pick_hunk_target(
                hunk,
                _normalized_patch_path(file_entry.get("new_path")),
                _normalized_patch_path(file_entry.get("old_path")),
            )
            if path and line > 0:
                hunk["current_version_target"] = _make_jump_target(True, current_version, path, line)
            else:
                hunk["current_version_target"] = _make_jump_target(
                    False,
                    "",
                    "",
                    0,
                    "No navigable file target",
                )
            if nearest_tag_version:
                if path and line > 0:
                    hunk["nearest_tag_target"] = _make_jump_target(
                        True,
                        nearest_tag_version,
                        path,
                        line,
                    )
                else:
                    hunk["nearest_tag_target"] = _make_jump_target(
                        False,
                        "",
                        "",
                        0,
                        "No browsable tag mapping found",
                    )
            else:
                hunk["nearest_tag_target"] = _make_jump_target(
                    False,
                    "",
                    "",
                    0,
                    "No browsable tag mapping found",
                )
    return files


async def _resolve_nearest_tag_version(source: GitLocalSource, commit_hash: str) -> str | None:
    try:
        output = await _run_local_git(source, "describe", "--tags", "--abbrev=0", commit_hash, timeout=8.0)
    except HTTPException:
        return None
    nearest = output.strip()
    return nearest or None


def _attach_file_stats(files: list[dict], changed_files: list[dict]) -> list[dict]:
    stats_by_path = {
        str(item.get("path") or ""): {
            "added": str(item.get("added") or "0"),
            "deleted": str(item.get("deleted") or "0"),
        }
        for item in changed_files
        if item.get("path")
    }
    for file_entry in files:
        candidates = [
            str(file_entry.get("path") or ""),
            str(file_entry.get("new_path") or ""),
            str(file_entry.get("old_path") or ""),
        ]
        for candidate in candidates:
            if candidate and candidate in stats_by_path:
                file_entry.update(stats_by_path[candidate])
                break
    return files

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
    nearest_tag_version = await _resolve_nearest_tag_version(source, normalized_commit_hash)
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
    entry["nearest_tag_version"] = nearest_tag_version
    files = _parse_commit_patch(entry["patch"], commit_hash=normalized_commit_hash)
    files = _attach_file_stats(files, changed_files)
    entry["files"] = _attach_hunk_targets(
        files,
        current_version=version,
        nearest_tag_version=nearest_tag_version,
    )
    return entry


@router.post("/api/kernel/commit/expand")
async def kernel_commit_patch_expand(
    payload: KernelCommitPatchExpandRequest = Body(...),
):
    source = _local_git_source()
    normalized_commit_hash = _normalize_commit_hash(payload.commit_hash)
    patch = await _run_local_git(
        source,
        "show",
        "--no-ext-diff",
        "--find-renames",
        "--format=",
        "--patch",
        normalized_commit_hash,
        timeout=20.0,
    )
    files = _parse_commit_patch(patch, commit_hash=normalized_commit_hash)
    file_entry = next((item for item in files if item["path"] == payload.file_path), None)
    if file_entry is None:
        raise HTTPException(status_code=404, detail="Patch file not found")
    hunk = next((item for item in file_entry["hunks"] if item["header"] == payload.hunk_header), None)
    if hunk is None:
        raise HTTPException(status_code=404, detail="Patch hunk not found")
    expander = next(
        (row for row in hunk["rows"] if row["type"] == "expander" and row["id"] == payload.expander_id),
        None,
    )
    if expander is None:
        raise HTTPException(status_code=404, detail="Patch expander not found")

    file_lines = await _load_commit_file_lines(source, normalized_commit_hash, file_entry)
    inserted_rows, remaining_expander = _slice_expander_rows(
        file_lines=file_lines,
        expander=expander,
        direction=payload.direction,
    )
    return {
        "hunk_header": hunk["header"],
        "expander_id": expander["id"],
        "inserted_rows": inserted_rows,
        "remaining_expander": remaining_expander,
    }


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

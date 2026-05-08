"""Helpers for normalizing kernel code target payloads."""

from __future__ import annotations

from typing import Any


def build_code_target(
    *,
    repo: str = "linux",
    version: str = "",
    path: str = "",
    start_line: int = 0,
    end_line: int = 0,
    symbol: str = "",
    commit: str = "",
    patch_id: str = "",
    message_id: str = "",
    target_ref: str = "",
    anchor: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a stable code target payload from legacy scattered fields."""
    anchor = anchor or {}
    meta = meta or {}

    normalized_version = str(version or anchor.get("version") or meta.get("version") or "").strip()
    normalized_path = str(path or anchor.get("file_path") or meta.get("file_path") or "").strip().lstrip("/")

    if (not normalized_version or not normalized_path) and target_ref and ":" in target_ref:
        ref_version, ref_path = target_ref.split(":", 1)
        normalized_version = normalized_version or ref_version.strip()
        normalized_path = normalized_path or ref_path.strip().lstrip("/")

    resolved_start = int(
        start_line
        or anchor.get("start_line")
        or meta.get("start_line")
        or 0
    )
    resolved_end = int(
        end_line
        or anchor.get("end_line")
        or meta.get("end_line")
        or resolved_start
        or 0
    )
    if resolved_start > 0 and resolved_end <= 0:
        resolved_end = resolved_start
    if resolved_start > 0 and resolved_end > 0 and resolved_end < resolved_start:
        resolved_end = resolved_start

    normalized_target_ref = str(target_ref or "").strip()
    if not normalized_target_ref and normalized_version and normalized_path:
        normalized_target_ref = f"{normalized_version}:{normalized_path}"

    return {
        "repo": str(repo or meta.get("repo") or "linux"),
        "version": normalized_version,
        "path": normalized_path,
        "start_line": resolved_start,
        "end_line": resolved_end,
        "symbol": str(symbol or anchor.get("symbol") or meta.get("symbol") or ""),
        "commit": str(commit or anchor.get("commit") or meta.get("commit") or ""),
        "patch_id": str(patch_id or anchor.get("patch_id") or meta.get("patch_id") or ""),
        "message_id": str(message_id or anchor.get("message_id") or meta.get("message_id") or ""),
        "target_ref": normalized_target_ref,
    }

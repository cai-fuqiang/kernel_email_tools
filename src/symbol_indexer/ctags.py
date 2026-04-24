"""基于 ctags 的离线符号索引器。"""

from __future__ import annotations

import io
import os
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

from src.symbol_indexer.base import IndexedSymbol

_IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")

_KIND_MAP = {
    "function": "function",
    "macro": "macro",
    "struct": "struct",
    "enum": "enum",
    "typedef": "typedef",
    "member": "member",
    "enumerator": "enumerator",
    "union": "union",
    "variable": "variable",
}


class CtagsSymbolIndexer:
    """从 bare git repo 导出指定版本并用 ctags 建索引。"""

    def __init__(self, repo_path: str, ctags_bin: str = "ctags"):
        self._repo_path = os.path.expanduser(repo_path)
        self._ctags_bin = ctags_bin

    def build_version_index(self, version: str) -> list[IndexedSymbol]:
        with tempfile.TemporaryDirectory(prefix=f"kernel-symbols-{version}-") as tmpdir:
            worktree = Path(tmpdir) / "src"
            worktree.mkdir(parents=True, exist_ok=True)
            self._export_git_tree(version, worktree)
            return self._run_ctags(version, worktree)

    def _export_git_tree(self, version: str, dst: Path) -> None:
        proc = subprocess.run(
            ["git", f"--git-dir={self._repo_path}", "archive", "--format=tar", version],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        with tarfile.open(fileobj=io.BytesIO(proc.stdout)) as tar:
            tar.extractall(dst)

    def _run_ctags(self, version: str, worktree: Path) -> list[IndexedSymbol]:
        cmd = [
            self._ctags_bin,
            "-R",
            "-n",
            "-f",
            "-",
            "--languages=C",
            "--langmap=C:+.h",
            "--fields=+KnsS",
            "--c-kinds=+dgestuvfm",
            str(worktree),
        ]
        proc = subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        symbols: list[IndexedSymbol] = []
        for raw_line in proc.stdout.splitlines():
            if not raw_line or raw_line.startswith("!_TAG_"):
                continue
            symbol = self._parse_tag_line(version, worktree, raw_line)
            if symbol is not None:
                symbols.append(symbol)
        return symbols

    def _parse_tag_line(self, version: str, worktree: Path, raw_line: str) -> IndexedSymbol | None:
        parts = raw_line.split("\t")
        if len(parts) < 4:
            return None

        symbol = parts[0].strip()
        abs_path = Path(parts[1].strip())
        kind = _KIND_MAP.get(parts[3].strip(), parts[3].strip())
        extras: dict[str, str] = {}
        for field in parts[4:]:
            if ":" not in field:
                continue
            key, value = field.split(":", 1)
            extras[key] = value

        line = int(extras.get("line", "0") or 0)
        if line <= 0:
            return None

        relative_path = abs_path.relative_to(worktree).as_posix()
        line_text = self._read_line(abs_path, line)
        column = self._find_symbol_column(line_text, symbol)
        signature = extras.get("signature")
        scope = (
            extras.get("struct")
            or extras.get("class")
            or extras.get("enum")
            or extras.get("union")
            or extras.get("namespace")
        )
        end_column = column + len(symbol) - 1 if column > 0 else None

        return IndexedSymbol(
            version=version,
            file_path=relative_path,
            symbol=symbol,
            kind=kind,
            line=line,
            column=max(column, 1),
            end_line=line,
            end_column=end_column,
            signature=signature,
            scope=scope,
            language="c",
            meta={k: v for k, v in extras.items() if k not in {"line", "signature", "struct", "class", "enum", "union", "namespace"}},
        )

    def _read_line(self, path: Path, line: int) -> str:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for current, content in enumerate(f, start=1):
                if current == line:
                    return content.rstrip("\n")
        return ""

    def _find_symbol_column(self, line_text: str, symbol: str) -> int:
        if not line_text:
            return 1

        for match in _IDENT_RE.finditer(line_text):
            if match.group(0) == symbol:
                return match.start() + 1

        index = line_text.find(symbol)
        return index + 1 if index >= 0 else 1

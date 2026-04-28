"""Elixir Bootlin 内核源码适配器。

通过 httpx 异步抓取 https://elixir.bootlin.com/ 页面，
为本地 git 仓库中缺失 tag 的版本提供回退支持。
"""

import logging
import re

import httpx

from src.kernel_source.base import (
    BaseKernelSource,
    FileContent,
    TreeEntry,
    TreeEntryType,
    VersionInfo,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://elixir.bootlin.com"

# 匹配 tree 页面中的条目行: icon-tree (目录) / icon-blob (文件) — class 和 href 可能分行
_TREE_ICON_RE = re.compile(r'class="tree-icon\s+(icon-tree|icon-blob)"')
_HREF_RE = re.compile(r'href="(/linux/[^"]*/([^/"]+))"')
# 匹配文件大小文本（如 "905 bytes"）
_SIZE_TEXT_RE = re.compile(r'([\d,]+)\s*bytes?')
# 匹配 source code 页面的代码块
_CODE_BLOCK_RE = re.compile(
    r'<td\s+class="code"><div><pre>(.*?)</pre></div></td>', re.DOTALL
)
# 匹配单行代码
_CODE_LINE_RE = re.compile(
    r'<span\s+id="codeline-\d+">(.*?)</span>', re.DOTALL
)
# HTML tag 剥离
_HTML_TAG_RE = re.compile(r"<[^>]+>")
# HTML 实体解码
_HTML_ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
}


def _decode_html(text: str) -> str:
    """解码 HTML 实体。"""
    for entity, char in _HTML_ENTITIES.items():
        text = text.replace(entity, char)
    return text


def _strip_html(text: str) -> str:
    """移除 HTML 标签并解码实体。"""
    return _decode_html(_HTML_TAG_RE.sub("", text))


def _parse_size(size_text: str) -> int:
    """解析文件大小字符串（如 '1,234 bytes'）为整数。"""
    if not size_text:
        return 0
    try:
        return int(size_text.replace(",", "").replace("bytes", "").strip())
    except ValueError:
        return 0


class ElixirSource(BaseKernelSource):
    """从 elixir.bootlin.com 抓取内核源码。

    Args:
        timeout: HTTP 请求超时秒数。
    """

    def __init__(self, timeout: float = 15):
        self._timeout = timeout

    async def list_versions(self, include_rc: bool = False) -> list[VersionInfo]:
        """elixir 不支持列举版本，返回空列表。"""
        return []

    async def list_tree(self, version: str, path: str = "") -> list[TreeEntry]:
        """获取指定版本、指定路径下的目录树（通过抓取 elixir 页面）。"""
        url = self._build_url(version, path)
        html = await self._fetch(url)

        entries: list[TreeEntry] = []
        lines = html.splitlines()
        i = 0
        while i < len(lines):
            icon_m = _TREE_ICON_RE.search(lines[i])
            if not icon_m:
                i += 1
                continue

            icon_type = icon_m.group(1)  # "icon-tree" or "icon-blob"
            if icon_type == "icon-back":
                i += 1
                continue

            # href 在当前行或后续行
            href = None
            for j in range(i, min(i + 3, len(lines))):
                hm = _HREF_RE.search(lines[j])
                if hm:
                    href = hm.group(1)
                    break

            if not href:
                i += 1
                continue

            # 文件名在 href 之后的几行（纯文本，不含 HTML 标签）
            name = None
            for j in range(i + 1, min(i + 6, len(lines))):
                candidate = lines[j].strip()
                # 排除空行、HTML标签行、以及包含 href= 的行
                if candidate and "<" not in candidate and ">" not in candidate and "href=" not in candidate:
                    name = candidate
                    break

            if not name or name == "Parent directory":
                i += 1
                continue

            # 在后续行中查找文件大小（class="size" 和 bytes 文本跨多行）
            size = 0
            in_size_tag = False
            for j in range(i, min(i + 14, len(lines))):
                if 'class="size"' in lines[j]:
                    in_size_tag = True
                    continue
                if in_size_tag:
                    sm = _SIZE_TEXT_RE.search(lines[j])
                    if sm:
                        size = _parse_size(sm.group(1))
                        break
                    if "</a>" in lines[j]:
                        break

            entry_path = f"{path}/{name}" if path else name
            if icon_type == "icon-tree":
                entries.append(TreeEntry(
                    name=name, path=entry_path,
                    entry_type=TreeEntryType.DIR, size=0,
                ))
            else:
                entries.append(TreeEntry(
                    name=name, path=entry_path,
                    entry_type=TreeEntryType.FILE, size=size,
                ))

            i += 1

        if not entries and "tree-icon" not in html:
            raise ValueError(f"Version or path not found on elixir: {version}:{path}")

        dirs = sorted([e for e in entries if e.entry_type == TreeEntryType.DIR], key=lambda e: e.name)
        files = sorted([e for e in entries if e.entry_type != TreeEntryType.DIR], key=lambda e: e.name)
        return dirs + files

    async def get_file(self, version: str, path: str) -> FileContent:
        """获取指定版本、指定路径的文件内容（通过抓取 elixir 页面）。"""
        url = self._build_url(version, path)
        html = await self._fetch(url)

        block_m = _CODE_BLOCK_RE.search(html)
        if not block_m:
            raise FileNotFoundError(f"File not found on elixir: {version}:{path}")

        code_html = block_m.group(1)
        lines: list[str] = []
        for line_m in _CODE_LINE_RE.finditer(code_html):
            line_text = _strip_html(line_m.group(1))
            lines.append(line_text)

        if not lines:
            raise FileNotFoundError(f"Empty file on elixir: {version}:{path}")

        content = "\n".join(lines)
        if lines and not lines[-1].endswith("\n"):
            content += "\n"

        size = len(content.encode("utf-8"))
        line_count = len(lines)

        return FileContent(
            path=path,
            version=version,
            content=content,
            line_count=line_count,
            size=size,
            truncated=False,
        )

    async def _fetch(self, url: str) -> str:
        """异步获取 URL 内容。

        Raises:
            ValueError: HTTP 错误或请求失败。
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, follow_redirects=True)
                if resp.status_code != 200:
                    raise ValueError(f"Not found on elixir (HTTP {resp.status_code}): {url}")
                return resp.text
        except httpx.RequestError as e:
            raise ValueError(f"Failed to fetch from elixir: {url} — {e}")

    @staticmethod
    def _build_url(version: str, path: str) -> str:
        """构建 elixir 页面 URL。"""
        if path:
            return f"{BASE_URL}/linux/{version}/source/{path}"
        return f"{BASE_URL}/linux/{version}/source/"

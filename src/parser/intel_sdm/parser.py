"""Intel SDM 专用解析器 — 章节结构识别与内容填充。"""

import logging
import re
from typing import Optional

import fitz

from src.parser.base import BaseManualParser, SectionNode, TOCEntry
from src.parser.pdf_extractor import PDFExtractor

logger = logging.getLogger(__name__)
# Intel SDM 章节编号正则：匹配 "1.2.3" 或 "CHAPTER 3" 等模式
SECTION_NUM_RE = re.compile(
    r"^(?:CHAPTER\s+)?(\d+(?:\.\d+)*)\s+(.+)", re.IGNORECASE
)
VOLUME_RE = re.compile(
    r"^(?:VOLUME|VOL\.?)\s*(\d+[A-D]?)\s*[:\-—]?\s*(.*)", re.IGNORECASE
)


class IntelSDMParser(BaseManualParser):
    """Intel SDM 手册解析器。

    负责：
    1. 从 PDF 书签提取目录结构
    2. 识别 Volume/Chapter/Section 层级
    3. 构建章节树并填充每节的文本内容
    """

    def __init__(self, max_page_text_length: int = 50000):
        self.extractor = PDFExtractor(max_page_text_length=max_page_text_length)

    def parse_toc(self, pdf_path: str) -> list[TOCEntry]:
        """从 PDF 书签提取目录。"""
        return self.extractor.extract_toc(pdf_path)

    def _parse_section_number(self, title: str) -> tuple[str, str]:
        """从标题中提取节编号和标题文本。

        Args:
            title: 原始标题字符串。

        Returns:
            (section_number, clean_title)。无编号返回 ("", title)。
        """
        # 尝试匹配 Volume 标题
        m = VOLUME_RE.match(title.strip())
        if m:
            return f"Vol.{m.group(1)}", m.group(2).strip() or title.strip()

        # 尝试匹配章节编号
        m = SECTION_NUM_RE.match(title.strip())
        if m:
            return m.group(1), m.group(2).strip()

        return "", title.strip()

    def build_section_tree(
        self, pdf_path: str, toc: list[TOCEntry]
    ) -> list[SectionNode]:
        """基于目录构建章节树，填充每节的页码范围。"""
        if not toc:
            logger.warning("Empty TOC for %s", pdf_path)
            return []

        doc = fitz.open(pdf_path)
        total_pages = doc.page_count

        # 第一遍：创建所有节点，计算页码范围
        nodes: list[SectionNode] = []
        for i, entry in enumerate(toc):
            number, title = self._parse_section_number(entry.title)
            # 结束页 = 下一个同级或更高级条目的起始页 - 1
            page_end = total_pages - 1
            for j in range(i + 1, len(toc)):
                if toc[j].level <= entry.level:
                    page_end = max(toc[j].page_num - 1, entry.page_num)
                    break

            nodes.append(SectionNode(
                level=entry.level,
                title=title,
                number=number,
                page_start=entry.page_num,
                page_end=page_end,
            ))

        # 第二遍：构建父子关系
        roots: list[SectionNode] = []
        stack: list[SectionNode] = []

        for node in nodes:
            # 弹出所有级别 >= 当前节点的栈元素
            while stack and stack[-1].level >= node.level:
                stack.pop()
            if stack:
                stack[-1].children.append(node)
            else:
                roots.append(node)
            stack.append(node)

        # 第三遍：填充叶子节点的文本内容
        self._fill_content(doc, roots)

        doc.close()
        logger.info(
            "Built section tree: %d roots, %d total nodes from %s",
            len(roots), len(nodes), pdf_path,
        )
        return roots

    def _fill_content(self, doc: fitz.Document, nodes: list[SectionNode]) -> None:
        """递归填充章节节点的文本内容。

        对于叶子节点：提取 page_start ~ page_end 的文本。
        对于非叶子节点：只提取自身页面到第一个子节点之间的文本。
        """
        for node in nodes:
            if node.children:
                # 非叶子：提取自身起始页到第一个子节点起始页之间的内容
                content_end = node.children[0].page_start
                if content_end > node.page_start:
                    text_parts = []
                    tables = []
                    for p in range(node.page_start, content_end):
                        page = doc[p]
                        text_parts.append(page.get_text("text"))
                        try:
                            tab_finder = page.find_tables()
                            for t in tab_finder.tables:
                                rows = t.extract()
                                if rows:
                                    tables.append([
                                        [c if c else "" for c in r] for r in rows
                                    ])
                        except Exception:
                            pass
                    node.content = "\n".join(text_parts)
                    node.tables = tables
                # 递归子节点
                self._fill_content(doc, node.children)
            else:
                # 叶子节点：提取完整页面范围
                text_parts = []
                tables = []
                for p in range(node.page_start, min(node.page_end + 1, doc.page_count)):
                    page = doc[p]
                    text_parts.append(page.get_text("text"))
                    try:
                        tab_finder = page.find_tables()
                        for t in tab_finder.tables:
                            rows = t.extract()
                            if rows:
                                tables.append([
                                    [c if c else "" for c in r] for r in rows
                                ])
                    except Exception:
                        pass
                node.content = "\n".join(text_parts)
                node.tables = tables

    def parse(self, pdf_path: str) -> list[SectionNode]:
        """完整解析 Intel SDM PDF。"""
        toc = self.parse_toc(pdf_path)
        if not toc:
            logger.warning("No TOC found, falling back to flat page extraction")
            return self._fallback_flat_parse(pdf_path)
        return self.build_section_tree(pdf_path, toc)

    def _fallback_flat_parse(self, pdf_path: str) -> list[SectionNode]:
        """无书签时的降级方案：每页一个节点。"""
        pages = self.extractor.extract_pages(pdf_path)
        return [
            SectionNode(
                level=1,
                title=f"Page {p.page_num + 1}",
                page_start=p.page_num,
                page_end=p.page_num,
                content=p.text,
                tables=p.tables,
            )
            for p in pages
        ]
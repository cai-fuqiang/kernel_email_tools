"""PDF 文本/表格/书签通用提取器。

使用 PyMuPDF (fitz) 作为主引擎，pdfplumber 作为表格检测备选。
"""

import logging
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from src.parser.base import PageContent, TOCEntry

logger = logging.getLogger(__name__)


class PDFExtractor:
    """PDF 内容提取器。

    职责：
    - 提取书签/目录 → TOCEntry 列表
    - 逐页提取文本 → PageContent 列表
    - 逐页检测表格 → 嵌入 PageContent.tables
    """

    def __init__(self, max_page_text_length: int = 50000):
        self.max_page_text_length = max_page_text_length

    def extract_toc(self, pdf_path: str) -> list[TOCEntry]:
        """从 PDF 书签（Outline）提取目录条目。

        Args:
            pdf_path: PDF 文件路径。

        Returns:
            目录条目列表，按页码排序。
        """
        doc = fitz.open(pdf_path)
        try:
            raw_toc = doc.get_toc(simple=True)  # [[level, title, page], ...]
            entries = []
            for level, title, page in raw_toc:
                entries.append(TOCEntry(
                    level=level,
                    title=title.strip(),
                    page_num=max(0, page - 1),  # fitz 返回 1-based，转为 0-based
                ))
            logger.info("Extracted %d TOC entries from %s", len(entries), pdf_path)
            return entries
        finally:
            doc.close()

    def extract_page(self, doc: fitz.Document, page_num: int) -> PageContent:
        """提取单页内容。

        Args:
            doc: 已打开的 fitz.Document。
            page_num: 页码（0-based）。

        Returns:
            PageContent 包含文本、表格、图片元信息。
        """
        page = doc[page_num]

        # 提取文本
        text = page.get_text("text")
        if len(text) > self.max_page_text_length:
            text = text[: self.max_page_text_length]
            logger.warning("Page %d text truncated to %d chars", page_num, self.max_page_text_length)

        # 提取表格（PyMuPDF 内置表格检测）
        tables = []
        try:
            tab_finder = page.find_tables()
            for table in tab_finder.tables:
                rows = table.extract()
                if rows:
                    # 清理 None 值
                    cleaned = [
                        [cell if cell is not None else "" for cell in row]
                        for row in rows
                    ]
                    tables.append(cleaned)
        except Exception as e:
            logger.debug("Table extraction failed on page %d: %s", page_num, e)

        # 提取图片元信息
        images = []
        for img in page.get_images(full=True):
            images.append({
                "xref": img[0],
                "width": img[2],
                "height": img[3],
                "bpc": img[4],
                "colorspace": img[5],
            })

        return PageContent(
            page_num=page_num,
            text=text,
            tables=tables,
            images=images,
        )

    def extract_pages(
        self, pdf_path: str, start: int = 0, end: Optional[int] = None
    ) -> list[PageContent]:
        """批量提取页面内容。

        Args:
            pdf_path: PDF 文件路径。
            start: 起始页码（0-based，含）。
            end: 结束页码（0-based，不含）。None 表示到末尾。

        Returns:
            PageContent 列表。
        """
        doc = fitz.open(pdf_path)
        try:
            total = doc.page_count
            end = min(end or total, total)
            pages = []
            for i in range(start, end):
                pages.append(self.extract_page(doc, i))
            logger.info(
                "Extracted %d pages (%d-%d) from %s",
                len(pages), start, end - 1, Path(pdf_path).name,
            )
            return pages
        finally:
            doc.close()
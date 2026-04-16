"""标准邮件解析器，解析 RFC2822 格式邮件头和正文。"""

import email
import email.utils
import logging
import re
from datetime import datetime, timezone
from email.header import decode_header
from typing import Optional

from src.collector.base import RawEmail
from src.parser.base import BaseParser, ParsedEmail
from src.parser.patch_extractor import PatchExtractor

logger = logging.getLogger(__name__)


class EmailParser(BaseParser):
    """标准邮件解析器。

    解析 RFC2822 格式邮件，提取结构化字段，分离正文和补丁内容。

    Attributes:
        max_body_length: 正文最大保留字符数。
        patch_extractor: 补丁提取器实例。
    """

    def __init__(self, max_body_length: int = 100000):
        """初始化 EmailParser。

        Args:
            max_body_length: 正文最大保留字符数，超出部分截断。
        """
        self.max_body_length = max_body_length
        self.patch_extractor = PatchExtractor()

    @staticmethod
    def _decode_header_value(value: Optional[str]) -> str:
        """解码邮件头中的编码值（如 =?UTF-8?Q?...?=）。

        Args:
            value: 原始邮件头值。

        Returns:
            解码后的字符串。
        """
        if not value:
            return ""
        decoded_parts = decode_header(value)
        result = []
        for part, charset in decoded_parts:
            if isinstance(part, bytes):
                result.append(part.decode(charset or "utf-8", errors="replace"))
            else:
                result.append(part)
        return " ".join(result)

    @staticmethod
    def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
        """解析邮件日期头。

        Args:
            date_str: Date 头的值。

        Returns:
            解析后的 datetime（UTC），失败返回 None。
        """
        if not date_str:
            return None
        try:
            parsed = email.utils.parsedate_to_datetime(date_str)
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        except (ValueError, TypeError) as e:
            logger.debug("Failed to parse date '%s': %s", date_str, e)
            return None

    @staticmethod
    def _parse_references(refs_str: Optional[str]) -> list[str]:
        """解析 References 头，提取所有 Message-ID。

        Args:
            refs_str: References 头的值。

        Returns:
            Message-ID 列表。
        """
        if not refs_str:
            return []
        return [mid.strip("<>") for mid in re.findall(r"<([^>]+)>", refs_str)]

    @staticmethod
    def _clean_body(body: str) -> str:
        """清洗邮件正文：去除引用行和签名。

        Args:
            body: 原始正文。

        Returns:
            清洗后的正文。
        """
        lines = body.split("\n")
        cleaned = []
        for line in lines:
            # 跳过签名分隔符后的内容
            if line.strip() == "-- ":
                break
            # 保留非引用行（不以 > 开头）
            if not line.startswith(">"):
                cleaned.append(line)
        return "\n".join(cleaned).strip()

    def parse(self, raw_email: RawEmail) -> Optional[ParsedEmail]:
        """解析单封原始邮件。

        Args:
            raw_email: 采集层输出的原始邮件。

        Returns:
            解析成功返回 ParsedEmail，失败返回 None。
        """
        try:
            full_text = raw_email.raw_headers + "\n\n" + raw_email.raw_body
            msg = email.message_from_string(full_text)

            in_reply_to = msg.get("In-Reply-To", "").strip("<>")
            references = self._parse_references(msg.get("References"))

            # 提取补丁内容
            patch_content = self.patch_extractor.extract(raw_email.raw_body)

            # 清洗正文
            body_raw = raw_email.raw_body[:self.max_body_length]
            body = self._clean_body(body_raw)

            # 线程 ID：References 链的第一个，或 In-Reply-To，或自身 Message-ID
            thread_id = references[0] if references else (in_reply_to or raw_email.message_id)

            return ParsedEmail(
                message_id=raw_email.message_id,
                subject=self._decode_header_value(msg.get("Subject")),
                sender=self._decode_header_value(msg.get("From")),
                date=self._parse_date(msg.get("Date")),
                in_reply_to=in_reply_to,
                references=references,
                body=body,
                body_raw=body_raw,
                patch_content=patch_content,
                has_patch=bool(patch_content),
                list_name=raw_email.list_name,
                thread_id=thread_id,
                epoch=raw_email.epoch,
            )
        except Exception as e:
            logger.error("Failed to parse email %s: %s", raw_email.message_id, e)
            return None
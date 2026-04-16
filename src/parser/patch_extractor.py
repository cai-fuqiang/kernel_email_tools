"""补丁内容提取器，从邮件正文中分离 diff/patch 内容。"""

import re
import logging

logger = logging.getLogger(__name__)

# diff 块的起始模式
DIFF_HEADER_PATTERN = re.compile(r"^diff --git a/.+ b/.+$", re.MULTILINE)
# unified diff 头
UNIFIED_DIFF_PATTERN = re.compile(r"^---\s+\S+.*\n\+\+\+\s+\S+", re.MULTILINE)
# hunk 头
HUNK_PATTERN = re.compile(r"^@@\s+-\d+", re.MULTILINE)


class PatchExtractor:
    """从邮件正文中提取 diff/patch 内容。

    内核邮件中补丁通常以 `diff --git` 开头，或包含 `---`/`+++` unified diff 格式。
    """

    def extract(self, body: str) -> str:
        """提取邮件正文中的补丁内容。

        Args:
            body: 邮件正文文本。

        Returns:
            提取到的补丁内容，无补丁则返回空字符串。
        """
        if not body:
            return ""

        # 策略 1：查找 diff --git 开头的块
        match = DIFF_HEADER_PATTERN.search(body)
        if match:
            return body[match.start():].strip()

        # 策略 2：查找 unified diff 格式（--- / +++）
        match = UNIFIED_DIFF_PATTERN.search(body)
        if match:
            # 回溯到前一个空行作为补丁起始
            start = body.rfind("\n\n", 0, match.start())
            start = start + 2 if start != -1 else match.start()
            return body[start:].strip()

        return ""

    def has_patch(self, body: str) -> bool:
        """判断邮件正文是否包含补丁。

        Args:
            body: 邮件正文文本。

        Returns:
            是否包含补丁。
        """
        if not body:
            return False
        return bool(
            DIFF_HEADER_PATTERN.search(body)
            or (UNIFIED_DIFF_PATTERN.search(body) and HUNK_PATTERN.search(body))
        )
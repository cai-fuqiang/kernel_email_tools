"""Git 数据源采集器，从 lore.kernel.org git mirror 采集邮件。"""

import email
import logging
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

from git import Repo
from git.exc import GitCommandError, InvalidGitRepositoryError

from src.collector.base import BaseCollector, CollectResult, RawEmail

logger = logging.getLogger(__name__)


class GitCollector(BaseCollector):
    """从 lore.kernel.org 的 git mirror 采集邮件数据。

    lore.kernel.org 将每个邮件列表按 epoch 存储为 git 仓库，
    每个 commit 对应一封邮件，commit message 中包含完整的 RFC2822 格式邮件。

    Attributes:
        base_url: lore.kernel.org 基础 URL。
        data_dir: 本地 git 仓库存储目录。
    """

    def __init__(self, base_url: str = "https://lore.kernel.org", data_dir: str = "./data/repos"):
        """初始化 GitCollector。

        Args:
            base_url: lore.kernel.org 基础 URL。
            data_dir: 本地 git 仓库存储路径。
        """
        self.base_url = base_url.rstrip("/")
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _repo_path(self, list_name: str, epoch: int) -> Path:
        """获取本地 git 仓库路径。"""
        return self.data_dir / list_name / "git" / f"{epoch}.git"

    def _clone_or_fetch(self, list_name: str, epoch: int) -> Repo:
        """克隆或更新 git 仓库。

        如果本地已存在仓库，则执行 git fetch；否则执行 git clone --mirror。

        Args:
            list_name: 邮件列表名称。
            epoch: epoch 编号。

        Returns:
            git.Repo 对象。

        Raises:
            GitCommandError: git 操作失败。
        """
        repo_path = self._repo_path(list_name, epoch)
        remote_url = f"{self.base_url}/{list_name}/{epoch}"

        if repo_path.exists():
            try:
                repo = Repo(str(repo_path))
                logger.info("Fetching updates for %s epoch %d...", list_name, epoch)
                repo.remotes.origin.fetch()
                return repo
            except (InvalidGitRepositoryError, GitCommandError) as e:
                logger.warning("Existing repo invalid, re-cloning: %s", e)

        logger.info("Cloning %s epoch %d from %s...", list_name, epoch, remote_url)
        repo_path.parent.mkdir(parents=True, exist_ok=True)
        repo = Repo.clone_from(remote_url, str(repo_path), mirror=True)
        logger.info("Clone complete: %s", repo_path)
        return repo

    def _extract_email_from_commit(
        self, repo: Repo, commit_hash: str, list_name: str, epoch: int
    ) -> Optional[RawEmail]:
        """从 git commit 中提取邮件数据。

        lore.kernel.org 的 git 仓库中，每个 commit 的 tree 包含一个 'm' blob，
        其内容为完整的 RFC2822 格式邮件。

        Args:
            repo: git.Repo 对象。
            commit_hash: commit hash。
            list_name: 邮件列表名称。
            epoch: epoch 编号。

        Returns:
            解析成功返回 RawEmail，失败返回 None。
        """
        try:
            commit = repo.commit(commit_hash)
            # lore git 仓库中邮件存储在 tree 的 'm' blob 中
            blob = commit.tree / "m"
            raw_content = blob.data_stream.read().decode("utf-8", errors="replace")

            # 分离 headers 和 body
            parts = raw_content.split("\n\n", 1)
            raw_headers = parts[0] if parts else ""
            raw_body = parts[1] if len(parts) > 1 else ""

            # 提取 Message-ID
            msg = email.message_from_string(raw_content)
            message_id = msg.get("Message-ID", "").strip("<>")

            if not message_id:
                logger.warning("No Message-ID in commit %s, skipping", commit_hash[:8])
                return None

            return RawEmail(
                message_id=message_id,
                raw_headers=raw_headers,
                raw_body=raw_body,
                list_name=list_name,
                epoch=epoch,
                commit_hash=str(commit_hash),
            )
        except Exception as e:
            logger.error("Failed to extract email from commit %s: %s", commit_hash[:8], e)
            return None

    def collect(
        self,
        list_name: str,
        epoch: int = 0,
        since: Optional[datetime] = None,
    ) -> list[RawEmail]:
        """从 git mirror 采集邮件。

        Args:
            list_name: 邮件列表名称，如 "linux-mm"。
            epoch: epoch 编号。
            since: 增量采集起始时间，None 表示全量。

        Returns:
            采集到的 RawEmail 列表。
        """
        repo = self._clone_or_fetch(list_name, epoch)
        emails: list[RawEmail] = []

        # 遍历所有 commit
        rev = "HEAD"
        commits = list(repo.iter_commits(rev))
        logger.info("Processing %d commits from %s epoch %d...", len(commits), list_name, epoch)

        for commit in commits:
            # 增量过滤：跳过早于 since 的 commit
            if since and commit.committed_datetime.replace(tzinfo=None) < since:
                continue

            raw_email = self._extract_email_from_commit(
                repo, commit.hexsha, list_name, epoch
            )
            if raw_email:
                emails.append(raw_email)

        logger.info("Collected %d emails from %s epoch %d", len(emails), list_name, epoch)
        return emails

    def get_epoch_count(self, list_name: str) -> int:
        """通过尝试访问递增的 epoch URL 来确定 epoch 总数。

        Args:
            list_name: 邮件列表名称。

        Returns:
            epoch 总数。
        """
        import httpx

        count = 0
        while True:
            url = f"{self.base_url}/{list_name}/{count}"
            try:
                resp = httpx.head(url, follow_redirects=True, timeout=10)
                if resp.status_code == 200:
                    count += 1
                else:
                    break
            except httpx.RequestError:
                break
        logger.info("Found %d epochs for %s", count, list_name)
        return count
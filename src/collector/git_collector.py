"""Git 数据源采集器，从 lore.kernel.org git mirror 采集邮件。"""

import email
import email.errors
import logging
import os
import re
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
            data_dir: 本地 git 仓库存储路径，支持 ~ 家目录展开。
        """
        self.base_url = base_url.rstrip("/")
        self.data_dir = Path(os.path.expanduser(data_dir))
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _repo_path(self, list_name: str, epoch: int) -> Path:
        """获取本地 git 仓库路径。"""
        return self.data_dir / list_name / "git" / f"{epoch}.git"

    def _clone_or_fetch(self, list_name: str, epoch: int) -> Repo:
        """打开本地仓库，若不存在则从远端克隆。

        优先使用本地已有的 git mirror 仓库（如手动 clone 的），
        仅在本地不存在时才从远端克隆。

        Args:
            list_name: 邮件列表名称。
            epoch: epoch 编号。

        Returns:
            git.Repo 对象。

        Raises:
            GitCommandError: git 操作失败。
            FileNotFoundError: 本地仓库不存在且无法克隆。
        """
        repo_path = self._repo_path(list_name, epoch)

        if repo_path.exists():
            try:
                repo = Repo(str(repo_path))
                logger.info("Using local repo: %s", repo_path)
                return repo
            except InvalidGitRepositoryError as e:
                logger.warning("Local repo invalid at %s: %s", repo_path, e)

        # 本地不存在，尝试远端克隆
        remote_url = f"{self.base_url}/{list_name}/{epoch}"
        logger.info("Local repo not found, cloning %s epoch %d from %s...", list_name, epoch, remote_url)
        repo_path.parent.mkdir(parents=True, exist_ok=True)
        repo = Repo.clone_from(remote_url, str(repo_path), mirror=True)
        logger.info("Clone complete: %s", repo_path)
        return repo

    def _extract_email_from_commit(
        self, commit, list_name: str, epoch: int
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
            # lore git 仓库中邮件存储在 tree 的 'm' blob 中
            blob = commit.tree / "m"
            raw_content = blob.data_stream.read().decode("utf-8", errors="replace")

            # 分离 headers 和 body
            parts = raw_content.split("\n\n", 1)
            raw_headers = parts[0] if parts else ""
            raw_body = parts[1] if len(parts) > 1 else ""

            # 提取 Message-ID。先用 header regex，避免为每封邮件构造完整 message 对象。
            match = re.search(r"(?im)^Message-ID:\s*<?([^>\s]+)>?", raw_headers)
            if not match:
                msg = email.message_from_string(raw_content)
                message_id = msg.get("Message-ID", "").strip("<>")
            else:
                message_id = match.group(1).strip()

            if not message_id:
                logger.warning("No Message-ID in commit %s, skipping", commit.hexsha[:8])
                return None

            return RawEmail(
                message_id=message_id,
                raw_headers=raw_headers,
                raw_body=raw_body,
                list_name=list_name,
                epoch=epoch,
                commit_hash=str(commit.hexsha),
            )
        except (GitCommandError, ValueError, KeyError, email.errors.MessageError) as e:
            logger.error("Failed to extract email from commit %s: %s", commit.hexsha[:8], e)
            return None

    def collect_iter(
        self,
        list_name: str,
        epoch: int = 0,
        since: Optional[datetime] = None,
        limit: int = 0,
    ):
        """流式采集邮件，适合 LKML 这类超大 epoch。"""
        repo = self._clone_or_fetch(list_name, epoch)
        processed = 0
        collected = 0
        skipped = 0
        try:
            commit_iter = repo.iter_commits("HEAD")
        except GitCommandError:
            logger.info("HEAD not available, using --all for bare repo")
            commit_iter = repo.iter_commits(all=True)

        for commit in commit_iter:
            processed += 1
            if processed % 1000 == 0:
                logger.info(
                    "Progress: processed %d commits, collected %d emails from %s epoch %d",
                    processed, collected, list_name, epoch,
                )

            if since and commit.committed_datetime.replace(tzinfo=None) < since:
                skipped += 1
                continue

            raw_email = self._extract_email_from_commit(commit, list_name, epoch)
            if raw_email:
                collected += 1
                yield raw_email

            if limit and collected >= limit:
                logger.info("Reached limit of %d emails, stopping", limit)
                break

        logger.info(
            "Collected %d emails from %s epoch %d (processed %d commits, skipped %d)",
            collected, list_name, epoch, processed, skipped,
        )

    def collect(
        self,
        list_name: str,
        epoch: int = 0,
        since: Optional[datetime] = None,
        limit: int = 0,
    ) -> list[RawEmail]:
        """从 git mirror 采集邮件。

        Args:
            list_name: 邮件列表名称，如 "linux-mm"。
            epoch: epoch 编号。
            since: 增量采集起始时间，None 表示全量。
            limit: 最大采集数量，0 表示不限制。

        Returns:
            采集到的 RawEmail 列表。
        """
        return list(self.collect_iter(list_name=list_name, epoch=epoch, since=since, limit=limit))

    def get_epoch_count(self, list_name: str) -> int:
        """获取邮件列表的 epoch 总数。

        优先扫描本地目录（查找 N.git 格式的目录），
        若本地无数据则 fallback 到 HTTP HEAD 探测远端。

        Args:
            list_name: 邮件列表名称。

        Returns:
            epoch 总数。
        """
        # 策略1：扫描本地目录
        git_dir = self.data_dir / list_name / "git"
        if git_dir.exists():
            epochs = []
            for item in git_dir.iterdir():
                if item.is_dir() and item.name.endswith(".git"):
                    try:
                        epoch_num = int(item.name[:-4])  # 去掉 .git 后缀
                        epochs.append(epoch_num)
                    except ValueError:
                        continue
            if epochs:
                count = max(epochs) + 1
                logger.info("Found %d epochs locally for %s", count, list_name)
                return count

        # 策略2：HTTP HEAD 探测远端
        logger.info("No local repos found, probing remote for %s epochs...", list_name)
        try:
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
            logger.info("Found %d epochs via HTTP for %s", count, list_name)
            return count
        except ImportError:
            logger.warning("httpx not installed, cannot probe remote epochs")
            return 0

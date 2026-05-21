import asyncio

import pytest
from fastapi import HTTPException

from src.api import state
from src.api.routers.kernel import (
    _history_entry,
    _normalize_commit_hash,
    code_repositories,
    code_resolve,
    code_symbol_resolve,
    kernel_resolve,
    kernel_symbol_resolve,
)
from src.kernel_source.elixir import ElixirSource
from src.kernel_source.base import BaseKernelSource, FileContent, TreeEntry, VersionInfo


class FakeKernelSource(BaseKernelSource):
    def __init__(self, files: dict[tuple[str, str], FileContent] | None = None):
        self.files = files or {}

    async def list_versions(self, include_rc: bool = False) -> list[VersionInfo]:
        return []

    async def list_tree(self, version: str, path: str = "") -> list[TreeEntry]:
        return []

    async def get_file(self, version: str, path: str) -> FileContent:
        key = (version, path)
        if key not in self.files:
            raise FileNotFoundError(f"File not found: {version}:{path}")
        return self.files[key]


@pytest.fixture(autouse=True)
def restore_kernel_state(monkeypatch):
    monkeypatch.setattr(state, "_app_config", {})
    monkeypatch.setattr(state, "_code_repositories", {})
    yield
    monkeypatch.setattr(state, "_kernel_source", None)
    monkeypatch.setattr(state, "_code_repositories", {})


def test_kernel_resolve_returns_local_code_browser_url(monkeypatch):
    asyncio.run(_test_kernel_resolve_returns_local_code_browser_url(monkeypatch))


async def _test_kernel_resolve_returns_local_code_browser_url(monkeypatch):
    monkeypatch.setattr(
        state,
        "_kernel_source",
        FakeKernelSource(
            {
                ("v6.8", "mm/vmscan.c"): FileContent(
                    path="mm/vmscan.c",
                    version="v6.8",
                    content="int shrink_node(void) { return 0; }\n",
                    line_count=1,
                    size=35,
                    truncated=False,
                )
            }
        ),
    )

    result = await kernel_resolve(version="v6.8", path="/mm/vmscan.c", line=12)

    assert result["source"] == "local"
    assert result["url"] == "/app/kernel-code?v=v6.8&path=mm%2Fvmscan.c&line=12"
    assert result["external_source"] == "elixir"
    assert result["local_file_available"] is True
    assert result["path"] == "mm/vmscan.c"
    assert result["line"] == 12
    assert result["fallback_reason"] is None


def test_code_repositories_lists_configured_repositories(monkeypatch):
    monkeypatch.setattr(
        state,
        "_code_repositories",
        {
            "linux": {
                "id": "linux",
                "name": "Linux Kernel",
                "default_version": "v6.8",
                "elixir_base": "https://elixir.bootlin.com/linux",
                "source": FakeKernelSource(),
            },
            "qemu": {
                "id": "qemu",
                "name": "QEMU",
                "default_version": "master",
                "elixir_base": "https://elixir.bootlin.com/qemu",
                "source": FakeKernelSource(),
            },
        },
    )

    result = code_repositories()

    assert [repo["id"] for repo in result["repositories"]] == ["linux", "qemu"]
    assert result["repositories"][1]["name"] == "QEMU"
    assert result["repositories"][1]["default_version"] == "master"
    assert result["repositories"][1]["elixir_base"] == "https://elixir.bootlin.com/qemu"


def test_code_resolve_returns_repo_specific_local_url(monkeypatch):
    asyncio.run(_test_code_resolve_returns_repo_specific_local_url(monkeypatch))


async def _test_code_resolve_returns_repo_specific_local_url(monkeypatch):
    monkeypatch.setattr(
        state,
        "_code_repositories",
        {
            "qemu": {
                "id": "qemu",
                "name": "QEMU",
                "default_version": "master",
                "elixir_base": "https://elixir.bootlin.com/qemu",
                "source": FakeKernelSource(
                    {
                        ("master", "hw/core/machine.c"): FileContent(
                            path="hw/core/machine.c",
                            version="master",
                            content="void machine_run_board_init(void) {}\n",
                            line_count=1,
                            size=37,
                            truncated=False,
                        )
                    }
                ),
            }
        },
    )

    result = await code_resolve(repo_id="qemu", version="master", path="/hw/core/machine.c", line=42)

    assert result["source"] == "local"
    assert result["url"] == "/app/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=42"
    assert result["external_url"] == "https://elixir.bootlin.com/qemu/master/source/hw/core/machine.c#L42"
    assert result["external_source"] == "elixir"
    assert result["path"] == "hw/core/machine.c"


def test_code_resolve_rejects_unknown_repository(monkeypatch):
    asyncio.run(_test_code_resolve_rejects_unknown_repository(monkeypatch))


async def _test_code_resolve_rejects_unknown_repository(monkeypatch):
    monkeypatch.setattr(state, "_code_repositories", {})

    with pytest.raises(HTTPException) as exc_info:
        await code_resolve(repo_id="ovs", version="master", path="lib/ofp-actions.c", line=None)

    assert exc_info.value.status_code == 404
    assert "Unknown code repository" in exc_info.value.detail


def test_code_symbol_resolve_uses_repo_elixir_base(monkeypatch):
    asyncio.run(_test_code_symbol_resolve_uses_repo_elixir_base(monkeypatch))


async def _test_code_symbol_resolve_uses_repo_elixir_base(monkeypatch):
    monkeypatch.setattr(
        state,
        "_code_repositories",
        {
            "qemu": {
                "id": "qemu",
                "name": "QEMU",
                "default_version": "master",
                "elixir_base": "https://elixir.bootlin.com/qemu",
                "source": FakeKernelSource(
                    {
                        ("master", "hw/core/machine.c"): FileContent(
                            path="hw/core/machine.c",
                            version="master",
                            content="void machine_run_board_init(void) {}\n",
                            line_count=1,
                            size=37,
                            truncated=False,
                        )
                    }
                ),
            }
        },
    )

    async def fake_resolve_symbol(self, version: str, symbol: str, limit: int = 10):
        assert self._base_url == "https://elixir.bootlin.com/qemu"
        assert version == "master"
        assert symbol == "machine_run_board_init"
        return [
            {
                "version": "master",
                "path": "hw/core/machine.c",
                "line": 88,
                "url": "https://elixir.bootlin.com/qemu/master/source/hw/core/machine.c#L88",
            }
        ]

    monkeypatch.setattr(ElixirSource, "resolve_symbol", fake_resolve_symbol)

    result = await code_symbol_resolve(repo_id="qemu", version="master", symbol="machine_run_board_init")

    assert result.query_url == "https://elixir.bootlin.com/qemu/master/ident/machine_run_board_init"
    assert result.candidates[0].local_url == "/app/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=88"
    assert result.candidates[0].external_url == "https://elixir.bootlin.com/qemu/master/source/hw/core/machine.c#L88"


def test_kernel_resolve_falls_back_to_external_link(monkeypatch):
    asyncio.run(_test_kernel_resolve_falls_back_to_external_link(monkeypatch))


async def _test_kernel_resolve_falls_back_to_external_link(monkeypatch):
    monkeypatch.setattr(state, "_kernel_source", FakeKernelSource())

    result = await kernel_resolve(version="v6.8", path="drivers/missing.c", line=None)

    assert result["source"] == "elixir"
    assert result["url"] == "https://elixir.bootlin.com/linux/v6.8/source/drivers/missing.c"
    assert result["external_url"] == result["url"]
    assert result["local_file_available"] is False
    assert "File not found" in result["fallback_reason"]


def test_kernel_resolve_uses_git_kernel_org_for_unsupported_elixir_version(monkeypatch):
    asyncio.run(_test_kernel_resolve_uses_git_kernel_org_for_unsupported_elixir_version(monkeypatch))


async def _test_kernel_resolve_uses_git_kernel_org_for_unsupported_elixir_version(monkeypatch):
    monkeypatch.setattr(state, "_kernel_source", FakeKernelSource())

    result = await kernel_resolve(version="v2.6.11", path="init/main.c", line=7)

    assert result["source"] == "git.kernel.org"
    assert result["url"].endswith("/tree/init/main.c?h=v2.6.11#n7")
    assert result["local_file_available"] is False


def test_kernel_resolve_rejects_parent_path(monkeypatch):
    asyncio.run(_test_kernel_resolve_rejects_parent_path(monkeypatch))


async def _test_kernel_resolve_rejects_parent_path(monkeypatch):
    monkeypatch.setattr(state, "_kernel_source", FakeKernelSource())

    with pytest.raises(HTTPException) as exc_info:
        await kernel_resolve(version="v6.8", path="../secret", line=None)

    assert exc_info.value.status_code == 400
    assert "Invalid kernel source path" in exc_info.value.detail


def test_kernel_symbol_resolve_returns_local_jump_candidates(monkeypatch):
    asyncio.run(_test_kernel_symbol_resolve_returns_local_jump_candidates(monkeypatch))


async def _test_kernel_symbol_resolve_returns_local_jump_candidates(monkeypatch):
    monkeypatch.setattr(
        state,
        "_kernel_source",
        FakeKernelSource(
            {
                ("v6.8", "mm/vmscan.c"): FileContent(
                    path="mm/vmscan.c",
                    version="v6.8",
                    content="int shrink_node(void) { return 0; }\n",
                    line_count=1,
                    size=35,
                    truncated=False,
                )
            }
        ),
    )

    async def fake_resolve_symbol(self, version: str, symbol: str, limit: int = 10):
        assert version == "v6.8"
        assert symbol == "shrink_node"
        assert limit == 10
        return [
            {
                "version": "v6.8",
                "path": "mm/vmscan.c",
                "line": 1234,
                "url": "https://elixir.bootlin.com/linux/v6.8/source/mm/vmscan.c#L1234",
            }
        ]

    monkeypatch.setattr(ElixirSource, "resolve_symbol", fake_resolve_symbol)

    result = await kernel_symbol_resolve(version="v6.8", symbol="shrink_node")

    assert result.resolved is True
    assert result.query_url == "https://elixir.bootlin.com/linux/v6.8/ident/shrink_node"
    assert result.candidates[0].path == "mm/vmscan.c"
    assert result.candidates[0].line == 1234
    assert result.candidates[0].local_file_available is True
    assert result.candidates[0].local_url == "/app/kernel-code?v=v6.8&path=mm%2Fvmscan.c&line=1234"
    assert result.candidates[0].external_url == "https://elixir.bootlin.com/linux/v6.8/source/mm/vmscan.c#L1234"


def test_kernel_symbol_resolve_returns_empty_when_elixir_has_no_match(monkeypatch):
    asyncio.run(_test_kernel_symbol_resolve_returns_empty_when_elixir_has_no_match(monkeypatch))


async def _test_kernel_symbol_resolve_returns_empty_when_elixir_has_no_match(monkeypatch):
    monkeypatch.setattr(state, "_kernel_source", FakeKernelSource())

    async def fake_resolve_symbol(self, version: str, symbol: str, limit: int = 10):
        raise FileNotFoundError(f"Symbol not found on elixir: {version}:{symbol}")

    monkeypatch.setattr(ElixirSource, "resolve_symbol", fake_resolve_symbol)

    result = await kernel_symbol_resolve(version="v6.8", symbol="nonexistent_symbol")

    assert result.resolved is False
    assert result.candidates == []
    assert "Symbol not found on elixir" in (result.fallback_reason or "")


def test_commit_hash_normalization_accepts_blame_boundary_marker():
    normalized = _normalize_commit_hash("^1a2b3c4d5e6f")

    assert normalized == "1a2b3c4d5e6f"


def test_history_entry_strips_blame_boundary_marker():
    entry = _history_entry(
        commit_hash="^1a2b3c4d5e6f",
        short_hash="^1a2b3c4d5e6f",
        author_name="Author",
        author_email="author@example.com",
        author_time="0",
        subject="initial import",
    )

    assert entry["commit_hash"] == "1a2b3c4d5e6f"
    assert entry["short_hash"] == "1a2b3c4d5e6f"

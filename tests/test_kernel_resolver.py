import asyncio

import pytest
from fastapi import HTTPException

from src.api import state
from src.api.routers.kernel import kernel_resolve
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
    yield
    monkeypatch.setattr(state, "_kernel_source", None)


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

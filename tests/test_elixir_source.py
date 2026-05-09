import asyncio

from src.kernel_source.elixir import ElixirSource


def test_elixir_source_can_extract_symbol_candidates_from_ident_page(monkeypatch):
    asyncio.run(_test_elixir_source_can_extract_symbol_candidates_from_ident_page(monkeypatch))


async def _test_elixir_source_can_extract_symbol_candidates_from_ident_page(monkeypatch):
    source = ElixirSource()
    expected_url = "https://elixir.bootlin.com/linux/v6.8/ident/shrink_node"
    ident_html = """
    <html>
      <body>
        <a href="/linux/v6.8/source/mm/vmscan.c#L1234">mm/vmscan.c</a>
        <a href="/linux/v6.8/source/mm/vmscan.c#L1234">duplicate</a>
        <a href="/linux/v6.8/source/mm/page_alloc.c#L88">mm/page_alloc.c</a>
        <a href="/linux/v6.8/source/mm/page_alloc.c">missing line</a>
        <a href="/linux/v6.7/source/mm/old.c#L12">old version</a>
      </body>
    </html>
    """

    async def fake_fetch(url: str) -> str:
        assert url == expected_url
        return ident_html

    monkeypatch.setattr(source, "_fetch", fake_fetch)

    candidates = await source.resolve_symbol("v6.8", "shrink_node")

    assert len(candidates) == 2
    assert candidates[0]["version"] == "v6.8"
    assert candidates[0]["path"] == "mm/vmscan.c"
    assert candidates[0]["line"] == 1234
    assert candidates[0]["url"] == "https://elixir.bootlin.com/linux/v6.8/source/mm/vmscan.c#L1234"
    assert candidates[1]["path"] == "mm/page_alloc.c"
    assert candidates[1]["line"] == 88

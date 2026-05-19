## Summary

Add visible progress reporting to the manual import CLI so long-running imports show both overall progress and current section progress.

## Scope

Files in scope:
- `scripts/ingest_manual.py`
- `src/parser/intel_sdm/parser.py`
- `README.md`

Out of scope:
- Storage layer changes
- API changes
- Frontend changes
- Parallel import execution

## Goals

- Show a single overall progress percentage from import start to completion.
- Show the current section number, total sections, section title, and page range while parsing.
- Preserve the existing CLI entrypoint and flags.
- Keep the implementation dependency-free and log-based.

## Non-Goals

- Exact page-by-page percentages inside a section
- Progress persistence or resumable imports
- Rich TUI progress bars

## Current Behavior

`scripts/ingest_manual.py` logs phase boundaries and final stats. During parsing, the CLI only shows start and end messages. During storage, it logs one line per stored batch.

`src/parser/intel_sdm/parser.py` builds the TOC, section tree, and content in one synchronous flow. It does not currently expose parsing progress.

## Proposed Design

### 1. Parser progress callback

Add an optional callback parameter to `IntelSDMParser.build_section_tree(...)` and its internal content-fill traversal.

Callback payload:
- `current_section`
- `total_sections`
- `section_title`
- `page_start`
- `page_end`

The callback fires once when a section node begins content extraction. This gives accurate section-level visibility without adding page-level log noise.

### 2. CLI progress reporter

Add a small progress reporter in `scripts/ingest_manual.py` that prints structured log lines for:
- import start
- TOC extraction complete
- current parsing section
- section parsing complete
- chunking complete
- storage progress
- import complete

The CLI computes overall progress with fixed weights:
- Parsing: `0% -> 45%`
- Chunking: `45% -> 65%`
- Storing: `65% -> 100%`

During parsing, overall progress advances from the section callback:

`overall = parsing_start + (current_section / total_sections) * parsing_weight`

During storing, overall progress advances from real stored chunk counts:

`overall = storing_start + (stored_chunks / total_chunks) * storing_weight`

### 3. Log format

Progress output should remain plain log lines, for example:

```text
[  0%] Start import: intel_sdm /path/to/sdm.pdf
[  8%] TOC extracted: 123 entries
[ 12%] Parsing section 1/58: Introduction (pages 1-12)
[ 18%] Parsing section 2/58: System Architecture Overview (pages 13-37)
[ 45%] Section parsing complete: 58 sections
[ 65%] Chunking complete: 4821 chunks
[ 72%] Storing chunks: 100/4821
[100%] Import complete: stored 4821 chunks
```

The exact intermediate percentages may vary slightly because they are stage-weighted, but the shape of the output should stay stable.

## Error Handling

- If the PDF path does not exist, keep the current immediate error and exit behavior.
- If the TOC is empty, preserve current parser behavior.
- If storing is disabled, progress still reaches completion after chunking and sample output.
- Callback failures should not crash parsing; the CLI-owned callback should stay simple and synchronous.

## Testing Strategy

- Run the import CLI against a small PDF with `--sample` and verify the new parsing and overall progress logs appear in order.
- Run with `--store` and verify storage progress reaches `100%`.
- Run with `--max-pages` and verify section progress still reports bounded work.

## README Update

Update the manual import section to note that the CLI now prints overall progress plus current section progress during long-running imports.

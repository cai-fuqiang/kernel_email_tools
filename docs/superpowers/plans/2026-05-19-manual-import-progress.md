# Manual Import Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add overall and per-section progress logging to the manual import CLI without changing API or storage behavior.

**Architecture:** Extend the Intel SDM parser with an optional section progress callback, then add a small CLI-side progress reporter that maps parser callbacks and storage batches into a single stage-weighted overall percentage. Keep output log-based and dependency-free so the existing CLI entrypoint and flags continue to work.

**Tech Stack:** Python, asyncio, PyMuPDF (`fitz`), existing logging

---

### Task 1: Add parser callback support

**Files:**
- Modify: `src/parser/intel_sdm/parser.py`

- [ ] **Step 1: Add a small callback type import and thread an optional callback through parser methods**

```python
from collections.abc import Callable

def build_section_tree(
    self,
    pdf_path: str,
    toc: list[TOCEntry],
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> list[SectionNode]:
```

- [ ] **Step 2: Add a section counter helper and invoke the callback before each section content extraction**

```python
def _fill_content(
    self,
    doc: fitz.Document,
    nodes: list[SectionNode],
    *,
    total_sections: int,
    progress_state: dict[str, int],
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> None:
    for node in nodes:
        progress_state["current"] += 1
        if progress_callback:
            progress_callback({
                "current_section": progress_state["current"],
                "total_sections": total_sections,
                "section_title": node.title,
                "page_start": node.page_start,
                "page_end": node.page_end,
            })
```

- [ ] **Step 3: Keep existing parse behavior unchanged by making the callback optional**

```python
def parse(self, pdf_path: str) -> list[SectionNode]:
    toc = self.parse_toc(pdf_path)
    if not toc:
        logger.warning("No TOC found, falling back to flat page extraction")
        return self._fallback_flat_parse(pdf_path)
    return self.build_section_tree(pdf_path, toc)
```

### Task 2: Add CLI progress reporting

**Files:**
- Modify: `scripts/ingest_manual.py`

- [ ] **Step 1: Add a lightweight reporter to format progress lines consistently**

```python
class ProgressReporter:
    def log(self, percent: float, message: str) -> None:
        logger.info("[%3d%%] %s", round(percent), message)
```

- [ ] **Step 2: Hook TOC, parser callback, chunking, and storage into stage-weighted progress updates**

```python
reporter.log(0, f"Start import: {args.manual_type} {pdf_path}")
reporter.log(8, f"TOC extracted: {len(toc)} entries")
sections = sdm_parser.build_section_tree(
    str(pdf_path),
    toc,
    progress_callback=reporter.section_callback,
)
reporter.log(65, f"Chunking complete: {len(chunks)} chunks")
```

- [ ] **Step 3: Preserve current store behavior while upgrading batch logs into overall progress logs**

```python
stored_percent = 65 + (total_stored / len(chunks)) * 35
reporter.log(stored_percent, f"Storing chunks: {total_stored}/{len(chunks)}")
```

### Task 3: Document and verify behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the manual import section to mention overall and current section progress logs**

```md
手册导入命令会打印总体进度和当前章节进度，便于观察长时间解析任务的执行状态。
```

- [ ] **Step 2: Run a focused syntax-level verification of changed Python files**

Run: `rtk python -m py_compile scripts/ingest_manual.py src/parser/intel_sdm/parser.py`
Expected: exit code `0`

- [ ] **Step 3: Run the import CLI help to verify the entrypoint still loads**

Run: `rtk python scripts/ingest_manual.py --help`
Expected: usage text prints without traceback

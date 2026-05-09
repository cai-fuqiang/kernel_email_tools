> **Status**: future
> **Updated**: 2026-05-08
> **Depends-on**: PLAN-31002 (Knowledge Workbench), PLAN-35000 (AI Research Agent), PLAN-35001 (AI-Assisted Knowledge Pipeline)
> **Priority**: P3 — low priority; only start after search/ask/evidence/review workflows are stable

# PLAN-37000: Low-Priority Markdown Wiki Export

## Summary

Add a lightweight, read-only Markdown export layer for approved knowledge so the project can produce an Obsidian-compatible wiki without turning Obsidian into the primary storage system.

The goal is not to replace the current database-backed Knowledge Workbench. The goal is to make reviewed knowledge easier to read, diff, back up, and browse outside the web app.

This plan is inspired by Karpathy's "LLM Wiki" idea: raw sources remain the source of truth, while a human-readable wiki becomes the durable knowledge surface. For this project, the database and evidence model remain authoritative; Markdown is an export artifact.

## Priority Rationale

This is useful but not urgent.

Current higher-priority work should remain:

1. Reliable mail/manual/source ingestion and indexing.
2. High-quality Search and Ask results.
3. First-class evidence and Draft Review correctness.
4. Stable Knowledge Entity structure and merge/review workflow.

Markdown export should wait until approved knowledge has enough structure and evidence quality. Exporting unstable or weakly reviewed knowledge would only create a prettier copy of uncertain data.

## Non-Goals

- Do not make Markdown files the source of truth.
- Do not build bidirectional Obsidian sync.
- Do not build an Obsidian plugin in the first version.
- Do not let an LLM rewrite the whole wiki automatically.
- Do not export unreviewed AI drafts by default.
- Do not create a second knowledge schema that diverges from the database.

## Proposed Output

Default export directory:

```text
exports/wiki/
├── index.md
├── log.md
├── concepts/
├── subsystems/
├── questions/
├── patches/
└── sources/
```

Each exported page should be valid Markdown with YAML frontmatter:

```yaml
---
id: knowledge_entity_id
type: concept
status: active
tags:
  - kvm
  - mmu
updated_at: 2026-05-08T00:00:00Z
sources:
  - type: email
    message_id: "<...>"
    url: "https://lore.kernel.org/..."
---
```

Page body should prefer a stable structure:

```markdown
# Entity Title

## Summary

Short reviewed explanation.

## Details

Long-form notes or explanation.

## Evidence

- Claim: ...
  Source: lore URL / message-id / manual section / kernel source path

## Related

- [[other-entity]]
```

## Phase 1: One-Way Export Script

Add a script:

```bash
python scripts/export_wiki.py
```

Behavior:

- Read approved/active knowledge entities from the database.
- Export only reviewed knowledge by default.
- Include evidence references when available.
- Generate stable filenames from canonical names plus short ids.
- Generate `index.md` grouped by entity type/tag.
- Generate `log.md` with export timestamp and changed entity count.
- Do not write anything back to the database.

Acceptance criteria:

- Running the script produces a browsable Markdown wiki.
- Re-running the script is deterministic when the source data has not changed.
- Obsidian can open `exports/wiki/` without special plugins.
- Evidence links remain visible even if the web app is not running.

## Phase 2: Export Health Checks

Add optional checks:

- Knowledge entity without evidence.
- Broken or missing source URL.
- Duplicate generated filename.
- Entity with no summary.
- Relation pointing to a missing/deprecated entity.

Acceptance criteria:

- Export prints warnings but does not fail for non-critical quality issues.
- CI/test mode can fail on severe structural errors.

## Phase 3: Web UI Trigger

Add a low-friction admin/editor action:

- Export Wiki
- Download/open export path
- Show latest export timestamp
- Show export warnings

This should remain secondary UI, not a main navigation focus.

## Phase 4: Optional LLM Wiki Assistance

Only after the export format is stable:

- Let Research Agent propose Markdown page updates as reviewable diffs.
- Keep proposed updates in Draft Review.
- Require evidence for every new claim.
- Maintain `index.md` and `log.md` through the same review path.

This phase should not begin until the system has strong evidence checks and a clear human approval flow.

## Open Questions

- Should exported pages be grouped by tag, entity type, or both?
- Should Markdown include full source quotes or only short evidence snippets?
- Should deprecated/merged entities export as redirect pages?
- Should exports include private annotations, or only public/approved knowledge?
- Should manual sections and kernel source paths get dedicated pages under `sources/`?

## Decision

Keep this as a low-priority future feature.

The recommended first implementation is a one-way Markdown export of approved Knowledge Entities, suitable for browsing in Obsidian. Do not invest in bidirectional sync or plugin work until the core knowledge workflow is demonstrably stable.

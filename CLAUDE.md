# Project Instructions

## Feature Brief Required

Every new feature request MUST include a Feature Brief. If a request lacks one, return the template below and do NOT explore the codebase:

```
## Feature Brief
目标: [one sentence]
影响模块:
  - backend: [file paths]
  - frontend: [file paths]
不影响: [explicit exclusions]
```

## Session Start

Read `AGENTS.md` before any task. It contains the code map, tool rules, and cross-session context (Architecture Decisions Log, Current Feature Context).

## Token Rules

- caveman full mode always active
- Use LSP tools instead of reading entire files
- Use `Read` with `offset`+`limit` for large files
- No speculative reads beyond Feature Brief scope

## After Each Feature

Update `AGENTS.md`:
1. Append to Architecture Decisions Log
2. Clear Current Feature Context (replace content with `<!-- No active feature -->`)
3. Update module tables if new files added

---
name: kernel-email-tools-token
description: Use when working in kernel_email_tools and token efficiency or fast project re-entry matters
---

# Kernel Email Tools Token Workflow

Use this repo in low-token mode.

## Start

1. Read `AGENTS.md` first.
2. Require a brief before project work.
3. Read only paths named in brief.

## Rules

- Treat `AGENTS.md` as primary memory.
- Use `docs/ai/brief-templates.md` for request shape.
- For large files, read partial slices only.
- Prefer symbol lookup, references, and targeted search over full-file reads.
- Use `rtk` for shell commands.
- Answer short by default: decision, change, verification, risk.
- Do not repeat repo context already captured in `AGENTS.md`.

## Memory

- Stable fact or workflow decision: append one line to `Architecture Decisions Log`.
- Active feature notes: put in `Current Feature Context`, then clear when done.
- Do not store long narratives in permanent memory.

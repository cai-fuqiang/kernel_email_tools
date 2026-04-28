# PLAN-35000: AI Research Agent as a Special User

## Summary

Introduce an AI research agent, for example `lobster-agent`, as a first-class special user in the existing multi-user system. The agent can read, search, ask, inspect evidence, and create reviewable knowledge drafts, but it must not silently bypass permissions or directly mutate trusted public knowledge by default.

The product goal is not "AI replaces review." The goal is "AI performs the full research loop, preserves evidence and traceability, then hands humans high-quality drafts to accept, reject, or edit." Later phases can allow high-confidence auto-accept under strict policy.

## Product Model

### Agent identity

- Represent every AI agent as a user record, not as an anonymous backend process.
- Recommended default account:
  - `username`: `lobster-agent`
  - `display_name`: `Lobster Research Agent`
  - `role`: `agent`
  - `auth_source`: `system_agent`
  - `approval_status`: `approved`
  - `status`: `active`
- All agent-created objects must preserve:
  - `author_user_id` / `created_by_user_id`
  - `agent_run_id`
  - `agent_name`
  - `model`
  - `prompt_version`
  - `created_at`
  - confidence and review status metadata.

### Permission boundary

- Add an `agent` role distinct from `admin`, `editor`, and `viewer`.
- Agent capabilities:
  - read public and allowed private context according to configured policy,
  - run search and ask workflows,
  - inspect threads and source evidence,
  - create `KnowledgeDraft`,
  - create private annotations or agent notes,
  - suggest tags, relations, merges, and updates.
- Agent must not:
  - approve publication,
  - manage users,
  - delete human-created content,
  - silently merge entities,
  - silently publish public active knowledge unless an explicit auto-accept policy is enabled.

### Trust states

- Agent output defaults to `draft` or `pending_review`.
- Accepted human-reviewed output becomes normal active knowledge but retains original agent provenance.
- Rejected output remains searchable for audit but does not influence active knowledge workflows.
- Auto-accepted output, if enabled later, must still be visibly marked as agent-created and auto-accepted.

## Agent Research Workflow

### Run lifecycle

Create an `agent_research_runs` concept, either as a new table or as a typed metadata record attached to `KnowledgeDraft` in the first implementation.

Each run stores:

- topic and user instruction,
- starting filters: list/channel, date range, tags, sender, patch-only flag,
- run status: `queued`, `running`, `needs_review`, `accepted`, `rejected`, `failed`, `cancelled`,
- budget limits: max iterations, max searches, max Ask calls, max inspected threads,
- timestamps and owner/requesting user,
- final confidence,
- final summary,
- failure reason if any.

### Iterative loop

The agent performs this loop:

1. Build a research plan from the topic.
2. Generate keyword and semantic queries.
3. Search mailing-list archive with `mode=semantic`, `hybrid`, or `keyword` as appropriate.
4. Score result relevance against the original topic.
5. Inspect relevant threads and source snippets.
6. Ask follow-up questions over evidence when search alone is insufficient.
7. Decide whether evidence is sufficient.
8. If insufficient and budget remains, refine queries and repeat.
9. Produce structured synthesis and draft objects.
10. Run self-review for uncertainty, contradiction, weak evidence, and duplicate risk.
11. Save draft bundle to Draft Inbox.

### Relevance judging

For each search result or source thread, store:

- relevance score: 0.0-1.0,
- evidence strength: `direct`, `supporting`, `context`, `weak`, `irrelevant`,
- reason for inclusion or exclusion,
- matched topic facets,
- whether the source appears accepted, rejected, superseded, unresolved, or speculative.

The agent should continue searching when:

- relevant hits are below threshold,
- all evidence is weak or speculative,
- the answer depends on timeline but no later thread is found,
- sources disagree and no resolution is found,
- duplicate/similar knowledge exists but cannot be reconciled.

### Draft output

Agent output should create a draft bundle containing:

- one or more `KnowledgeDraft` entries,
- proposed `KnowledgeEntity` records,
- proposed `KnowledgeEvidence` rows,
- proposed relations,
- proposed tags,
- optional annotations on threads/messages,
- self-review report,
- full search trace.

The draft must include enough evidence for a human reviewer to accept or reject without rerunning the full research.

## Data and API Changes

### Roles and capabilities

- Extend role normalization to include `agent`.
- Add capabilities:
  - `agent:research`
  - `agent:create_draft`
  - `agent:create_private_note`
  - `agent:suggest_merge`
- Keep existing `admin` and `editor` permissions unchanged.
- Update frontend user role type unions to include `agent`.

### Agent run APIs

Add admin/editor endpoints:

- `POST /api/agent/research-runs`
  - input: topic, optional filters, budget limits, auto_accept_policy.
  - output: run id and initial status.
- `GET /api/agent/research-runs`
  - list runs with status, topic, requester, confidence, timestamps.
- `GET /api/agent/research-runs/{run_id}`
  - full trace, draft ids, evidence ids, and status.
- `POST /api/agent/research-runs/{run_id}/cancel`
  - cancel queued/running run.
- `POST /api/agent/research-runs/{run_id}/retry`
  - retry failed run with same topic and filters.

### Draft integration

- Reuse existing Knowledge Draft Inbox as the primary review surface.
- Add agent metadata to draft payload:
  - `agent_run_id`,
  - `agent_user_id`,
  - `confidence`,
  - `search_trace`,
  - `self_review`,
  - `auto_accept_eligible`.
- Draft accept/reject APIs remain human-owned actions.
- Accepted objects retain original agent provenance in metadata.

### Audit and rollback

- Every agent-created draft, evidence row, relation suggestion, tag suggestion, and annotation must include agent provenance.
- Add filters in Knowledge Draft Inbox:
  - all,
  - human-created,
  - agent-created,
  - accepted agent output,
  - rejected agent output.
- Provide admin query paths to list all content created by a specific agent and time range.
- Do not implement destructive rollback in the first version; first version can list affected objects for manual review.

## Frontend Changes

### Agent Research page

Add a new workbench page: `Agent Research`.

Core UI:

- topic input,
- channel/list selector,
- date range,
- optional tags,
- max iteration/search/thread budget controls,
- run button,
- run status timeline,
- search trace viewer,
- relevance decisions,
- generated draft bundle link.

This page should feel like an operational research console, not a marketing assistant chat.

### Draft Inbox changes

- Show agent-created drafts with a clear badge: `AI Research Agent`.
- Display confidence and self-review summary before the reviewer opens details.
- Add a compact trace preview:
  - query count,
  - inspected threads,
  - accepted/rejected evidence count,
  - unresolved questions.
- Keep accept/reject/edit as explicit reviewer actions.

### Knowledge views

- On accepted knowledge, show provenance:
  - created by human,
  - generated by agent and accepted by reviewer,
  - auto-accepted by policy.
- In evidence sections, distinguish:
  - direct source evidence,
  - agent-selected supporting evidence,
  - generated synthesis.

## Auto-Accept Policy

Initial implementation must default to no auto-accept.

Later auto-accept can be enabled per run or per agent only if all conditions pass:

- confidence above configured threshold,
- at least configured number of relevant source threads,
- no unresolved contradiction detected,
- no duplicate active entity above similarity threshold,
- no "rejected", "superseded", or "unresolved" dominant evidence state,
- all proposed tags already exist or are mapped to approved tags,
- run stayed within configured scope.

If any condition fails, output remains `pending_review`.

## Safety and Failure Modes

- Agent runs must have hard budgets to prevent runaway search loops.
- All LLM calls must store model and prompt version.
- Agent must produce "insufficient evidence" rather than forcing a knowledge draft.
- Failed runs should retain partial trace for debugging.
- Agent-created content must not affect active Ask answers unless accepted or explicitly included as draft context.
- The system must prevent agents from approving their own publication requests.
- Human edits to agent drafts must be recorded as human review, not agent authorship.

## Implementation Phases

### Phase 1: Identity and permissions

- Add `agent` role to backend role normalization (`VALID_ROLES`, `_normalize_role()`, `_capabilities_for_role()`).
- Add agent-specific capabilities: `agent:research`, `agent:create_draft`, `agent:create_private_note`, `agent:suggest_merge`.
- Add bootstrap/config support for a system agent account (similar to `bootstrap_admin`). At startup, resolve or create the agent user and hold a `CurrentUser` reference for internal calls (no HTTP auth needed — see Design Decision #1).
- Ensure agent-created writes use the agent user id and display name.

### Phase 2: Agent run model and APIs

- Add `agent_research_runs` table (dedicated, NOT embedded in KnowledgeDraft — see Design Decision #2).
- Add `agent_run_actions` table for search traces, relevance decisions, and query refinements (see Design Decision #3).
- Store topic, status, budgets, filters, confidence, heartbeat timestamp, and draft ids on the run record.
- Add run recovery: on startup, mark `running` runs as `failed` with `failure_reason: server_restart` (see Design Decision #8).
- Add API endpoints: create, list, get, cancel, retry.
- Add cancellation and retry.
- Add lightweight tests for permissions and run lifecycle.

### Phase 3: Research loop

- Implement agent orchestration service (in-process, uses internal `CurrentUser` — see Design Decision #1).
- Before each search iteration, query `KnowledgeStore.search_entities()` to check existing knowledge and avoid re-discovering known facts (see Design Decision #4, PLAN-33000).
- Use existing Search semantics internally with `mode=semantic` first, then fallback to hybrid/keyword.
- Use existing AskAgent for follow-up synthesis (with knowledge graph context from PLAN-33000).
- Implement relevance judging and query refinement.
- Save trace and partial results after each iteration into `agent_run_actions`.

### Phase 4: Draft generation and review

- Generate KnowledgeDraft bundles with evidence, relations, tags, and self-review.
- Each draft references `agent_run_id` for traceability.
- Add Draft Inbox UI badges, confidence, trace preview, and agent filters (human-created / agent-created / accepted agent output / rejected agent output).
- Sort agent drafts by confidence descending by default (see Design Decision #7).
- Ensure accept/reject remains human-owned unless auto-accept is explicitly enabled.

### Phase 5: Agent Research UI

- Add Agent Research page and navigation entry.
- Show run status, trace, evidence decisions, generated drafts, and failure states.
- Use polling (`setInterval` every 2–3s) for run status updates, consistent with the Translation Job polling pattern in `ThreadDrawer.tsx` (see Design Decision #6).
- Add controls for budget and scope.

### Phase 6: Optional auto-accept

- Add configurable auto-accept policy.
- Start disabled by default.
- Add audit views for auto-accepted content.
- Add admin override to disable an agent and quarantine its future output.

## Test Plan

- Unit tests:
  - role normalization includes `agent`,
  - agent capabilities are correct,
  - agent cannot call admin-only approval paths,
  - agent can create drafts,
  - agent cannot publish active knowledge by default.
- Service tests:
  - research run status transitions,
  - budget limits stop loops,
  - insufficient evidence creates no active knowledge,
  - relevance decisions are stored,
  - failed runs keep trace.
- API tests:
  - create/list/get/cancel/retry research runs,
  - draft inbox filters agent-created drafts,
  - accept/reject records human reviewer.
- Frontend checks:
  - Agent Research page can start a run,
  - run trace renders,
  - draft inbox shows agent badges and confidence,
  - accepted knowledge shows agent provenance.

## Assumptions

- The agent uses existing Search, Ask, KnowledgeDraft, Evidence, Tag, and Annotation concepts wherever possible.
- First implementation does not require direct database writes outside service/repository APIs.
- Default policy is human review before active knowledge.
- The first concrete agent is named `Lobster Research Agent`, but the design supports multiple agents later.
- `mode=semantic` is available and should be the default retrieval path for agent topic research.

## Design Decisions (reviewed 2026-04-28)

### 1. Agent authentication — internal call, not HTTP

The agent orchestration service runs in the same process as the API server.
It should construct a `CurrentUser` object for the agent account and pass it
directly to existing service/store methods, bypassing HTTP auth entirely.

- The agent account is bootstrapped via config (similar to bootstrap_admin).
- At startup, resolve or create the agent user record, then hold a
  `CurrentUser` reference in memory for the orchestration service to use.
- No API key, no header auth, no new auth mechanism needed.

### 2. `agent_research_runs` must be a separate table

Do NOT embed run data as JSONB metadata on `KnowledgeDraft`. Reasons:

- One run can produce multiple drafts (1:N).
- Run lifecycle (queued → running → needs_review → accepted/rejected/failed)
  is independent of any single draft's review lifecycle.
- Search traces and relevance decisions are too large for draft payload.

A dedicated `agent_research_runs` table with a typed status column is the
right foundation. Drafts reference the run via `agent_run_id`.

### 3. `agent_run_actions` table for search traces

Each iteration of the research loop generates multiple actions
(search, ask, thread_inspect, relevance_judge, query_refine).
Store them in a normalized table rather than a single JSONB blob:

```
agent_run_id | action_index | action_type | payload (JSONB) | created_at
```

- `action_type` enum: search, ask, thread_inspect, relevance_judge, query_refine
- Ordered by `action_index` to reconstruct the full trace
- Allows querying specific action types without parsing a monolithic blob

### 4. Knowledge graph context (PLAN-33000)

The Agent Research Loop must query existing knowledge entities before
each search iteration, using the same `KnowledgeStore.search_entities()`
introduced in PLAN-33000. This prevents re-discovering already-known facts
and allows the agent to detect contradictions between new evidence and
existing knowledge.

### 5. `agent` role capabilities

The current `_capabilities_for_role()` returns `["read", "write"]` for
editor and `["read"]` for viewer. The agent role must NOT receive `write`
(because that bypasses draft review for direct knowledge-entity mutation).
Instead, return fine-grained agent capabilities:

```python
if role == "agent":
    return [
        "read",
        "agent:research",
        "agent:create_draft",
        "agent:create_private_note",
        "agent:suggest_merge",
    ]
```

All existing `_is_admin()` and `require_roles("admin")` guards remain intact.

### 6. Frontend real-time — polling, not WebSocket

The Agent Research page needs to show run status updates. Use polling
(`setInterval` every 2–3 seconds) consistent with the existing
Translation Job polling pattern in `ThreadDrawer.tsx`. Avoid introducing
WebSocket or SSE complexity in the first implementation.

### 7. Draft Inbox agent hygiene

Agent runs can produce many drafts. Mitigations:

- Sort agent drafts by confidence descending (high-confidence first for review).
- Add a filter by `agent_run_id` to scope review to one research topic.
- Rejected agent drafts older than 30 days may be auto-archived in a future
  cleanup job (not in Phase 1).

### 8. Run recovery after server restart

On startup, query for any `agent_research_runs` with status `running` and
mark them `failed` with `failure_reason: server_restart`. Each running
iteration should also update a heartbeat timestamp, so stuck runs can be
detected and failed by a watchdog.

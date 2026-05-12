# Knowledge Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the knowledge page into a document-reader layout with a clean main reading column, a right-side work rail, and on-demand support drawers for evidence, notes, history, relations, and timeline details.

**Architecture:** Keep the existing API/data state in `KnowledgeWorkbench`, but split layout responsibilities into focused React components and pure layout helpers. Preserve existing feature components by moving them into summarized inline sections or drawer surfaces instead of rewriting business logic.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, Vitest, lucide-react, existing browser validation flow.

---

## Scope Check

The spec is one cohesive frontend redesign of `/knowledge`. It touches several components, but they belong to one user-facing workflow and should be implemented as one plan.

## File Structure

- Create: `web/src/components/knowledge/knowledgeLayout.ts`
  - Pure helpers for support panel metadata, timeline summaries, relation summaries, and rail counts.
- Create: `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`
  - Vitest tests for layout helper behavior.
- Create: `web/src/components/knowledge/KnowledgeSupportDrawer.tsx`
  - Reusable drawer/sheet shell for evidence, notes, history, full relations, and full timeline.
- Create: `web/src/components/knowledge/KnowledgeRightRail.tsx`
  - Right-side rail containing search/entity switching, draft queue, entity metadata, and support panel triggers.
- Create: `web/src/components/knowledge/KnowledgeDocumentSections.tsx`
  - Main document body with summary, explanation editor, timeline summary, and relation summary.
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
  - Compose the new document-reader layout, wire drawer state, and remove the always-open left entity panel.
- Modify: `web/src/components/knowledge/EntityDetailHeader.tsx`
  - Make the header work in the document-reader context and expose rail/drawer actions.
- Modify: `web/src/components/knowledge/EntityExplanationEditor.tsx`
  - Support a calmer document-style variant without changing data behavior.
- Modify as needed: `web/src/components/knowledge/EntityListPanel.tsx`
  - Reuse list/search UI in compact rail mode or extract only the parts needed by `KnowledgeRightRail`.

---

### Task 1: Add Layout Helper Tests

**Files:**
- Create: `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`
- Create: `web/src/components/knowledge/knowledgeLayout.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/knowledge/__tests__/knowledgeLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSupportPanelItems,
  summarizeRelations,
  summarizeTimeline,
} from '../knowledgeLayout';

describe('knowledge layout helpers', () => {
  it('orders support panels by document-reader priority', () => {
    expect(
      buildSupportPanelItems({
        evidenceCount: 3,
        notesCount: 2,
        historyCount: 5,
        relationCount: 4,
        timelineCount: 1,
      }).map((item) => item.id),
    ).toEqual(['evidence', 'notes', 'history', 'relations', 'timeline']);
  });

  it('keeps support panel counts readable', () => {
    expect(
      buildSupportPanelItems({
        evidenceCount: 103,
        notesCount: 0,
        historyCount: 12,
        relationCount: 4,
        timelineCount: 8,
      })[0],
    ).toMatchObject({
      id: 'evidence',
      label: 'Evidence',
      countLabel: '99+',
    });
  });

  it('summarizes timeline by earliest dated events first and caps the list', () => {
    const events = [
      { id: 'late', event_type: 'commit' as const, title: 'Late', date: '2024-02-01' },
      { id: 'none', event_type: 'note' as const, title: 'No date', date: '' },
      { id: 'early', event_type: 'decision' as const, title: 'Early', date: '2024-01-01' },
      { id: 'middle', event_type: 'mail_thread' as const, title: 'Middle', date: '2024-01-15' },
    ];

    expect(summarizeTimeline(events, 2).map((event) => event.id)).toEqual(['early', 'middle']);
  });

  it('summarizes incoming and outgoing relations together', () => {
    const summary = summarizeRelations({
      outgoing: [
        {
          relation_id: 'r1',
          source_entity_id: 'a',
          target_entity_id: 'b',
          relation_type: 'explains',
          description: '',
          created_at: '',
          updated_at: '',
          target: { entity_id: 'b', entity_type: 'concept', canonical_name: 'B', aliases: [], summary: '', description: '', status: 'active', meta: {}, created_at: '', updated_at: '' },
        },
      ],
      incoming: [
        {
          relation_id: 'r2',
          source_entity_id: 'c',
          target_entity_id: 'a',
          relation_type: 'part_of',
          description: '',
          created_at: '',
          updated_at: '',
          source: { entity_id: 'c', entity_type: 'subsystem', canonical_name: 'C', aliases: [], summary: '', description: '', status: 'active', meta: {}, created_at: '', updated_at: '' },
        },
      ],
    });

    expect(summary.total).toBe(2);
    expect(summary.items.map((item) => item.name)).toEqual(['B', 'C']);
    expect(summary.items.map((item) => item.direction)).toEqual(['outgoing', 'incoming']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd web
npm test -- src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected: FAIL because `../knowledgeLayout` does not exist.

- [ ] **Step 3: Add the minimal helper implementation**

Create `web/src/components/knowledge/knowledgeLayout.ts`:

```ts
import type { KnowledgeRelation } from '../../api/types';
import type { KnowledgeTimelineEvent } from '../../utils/knowledgeMeta';
import { formatDate, relationLabel, relationEntityName } from './knowledgeUtils';

export type SupportPanelId = 'evidence' | 'notes' | 'history' | 'relations' | 'timeline';

export type SupportPanelCounts = {
  evidenceCount: number;
  notesCount: number;
  historyCount: number;
  relationCount: number;
  timelineCount: number;
};

export type SupportPanelItem = {
  id: SupportPanelId;
  label: string;
  description: string;
  count: number;
  countLabel: string;
};

function countLabel(count: number) {
  if (count > 99) return '99+';
  return String(count);
}

export function buildSupportPanelItems(counts: SupportPanelCounts): SupportPanelItem[] {
  return [
    {
      id: 'evidence',
      label: 'Evidence',
      description: 'Claims, sources, and verification material',
      count: counts.evidenceCount,
      countLabel: countLabel(counts.evidenceCount),
    },
    {
      id: 'notes',
      label: 'Notes',
      description: 'Human reviewer notes',
      count: counts.notesCount,
      countLabel: countLabel(counts.notesCount),
    },
    {
      id: 'history',
      label: 'History',
      description: 'Entity changes and audit trail',
      count: counts.historyCount,
      countLabel: countLabel(counts.historyCount),
    },
    {
      id: 'relations',
      label: 'Relations',
      description: 'Full graph and relation editing',
      count: counts.relationCount,
      countLabel: countLabel(counts.relationCount),
    },
    {
      id: 'timeline',
      label: 'Timeline',
      description: 'Full timeline editing',
      count: counts.timelineCount,
      countLabel: countLabel(counts.timelineCount),
    },
  ];
}

export function summarizeTimeline(timeline: KnowledgeTimelineEvent[], limit = 3) {
  return [...timeline]
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    })
    .slice(0, limit)
    .map((event) => ({
      ...event,
      displayDate: event.date ? formatDate(event.date) : 'No date',
    }));
}

export type RelationSummaryItem = {
  relationId: string;
  relationType: string;
  label: string;
  name: string;
  direction: 'outgoing' | 'incoming';
};

export function summarizeRelations(relations: {
  outgoing: KnowledgeRelation[];
  incoming: KnowledgeRelation[];
}, limit = 4) {
  const outgoing = relations.outgoing.map<RelationSummaryItem>((relation) => ({
    relationId: relation.relation_id,
    relationType: relation.relation_type,
    label: relationLabel(relation.relation_type),
    name: relationEntityName(relation.target, relation.target_entity_id),
    direction: 'outgoing',
  }));
  const incoming = relations.incoming.map<RelationSummaryItem>((relation) => ({
    relationId: relation.relation_id,
    relationType: relation.relation_type,
    label: relationLabel(relation.relation_type),
    name: relationEntityName(relation.source, relation.source_entity_id),
    direction: 'incoming',
  }));

  const items = [...outgoing, ...incoming];
  return {
    total: items.length,
    items: items.slice(0, limit),
    remaining: Math.max(0, items.length - limit),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd web
npm test -- src/components/knowledge/__tests__/knowledgeLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/knowledge/knowledgeLayout.ts web/src/components/knowledge/__tests__/knowledgeLayout.test.ts
git commit -m "test: add knowledge layout helpers"
```

---

### Task 2: Add Support Drawer Shell

**Files:**
- Create: `web/src/components/knowledge/KnowledgeSupportDrawer.tsx`

- [ ] **Step 1: Write the failing type/build check expectation**

There is no React Testing Library in this repo, so use TypeScript/build as the first check for this UI shell.

Run:

```bash
cd web
npm run build
```

Expected before implementation: PASS. This establishes a clean baseline before adding the drawer.

- [ ] **Step 2: Create the drawer component**

Create `web/src/components/knowledge/KnowledgeSupportDrawer.tsx`:

```tsx
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SupportPanelId } from './knowledgeLayout';

const drawerTitles: Record<SupportPanelId, string> = {
  evidence: 'Evidence',
  notes: 'Notes',
  history: 'History',
  relations: 'Relations',
  timeline: 'Timeline',
};

interface KnowledgeSupportDrawerProps {
  panel: SupportPanelId | null;
  children: ReactNode;
  onClose: () => void;
}

export default function KnowledgeSupportDrawer({
  panel,
  children,
  onClose,
}: KnowledgeSupportDrawerProps) {
  if (!panel) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close support panel"
        className="absolute inset-0 bg-slate-950/30"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-support-drawer-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/20 md:w-[min(760px,72vw)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="knowledge-support-drawer-title" className="text-base font-semibold text-slate-950">
              {drawerTitles[panel]}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Supporting context stays separate from the main document.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close support panel"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify the shell compiles**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/knowledge/KnowledgeSupportDrawer.tsx
git commit -m "feat: add knowledge support drawer"
```

---

### Task 3: Add Right Rail Component

**Files:**
- Create: `web/src/components/knowledge/KnowledgeRightRail.tsx`

- [ ] **Step 1: Create the rail component**

Create `web/src/components/knowledge/KnowledgeRightRail.tsx`:

```tsx
import { Clock3, FileClock, GitBranch, MessageSquareText, Search, ShieldCheck } from 'lucide-react';
import type { KnowledgeDraft, KnowledgeEntity, KnowledgeStats } from '../../api/types';
import { PrimaryButton, SecondaryButton } from '../ui';
import {
  ENTITY_TYPES,
  evidenceCount,
  formatDate,
  readableType,
  statusTone,
} from './knowledgeUtils';
import type { NewEntityForm } from './EntityListPanel';
import type { SupportPanelId, SupportPanelItem } from './knowledgeLayout';

interface KnowledgeRightRailProps {
  entities: KnowledgeEntity[];
  selectedEntity: KnowledgeEntity | null;
  selectedEntityId: string;
  stats: KnowledgeStats | null;
  query: string;
  searchMode: 'simple' | 'fulltext';
  loading: boolean;
  total: number;
  canWrite: boolean;
  showCreate: boolean;
  newEntity: NewEntityForm;
  saving: boolean;
  drafts: KnowledgeDraft[];
  draftLoading: boolean;
  supportItems: SupportPanelItem[];
  onQueryChange: (value: string) => void;
  onSearchModeChange: (mode: 'simple' | 'fulltext') => void;
  onSearch: () => void;
  onSelectEntity: (entityId: string) => void;
  onLoadMore: () => void;
  onToggleCreate: () => void;
  onNewEntityChange: (value: NewEntityForm) => void;
  onCreateEntity: () => void;
  onOpenSupportPanel: (panel: SupportPanelId) => void;
  onOpenDraftQueue: () => void;
}

export default function KnowledgeRightRail({
  entities,
  selectedEntity,
  selectedEntityId,
  stats,
  query,
  searchMode,
  loading,
  total,
  canWrite,
  showCreate,
  newEntity,
  saving,
  drafts,
  draftLoading,
  supportItems,
  onQueryChange,
  onSearchModeChange,
  onSearch,
  onSelectEntity,
  onLoadMore,
  onToggleCreate,
  onNewEntityChange,
  onCreateEntity,
  onOpenSupportPanel,
  onOpenDraftQueue,
}: KnowledgeRightRailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white xl:w-[340px]">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onSearch()}
            placeholder="Find knowledge..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus-visible:ring-2 focus-visible:ring-slate-200"
          />
          <PrimaryButton type="button" onClick={onSearch} className="px-3">
            Search
          </PrimaryButton>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={() => onSearchModeChange('simple')}
            className={`rounded-full border px-2 py-0.5 transition ${
              searchMode !== 'fulltext'
                ? 'border-slate-400 bg-slate-100 text-slate-800'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => onSearchModeChange('fulltext')}
            className={`rounded-full border px-2 py-0.5 transition ${
              searchMode === 'fulltext'
                ? 'border-sky-400 bg-sky-50 text-sky-700'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Full-text
          </button>
          <span className="ml-auto text-[10px] text-slate-400">
            {entities.length} / {total}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase text-slate-500">Entities</h2>
            {stats && (
              <span className="text-[11px] text-slate-400">{stats.total_entities} total</span>
            )}
          </div>
          <div className="space-y-2">
            {loading && <div className="text-sm text-slate-500">Loading knowledge...</div>}
            {!loading &&
              entities.map((entity) => {
                const selected = selectedEntityId === entity.entity_id;
                const count = evidenceCount(entity);
                return (
                  <button
                    key={entity.entity_id}
                    type="button"
                    onClick={() => onSelectEntity(entity.entity_id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      selected
                        ? 'border-slate-900 bg-slate-950 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="truncate text-sm font-semibold">{entity.canonical_name}</div>
                    <div className={`mt-1 line-clamp-2 text-xs leading-5 ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {entity.summary || 'No summary yet'}
                    </div>
                    <div className={`mt-2 flex items-center justify-between text-[11px] ${selected ? 'text-slate-400' : 'text-slate-400'}`}>
                      <span>{readableType(entity.entity_type)}</span>
                      <span>{count ? `${count} evidence` : formatDate(entity.updated_at)}</span>
                    </div>
                  </button>
                );
              })}
          </div>
          {entities.length < total && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Load more
            </button>
          )}
        </section>

        {canWrite && (
          <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            <button
              type="button"
              onClick={onToggleCreate}
              className="w-full text-left text-sm font-semibold text-slate-800"
            >
              {showCreate ? 'Hide quick capture' : 'Capture a new topic'}
            </button>
            {showCreate && (
              <div className="mt-3 space-y-2">
                <input
                  value={newEntity.canonical_name}
                  onChange={(event) =>
                    onNewEntityChange({ ...newEntity, canonical_name: event.target.value })
                  }
                  placeholder="Name"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <select
                  value={newEntity.entity_type}
                  onChange={(event) => onNewEntityChange({ ...newEntity, entity_type: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ENTITY_TYPES.map((type) => (
                    <option key={type} value={type}>{readableType(type)}</option>
                  ))}
                </select>
                <textarea
                  value={newEntity.summary}
                  onChange={(event) => onNewEntityChange({ ...newEntity, summary: event.target.value })}
                  placeholder="Short answer"
                  className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <PrimaryButton
                  type="button"
                  onClick={onCreateEntity}
                  disabled={saving || !newEntity.canonical_name.trim()}
                  className="w-full"
                >
                  Create draft
                </PrimaryButton>
              </div>
            )}
          </section>
        )}

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Draft queue</h2>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                {draftLoading ? 'Loading drafts...' : `${drafts.length} item${drafts.length === 1 ? '' : 's'} awaiting review`}
              </p>
            </div>
            <FileClock className="h-4 w-4 text-amber-700" />
          </div>
          <SecondaryButton type="button" onClick={onOpenDraftQueue} className="mt-3 w-full border-amber-300 bg-white text-amber-800 hover:bg-amber-100">
            Review queue
          </SecondaryButton>
        </section>

        {selectedEntity && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-950">Entity meta</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(selectedEntity.status)}`}>
                {selectedEntity.status}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{readableType(selectedEntity.entity_type)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5" />
                <span>Updated {formatDate(selectedEntity.updated_at)}</span>
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Support panels</h2>
          <div className="grid gap-2">
            {supportItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenSupportPanel(item.id)}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="block truncate text-xs text-slate-500">{item.description}</span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {item.countLabel}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Remove unused imported icons**

If TypeScript reports unused imports, keep only the icons actually rendered. The expected final import line is:

```tsx
import { Clock3, FileClock, Search, ShieldCheck } from 'lucide-react';
```

- [ ] **Step 3: Build to verify the rail compiles**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/knowledge/KnowledgeRightRail.tsx
git commit -m "feat: add knowledge right rail"
```

---

### Task 4: Add Main Document Sections

**Files:**
- Create: `web/src/components/knowledge/KnowledgeDocumentSections.tsx`
- Modify: `web/src/components/knowledge/EntityExplanationEditor.tsx`

- [ ] **Step 1: Add a document variant to the explanation editor**

Modify `web/src/components/knowledge/EntityExplanationEditor.tsx`:

```tsx
interface EntityExplanationEditorProps {
  selectedEntity: KnowledgeEntity;
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onUpdateSummary: (value: string) => void;
  onUpdateDescription: (value: string) => void;
  variant?: 'panel' | 'document';
}
```

Update the function signature:

```tsx
export default function EntityExplanationEditor({
  selectedEntity,
  canWrite,
  saving,
  onSave,
  onUpdateSummary,
  onUpdateDescription,
  variant = 'panel',
}: EntityExplanationEditorProps) {
```

Add this early return before the existing `return`:

```tsx
  if (variant === 'document') {
    return (
      <section className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Summary</h2>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                The reusable short answer for future Ask responses.
              </p>
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={!canWrite || saving}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <textarea
            value={selectedEntity.summary}
            onChange={(event) => onUpdateSummary(event.target.value)}
            placeholder="A reusable one-paragraph explanation."
            className="mt-4 min-h-[132px] w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-900 outline-none transition focus:border-slate-500 focus:bg-white focus-visible:ring-2 focus-visible:ring-slate-200"
            disabled={!canWrite}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Explanation</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              Background, tradeoffs, timelines, and caveats that should survive one Ask session.
            </p>
          </div>
          <textarea
            value={selectedEntity.description}
            onChange={(event) => onUpdateDescription(event.target.value)}
            placeholder="Add background, tradeoffs, timelines, and caveats."
            className="mt-4 min-h-[360px] w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-base leading-7 text-slate-900 outline-none transition focus:border-slate-500 focus:bg-white focus-visible:ring-2 focus-visible:ring-slate-200"
            disabled={!canWrite}
          />
        </div>
      </section>
    );
  }
```

- [ ] **Step 2: Create document sections component**

Create `web/src/components/knowledge/KnowledgeDocumentSections.tsx`:

```tsx
import { ArrowRight, Clock3, GitBranch } from 'lucide-react';
import type { KnowledgeEntity, KnowledgeRelation } from '../../api/types';
import type { KnowledgeEntityMetaSchema } from '../../utils/knowledgeMeta';
import type { SupportPanelId } from './knowledgeLayout';
import { summarizeRelations, summarizeTimeline } from './knowledgeLayout';
import EntityExplanationEditor from './EntityExplanationEditor';

interface KnowledgeDocumentSectionsProps {
  selectedEntity: KnowledgeEntity;
  selectedMetaSchema: KnowledgeEntityMetaSchema;
  relations: {
    outgoing: KnowledgeRelation[];
    incoming: KnowledgeRelation[];
  };
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onOpenSupportPanel: (panel: SupportPanelId) => void;
  onUpdateSummary: (value: string) => void;
  onUpdateDescription: (value: string) => void;
}

export default function KnowledgeDocumentSections({
  selectedEntity,
  selectedMetaSchema,
  relations,
  canWrite,
  saving,
  onSave,
  onOpenSupportPanel,
  onUpdateSummary,
  onUpdateDescription,
}: KnowledgeDocumentSectionsProps) {
  const timelineSummary = summarizeTimeline(selectedMetaSchema.timeline, 3);
  const relationSummary = summarizeRelations(relations, 4);

  return (
    <div className="space-y-5">
      <EntityExplanationEditor
        selectedEntity={selectedEntity}
        canWrite={canWrite}
        saving={saving}
        onSave={onSave}
        onUpdateSummary={onUpdateSummary}
        onUpdateDescription={onUpdateDescription}
        variant="document"
      />

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Clock3 className="h-4 w-4 text-slate-400" />
                Timeline
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Key moments without opening the full editor.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSupportPanel('timeline')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Open <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {timelineSummary.length > 0 ? timelineSummary.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                  <span>{event.displayDate}</span>
                  <span>{event.event_type.replace(/_/g, ' ')}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">{event.title || 'Untitled event'}</div>
                {event.summary && <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{event.summary}</div>}
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                No timeline events yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <GitBranch className="h-4 w-4 text-slate-400" />
                Relations
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Closest connected knowledge items.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSupportPanel('relations')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Open <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {relationSummary.items.length > 0 ? relationSummary.items.map((item) => (
              <div key={item.relationId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{item.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{item.direction} · {item.label}</div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                No relations yet.
              </div>
            )}
            {relationSummary.remaining > 0 && (
              <div className="text-xs text-slate-500">{relationSummary.remaining} more in the full relations panel.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify document sections compile**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/knowledge/EntityExplanationEditor.tsx web/src/components/knowledge/KnowledgeDocumentSections.tsx
git commit -m "feat: add knowledge document sections"
```

---

### Task 5: Recompose KnowledgeWorkbench

**Files:**
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Modify as needed: `web/src/components/knowledge/EntityDetailHeader.tsx`

- [ ] **Step 1: Add new imports and drawer state**

In `web/src/components/knowledge/KnowledgeWorkbench.tsx`, remove imports that become unused after recomposition, then add:

```tsx
import KnowledgeDocumentSections from './KnowledgeDocumentSections';
import KnowledgeRightRail from './KnowledgeRightRail';
import KnowledgeSupportDrawer from './KnowledgeSupportDrawer';
import {
  buildSupportPanelItems,
  type SupportPanelId,
} from './knowledgeLayout';
```

Add state near the other UI state:

```tsx
  const [activeSupportPanel, setActiveSupportPanel] = useState<SupportPanelId | null>(null);
  const [railOpen, setRailOpen] = useState(false);
```

- [ ] **Step 2: Add support item computation**

Add after `relationCount`:

```tsx
  const supportItems = useMemo(
    () =>
      buildSupportPanelItems({
        evidenceCount: selectedEvidenceCount,
        notesCount: annotations.length,
        historyCount: selectedEntity ? 1 : 0,
        relationCount,
        timelineCount,
      }),
    [annotations.length, relationCount, selectedEntity, selectedEvidenceCount, timelineCount],
  );
```

- [ ] **Step 3: Replace the selected-entity layout**

Replace the selected entity branch with this structure:

```tsx
          <div className="flex min-h-screen bg-slate-50">
            <main className="min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 md:px-6 lg:px-8">
                <StickyContextBar
                  title={selectedEntity.canonical_name}
                  subtitle={`${readableType(selectedEntity.entity_type)} · ${selectedEvidenceCount} evidence · ${timelineCount} timeline events · ${relationCount} relations`}
                  meta={
                    <>
                      <StatusBadge
                        tone={
                          selectedEntity.status === 'active'
                            ? 'success'
                            : selectedEntity.status === 'deprecated'
                            ? 'warning'
                            : 'muted'
                        }
                      >
                        {selectedEntity.status}
                      </StatusBadge>
                      {saving && <StatusBadge tone="info">Saving</StatusBadge>}
                    </>
                  }
                  actions={
                    <>
                      <SecondaryButton type="button" onClick={() => setRailOpen(true)} className="xl:hidden">
                        Work rail
                      </SecondaryButton>
                      <SecondaryButton type="button" onClick={() => setActiveSupportPanel('evidence')}>
                        Evidence
                      </SecondaryButton>
                      {canWrite && (
                        <PrimaryButton type="button" onClick={handleSaveEntity} disabled={saving}>
                          Save
                        </PrimaryButton>
                      )}
                    </>
                  }
                />

                <EntityDetailHeader
                  selectedEntity={selectedEntity}
                  selectedAliases={selectedAliases}
                  canWrite={canWrite}
                  saving={saving}
                  relationTargets={relationTargets}
                  mergeTargetId={mergeTargetId}
                  onMergeTargetChange={setMergeTargetId}
                  onMerge={handleMergeEntity}
                  onShowDelete={() => setShowDeleteConfirm(true)}
                  onUpdateName={(value) =>
                    setSelectedEntity((prev) => (prev ? { ...prev, canonical_name: value } : prev))
                  }
                  onUpdateAliases={(value) =>
                    setSelectedEntity((prev) =>
                      prev
                        ? {
                            ...prev,
                            aliases: value
                              .split(',')
                              .map((item) => item.trim())
                              .filter(Boolean),
                          }
                        : prev,
                    )
                  }
                />

                {showDeleteConfirm && (
                  <DeleteConfirmModal
                    entityName={selectedEntity.canonical_name}
                    relationCount={relationCount}
                    saving={saving}
                    onCancel={() => setShowDeleteConfirm(false)}
                    onDelete={handleDeleteEntity}
                  />
                )}

                <KnowledgeDocumentSections
                  selectedEntity={selectedEntity}
                  selectedMetaSchema={selectedMetaSchema}
                  relations={relations}
                  canWrite={canWrite}
                  saving={saving}
                  onSave={handleSaveEntity}
                  onOpenSupportPanel={setActiveSupportPanel}
                  onUpdateSummary={(value) =>
                    setSelectedEntity((prev) => (prev ? { ...prev, summary: value } : prev))
                  }
                  onUpdateDescription={(value) =>
                    setSelectedEntity((prev) => (prev ? { ...prev, description: value } : prev))
                  }
                />
              </div>
            </main>

            <div className="hidden xl:block">
              <KnowledgeRightRail
                entities={entities}
                selectedEntity={selectedEntity}
                selectedEntityId={selectedEntityId}
                stats={stats}
                query={query}
                searchMode={entitySearchMode}
                loading={loading}
                total={entityTotal}
                canWrite={canWrite}
                showCreate={showCreate}
                newEntity={newEntity}
                saving={saving}
                drafts={drafts}
                draftLoading={draftLoading}
                supportItems={supportItems}
                onQueryChange={setQuery}
                onSearchModeChange={(mode) => {
                  setEntitySearchMode(mode);
                  setEntityPage(1);
                  setTimeout(() => loadEntities(), 0);
                }}
                onSearch={() => loadEntities()}
                onSelectEntity={handleSelectEntity}
                onLoadMore={loadMoreEntities}
                onToggleCreate={() => setShowCreate((value) => !value)}
                onNewEntityChange={setNewEntity}
                onCreateEntity={handleCreateEntity}
                onOpenSupportPanel={setActiveSupportPanel}
                onOpenDraftQueue={() => setActiveSupportPanel('notes')}
              />
            </div>
          </div>
```

- [ ] **Step 4: Add mobile rail drawer and support drawer**

Add after the selected-entity layout:

```tsx
            {railOpen && (
              <div className="fixed inset-0 z-40 xl:hidden">
                <button
                  type="button"
                  aria-label="Close work rail"
                  className="absolute inset-0 bg-slate-950/30"
                  onClick={() => setRailOpen(false)}
                />
                <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl">
                  <KnowledgeRightRail
                    entities={entities}
                    selectedEntity={selectedEntity}
                    selectedEntityId={selectedEntityId}
                    stats={stats}
                    query={query}
                    searchMode={entitySearchMode}
                    loading={loading}
                    total={entityTotal}
                    canWrite={canWrite}
                    showCreate={showCreate}
                    newEntity={newEntity}
                    saving={saving}
                    drafts={drafts}
                    draftLoading={draftLoading}
                    supportItems={supportItems}
                    onQueryChange={setQuery}
                    onSearchModeChange={(mode) => {
                      setEntitySearchMode(mode);
                      setEntityPage(1);
                      setTimeout(() => loadEntities(), 0);
                    }}
                    onSearch={() => loadEntities()}
                    onSelectEntity={(entityId) => {
                      setRailOpen(false);
                      handleSelectEntity(entityId);
                    }}
                    onLoadMore={loadMoreEntities}
                    onToggleCreate={() => setShowCreate((value) => !value)}
                    onNewEntityChange={setNewEntity}
                    onCreateEntity={handleCreateEntity}
                    onOpenSupportPanel={(panel) => {
                      setRailOpen(false);
                      setActiveSupportPanel(panel);
                    }}
                    onOpenDraftQueue={() => {
                      setRailOpen(false);
                      setActiveSupportPanel('notes');
                    }}
                  />
                </div>
              </div>
            )}
```

Add support drawer content near the bottom of the component:

```tsx
      <KnowledgeSupportDrawer
        panel={activeSupportPanel}
        onClose={() => setActiveSupportPanel(null)}
      >
        {activeSupportPanel === 'evidence' && (
          <EvidencePanel
            selectedEntity={selectedEntity}
            evidence={evidence}
            evidenceRows={evidenceRows}
            directEvidenceCount={directEvidenceCount}
            generatedEvidenceCount={generatedEvidenceCount}
            lastEvidenceAt={lastEvidenceAt}
            canWrite={canWrite}
            saving={saving}
            onOpenThread={handleOpenThread}
            onCreateEvidence={handleCreateEvidence}
          />
        )}
        {activeSupportPanel === 'notes' && (
          <HumanNotesPanel
            annotations={annotations}
            annotationLoading={annotationLoading}
            annotationBody={annotationBody}
            canWrite={canWrite}
            saving={saving}
            onAnnotationBodyChange={setAnnotationBody}
            onCreateAnnotation={handleCreateAnnotation}
          />
        )}
        {activeSupportPanel === 'history' && <EntityHistoryPanel entityId={selectedEntityId} />}
        {activeSupportPanel === 'relations' && (
          <EntityRelationsPanel
            selectedEntity={selectedEntity}
            relations={relations}
            relationLoading={relationLoading}
            relationCount={relationCount}
            relationTargets={relationTargets}
            relationDrafts={relationDrafts}
            relationForm={relationForm}
            viewMode={viewMode}
            graphDepth={graphDepth}
            graphData={graphData}
            graphLoading={graphLoading}
            canWrite={canWrite}
            saving={saving}
            onSetViewMode={setViewMode}
            onSetGraphDepth={setGraphDepth}
            onSelectEntity={handleSelectEntity}
            onRelationFormChange={setRelationForm}
            onCreateRelation={handleCreateRelation}
            onRelationDraftChange={(relationId, value) =>
              setRelationDrafts((prev) => ({ ...prev, [relationId]: value }))
            }
            onSaveRelationDescription={handleSaveRelationDescription}
            onDeleteRelation={handleDeleteRelation}
          />
        )}
        {activeSupportPanel === 'timeline' && (
          <KnowledgeTimelinePanel
            timeline={selectedMetaSchema.timeline}
            canWrite={canWrite}
            evidenceRows={evidenceRows}
            evidenceSources={evidence.sources}
            threadIds={evidence.threadIds}
            onOpenThread={handleOpenThread}
            onChange={(timeline) =>
              setSelectedEntity((prev) =>
                prev
                  ? {
                      ...prev,
                      meta: mergeKnowledgeMeta(prev.meta, {
                        ...extractKnowledgeMeta(prev.meta),
                        timeline,
                      }),
                    }
                  : prev,
              )
            }
          />
        )}
      </KnowledgeSupportDrawer>
```

- [ ] **Step 5: Remove old inline sections**

Remove the old inline rendering of:

- `EntityMetricsCards`
- sticky section link bar
- inline `DraftInboxPanel`
- inline `KnowledgeTimelinePanel`
- inline `EntityRelationsPanel`
- inline `EvidencePanel`
- inline `HumanNotesPanel`
- inline `EntityHistoryPanel`
- `KnowledgeInspectorDock`

Keep imports only for components still used in the drawer or new layout.

- [ ] **Step 6: Build and fix TypeScript errors**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

Common expected fixes:

- remove unused imports from `KnowledgeWorkbench.tsx`
- ensure `selectedEntity` is non-null before passing drawer child props
- remove unused `sectionLinks`
- remove unused `activeDraftCounts` if draft review is not inline

- [ ] **Step 7: Commit**

```bash
git add web/src/components/knowledge/KnowledgeWorkbench.tsx web/src/components/knowledge/EntityDetailHeader.tsx
git commit -m "feat: recompose knowledge workbench layout"
```

---

### Task 6: Restore Draft Review as a Task Surface

**Files:**
- Modify: `web/src/components/knowledge/KnowledgeWorkbench.tsx`
- Modify: `web/src/components/knowledge/KnowledgeRightRail.tsx` if needed

- [ ] **Step 1: Add a draft review surface state**

In `KnowledgeWorkbench.tsx`, add:

```tsx
  const [draftReviewOpen, setDraftReviewOpen] = useState(false);
```

- [ ] **Step 2: Wire the rail queue action to draft review**

Change every `onOpenDraftQueue` passed to `KnowledgeRightRail` to:

```tsx
onOpenDraftQueue={() => setDraftReviewOpen(true)}
```

For mobile rail:

```tsx
onOpenDraftQueue={() => {
  setRailOpen(false);
  setDraftReviewOpen(true);
}}
```

- [ ] **Step 3: Add the full-width draft review sheet**

Add near the other overlays in `KnowledgeWorkbench.tsx`:

```tsx
      {draftReviewOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close draft review"
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => {
              setDraftReviewOpen(false);
              setActiveDraft(null);
              setActiveDraftPayload(null);
            }}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-draft-review-title"
            className="absolute inset-x-3 bottom-3 top-6 flex flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-2xl md:inset-x-8 xl:inset-x-20"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-4">
              <div>
                <h2 id="knowledge-draft-review-title" className="text-base font-semibold text-amber-950">
                  Draft review
                </h2>
                <p className="mt-1 text-sm leading-5 text-amber-700">
                  Review agent drafts without crowding the knowledge document.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDraftReviewOpen(false);
                  setActiveDraft(null);
                  setActiveDraftPayload(null);
                }}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {activeDraft && activeDraftPayload ? (
                <DraftReviewPanel
                  draft={activeDraftPayload}
                  onChange={setActiveDraftPayload}
                  onSave={handleAcceptDraft}
                  saving={draftSaving}
                  saved={draftSaved}
                  error={draftError}
                  compact
                />
              ) : (
                <DraftInboxPanel
                  drafts={drafts}
                  draftLoading={draftLoading}
                  draftFilter={draftFilter}
                  draftError={draftError}
                  draftSaving={draftSaving}
                  onRefresh={loadDrafts}
                  onFilterChange={setDraftFilter}
                  onOpenDraft={handleOpenDraft}
                  onRejectDraft={handleRejectDraft}
                  className="border border-amber-200"
                />
              )}
            </div>
          </section>
        </div>
      )}
```

- [ ] **Step 4: Build to verify draft review compiles**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/knowledge/KnowledgeWorkbench.tsx
git commit -m "feat: move draft review into task surface"
```

---

### Task 7: Final Verification

**Files:**
- No source files expected unless QA finds issues.

- [ ] **Step 1: Run unit tests**

Run:

```bash
cd web
npm test
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
cd web
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
cd web
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start the dev server**

Run:

```bash
cd web
npm run dev -- --host 127.0.0.1
```

Expected: Vite serves the app locally. Use the printed port.

- [ ] **Step 5: Browser QA**

Use the Browser plugin to test:

- Load `/app/knowledge`.
- Confirm page identity is the knowledge workbench.
- Confirm the selected entity renders as a document-reader layout.
- Confirm the right rail is visible on desktop.
- Confirm clicking `Evidence` opens the support drawer and the drawer can close.
- Confirm clicking `Review queue` opens the draft review sheet and the sheet can close.
- Confirm mobile/narrow viewport exposes the `Work rail` action and does not horizontally overflow.
- Confirm console has no relevant errors.

- [ ] **Step 6: Fix any visual or interaction issues found**

If QA finds clipped content, hidden actions, console errors, broken drawer open/close, or mobile overflow, fix them before finishing.

- [ ] **Step 7: Final commit if QA fixes were needed**

```bash
git add web/src/components/knowledge
git commit -m "fix: polish knowledge document reader layout"
```

---

## Self-Review

Spec coverage:

- Main document column: Task 4 and Task 5.
- Right rail: Task 3 and Task 5.
- Support drawers: Task 2 and Task 5.
- Draft review task surface: Task 6.
- Mobile rail fallback: Task 5 and Task 7.
- Accessibility and focus-visible basics: Task 2, Task 3, and Task 7.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps remain.

Type consistency:

- `SupportPanelId` is defined in Task 1 and used consistently by drawer, rail, document sections, and workbench.
- `KnowledgeRightRail` prop names match the planned `KnowledgeWorkbench` wiring.
- Existing data handlers are reused rather than replaced.

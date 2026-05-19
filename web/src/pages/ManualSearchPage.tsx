import { useEffect, useMemo, useState } from 'react';
import { FileText, MessageSquarePlus, Search } from 'lucide-react';
import { createAnnotation, listAnnotations, searchManuals } from '../api/client';
import type { Annotation, AnnotationListItem, ManualSearchResponse, ManualSearchHit } from '../api/types';
import { EmptyState, PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';
import { showToast } from '../components/Toast';

const DOCUMENT_ANNOTATION_PAGE_SIZE = 100;

type ManualChunkAnnotation = Annotation | AnnotationListItem;

function normalizeParagraphText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitDocumentParagraphs(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const byBlankLines = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byBlankLines.length > 1) return byBlankLines;

  return normalized
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildTargetSubtitle(hit: ManualSearchHit): string {
  return hit.target_subtitle || [
    hit.manual_type,
    hit.manual_version,
    hit.volume,
    `pages ${hit.page_start}-${hit.page_end}`,
  ].filter(Boolean).join(' | ');
}

function getParagraphIndex(annotation: ManualChunkAnnotation): number {
  const raw = annotation.anchor?.paragraph_index;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : -1;
  }
  return -1;
}

function getParagraphQuote(annotation: ManualChunkAnnotation): string {
  const raw = annotation.anchor?.selected_text;
  return typeof raw === 'string' ? raw : '';
}

function buildShortLabel(hit: ManualSearchHit, paragraph: string): string {
  const prefix = hit.section_title || hit.section || 'Document note';
  const quote = normalizeParagraphText(paragraph).slice(0, 72);
  return `${prefix}: ${quote}`.slice(0, 256);
}

export default function ManualSearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ManualSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null);

  const [manualType, setManualType] = useState('');
  const [contentType, setContentType] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setExpandedChunkId(null);
    try {
      const data = await searchManuals(query, {
        manual_type: manualType || undefined,
        content_type: contentType || undefined,
        page: 1,
        page_size: 20,
      });
      setResult(data);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Search failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Manuals"
        title="Search Chip Manuals"
        description="Full-text search across processor manuals such as Intel SDM, ARM ARM, and AMD APM."
      />

      <SectionPanel title="Find manual sections">
        <div className="mb-4 flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search manuals... e.g. MOV instruction encoding"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pl-11 text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            />
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-600" />
          </div>
          <PrimaryButton onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </PrimaryButton>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Manual Type</label>
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Manuals</option>
              <option value="intel_sdm">Intel SDM</option>
              <option value="arm_arm">ARM ARM</option>
              <option value="amd_apm">AMD APM</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Content Type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Types</option>
              <option value="text">Text</option>
              <option value="instruction">Instruction</option>
              <option value="register">Register</option>
              <option value="table">Table</option>
              <option value="pseudocode">Pseudocode</option>
            </select>
          </div>
        </div>
      </SectionPanel>

      {result && (
        <SectionPanel
          title="Manual evidence"
          description="Review larger snippets and annotate paragraph-level passages from extracted document text."
        >
          <p className="mb-4 text-sm text-gray-500">
            Found <span className="font-semibold text-gray-900">{result.total}</span> results{' '}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{result.mode}</span>
          </p>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <ManualResultCard
                key={hit.chunk_id}
                hit={hit}
                expanded={expandedChunkId === hit.chunk_id}
                onToggle={() => setExpandedChunkId((current) => (current === hit.chunk_id ? null : hit.chunk_id))}
              />
            ))}
          </div>
        </SectionPanel>
      )}

      {!result && !loading && (
        <EmptyState
          title="Search manuals"
          description="Enter an instruction, register, or architecture concept to find relevant manual sections."
        />
      )}
    </PageShell>
  );
}

function ManualResultCard({
  hit,
  expanded,
  onToggle,
}: {
  hit: ManualSearchHit;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
              {hit.manual_type}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
              {hit.content_type}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">
            {hit.section_title || hit.section}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{hit.volume}</span>
            {hit.manual_version && <span className="rounded bg-gray-50 px-1.5 py-0.5">{hit.manual_version}</span>}
            {hit.chapter && <span className="rounded bg-gray-50 px-1.5 py-0.5">Chapter {hit.chapter}</span>}
            <span className="rounded bg-gray-50 px-1.5 py-0.5">Section {hit.section}</span>
            <span className="rounded bg-gray-50 px-1.5 py-0.5">Pages {hit.page_start}-{hit.page_end}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600">
            {hit.score.toFixed(3)}
          </span>
        </div>
      </div>
      {hit.snippet && (
        <p className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-700">
          {hit.snippet}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-500">
          Paragraph annotations are anchored to extracted document text for this search result.
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {expanded ? 'Hide annotations' : 'Annotate passage'}
        </button>
      </div>
      {expanded && <DocumentAnnotationWorkspace hit={hit} />}
    </div>
  );
}

function DocumentAnnotationWorkspace({ hit }: { hit: ManualSearchHit }) {
  const [annotations, setAnnotations] = useState<ManualChunkAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState(0);

  const paragraphs = useMemo(() => splitDocumentParagraphs(hit.content), [hit.content]);

  const annotationsByParagraph = useMemo(() => {
    const groups = new Map<number, ManualChunkAnnotation[]>();
    for (const annotation of annotations) {
      const paragraphIndex = getParagraphIndex(annotation);
      const current = groups.get(paragraphIndex) || [];
      current.push(annotation);
      groups.set(paragraphIndex, current);
    }
    return groups;
  }, [annotations]);

  const selectedParagraph = paragraphs[selectedParagraphIndex] || '';

  useEffect(() => {
    let cancelled = false;

    async function loadAnnotations() {
      setLoading(true);
      try {
        const data = await listAnnotations({
          target_type: hit.target_type,
          target_ref: hit.target_ref,
          page: 1,
          page_size: DOCUMENT_ANNOTATION_PAGE_SIZE,
        });
        if (!cancelled) {
          setAnnotations(data.annotations);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Failed to load annotations', 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAnnotations();

    return () => {
      cancelled = true;
    };
  }, [hit.target_ref, hit.target_type]);

  useEffect(() => {
    if (selectedParagraphIndex >= paragraphs.length && paragraphs.length > 0) {
      setSelectedParagraphIndex(0);
    }
  }, [paragraphs.length, selectedParagraphIndex]);

  const handleCreateAnnotation = async () => {
    if (!selectedParagraph.trim()) {
      showToast('Pick a paragraph before creating an annotation', 'error');
      return;
    }
    if (!draftBody.trim()) {
      showToast('Enter annotation text first', 'error');
      return;
    }

    setSaving(true);
    try {
      const created = await createAnnotation({
        annotation_type: 'note',
        body: draftBody.trim(),
        short_label: buildShortLabel(hit, selectedParagraph),
        target_type: hit.target_type,
        target_ref: hit.target_ref,
        target_label: hit.target_label,
        target_subtitle: buildTargetSubtitle(hit),
        anchor: {
          selection_kind: 'paragraph',
          paragraph_index: selectedParagraphIndex,
          selected_text: selectedParagraph,
          chunk_id: hit.chunk_id,
          manual_type: hit.manual_type,
          manual_version: hit.manual_version,
          section: hit.section,
          section_title: hit.section_title,
          page_start: hit.page_start,
          page_end: hit.page_end,
        },
        meta: {
          source: 'manual_search',
          content_type: hit.content_type,
          volume: hit.volume,
          chapter: hit.chapter,
        },
      });
      setAnnotations((current) => [created, ...current]);
      setDraftBody('');
      showToast('Paragraph annotation created', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create annotation', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!paragraphs.length) {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        This result does not include extracted paragraph text, so paragraph annotations are unavailable here.
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-800">
          <FileText className="h-4 w-4 text-gray-500" />
          Select a paragraph from the extracted document text
        </div>
        <div className="space-y-3">
          {paragraphs.map((paragraph, index) => {
            const paragraphAnnotations = annotationsByParagraph.get(index) || [];
            const selected = index === selectedParagraphIndex;
            return (
              <button
                key={`${hit.chunk_id}-${index}`}
                type="button"
                onClick={() => setSelectedParagraphIndex(index)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  selected
                    ? 'border-indigo-400 bg-white shadow-sm ring-2 ring-indigo-100'
                    : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Paragraph {index + 1}
                  </span>
                  {paragraphAnnotations.length > 0 && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {paragraphAnnotations.length} annotation{paragraphAnnotations.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{paragraph}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-gray-900">Annotation workspace</h4>
          <p className="mt-1 text-xs text-gray-500">{buildTargetSubtitle(hit)}</p>
        </div>

        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">Selected paragraph</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-indigo-950">{selectedParagraph}</p>
        </div>

        <label className="mt-4 block text-xs font-medium text-gray-700">Annotation</label>
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={6}
          placeholder="Explain why this paragraph matters, capture your interpretation, or link it to another finding."
          className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Anchors include paragraph index, selected text, and page range.
          </p>
          <PrimaryButton onClick={handleCreateAnnotation} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Create annotation'}
          </PrimaryButton>
        </div>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h5 className="text-sm font-semibold text-gray-900">Annotations on this paragraph</h5>
            {loading && <span className="text-xs text-gray-500">Loading...</span>}
          </div>
          <div className="space-y-3">
            {(annotationsByParagraph.get(selectedParagraphIndex) || []).map((annotation) => (
              <div
                key={annotation.annotation_id}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-gray-700">
                    {annotation.author || 'Unknown author'}
                  </span>
                  <span className="text-xs text-gray-500">{annotation.annotation_type}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800">{annotation.body}</p>
                {getParagraphQuote(annotation) && (
                  <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-gray-500">
                    Anchor: {getParagraphQuote(annotation)}
                  </p>
                )}
              </div>
            ))}
            {!loading && (annotationsByParagraph.get(selectedParagraphIndex) || []).length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                No annotations on this paragraph yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

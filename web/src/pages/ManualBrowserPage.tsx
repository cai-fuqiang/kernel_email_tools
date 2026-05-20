import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listManualDocuments } from '../api/client';
import type { ManualDocumentSummary } from '../api/types';
import { PageHeader, PageShell } from '../components/ui';

export default function ManualBrowserPage() {
  const [documents, setDocuments] = useState<ManualDocumentSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listManualDocuments()
      .then((res) => { if (active) { setDocuments(res.documents); setLoading(false); } })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load documents.');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filtered = documents.filter((d) =>
    d.title.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <PageShell>
      <PageHeader title="PDF Browser" description="Browse and open ingested PDF documents." />

      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by title…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {!loading && !error && (
          <span className="text-sm text-slate-500">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {loading && (
        <p className="text-sm text-slate-500">Loading documents…</p>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && documents.length === 0 && (
        <p className="text-sm text-slate-500">No documents ingested yet.</p>
      )}

      {!loading && !error && filtered.length === 0 && documents.length > 0 && (
        <p className="text-sm text-slate-500">No documents match your search.</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((doc) => (
            <DocumentCard key={doc.document_id} doc={doc} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function DocumentCard({ doc }: { doc: ManualDocumentSummary }) {
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    if (doc.has_pdf) navigate(`/manual/pdf/${encodeURIComponent(doc.document_id)}`);
  }, [doc.document_id, doc.has_pdf, navigate]);

  return (
    <div
      data-testid={`doc-card-${doc.document_id}`}
      aria-disabled={doc.has_pdf ? undefined : 'true'}
      onClick={handleClick}
      className={[
        'rounded-2xl border bg-white p-5 shadow-sm transition',
        doc.has_pdf
          ? 'cursor-pointer border-slate-200 hover:border-indigo-300 hover:shadow-md'
          : 'cursor-not-allowed border-slate-200 opacity-50',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 leading-snug">{doc.title}</h2>
        {doc.has_pdf ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">PDF</span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">No PDF</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{doc.manual_type} · {doc.manual_version}</p>
      <p className="mt-3 text-xs text-slate-400">{doc.page_count} pages · {doc.chunk_count} chunks</p>
    </div>
  );
}

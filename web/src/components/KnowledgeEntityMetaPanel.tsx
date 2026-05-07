import { useMemo, useState } from 'react';
import { ExternalLink, Plus, X } from 'lucide-react';
import {
  KERNEL_VERSION_RELATIONSHIPS,
  type KernelVersionRelationship,
  type KnowledgeEntityMetaSchema,
  pickPrimaryVersion,
} from '../utils/knowledgeMeta';
import { elixirIdentUrl } from '../utils/externalLinks';
import KernelSourceLink from './KernelSourceLink';

interface KnowledgeEntityMetaPanelProps {
  meta: KnowledgeEntityMetaSchema;
  onChange: (next: KnowledgeEntityMetaSchema) => void;
  canEdit: boolean;
}

const RELATIONSHIP_LABELS: Record<KernelVersionRelationship, string> = {
  introduced: 'Introduced in',
  last_seen: 'Last seen in',
  removed: 'Removed in',
  affected: 'Affected in',
  fixed: 'Fixed in',
  note: 'Note',
};

const RELATIONSHIP_TONE: Record<KernelVersionRelationship, string> = {
  introduced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  last_seen: 'bg-slate-50 text-slate-700 border-slate-200',
  removed: 'bg-rose-50 text-rose-700 border-rose-200',
  affected: 'bg-amber-50 text-amber-700 border-amber-200',
  fixed: 'bg-sky-50 text-sky-700 border-sky-200',
  note: 'bg-gray-50 text-gray-600 border-gray-200',
};

export default function KnowledgeEntityMetaPanel({
  meta,
  onChange,
  canEdit,
}: KnowledgeEntityMetaPanelProps) {
  const primaryVersion = useMemo(
    () => pickPrimaryVersion(meta.kernel_versions),
    [meta.kernel_versions],
  );

  // Local draft state for the three inline "add" rows, so empty inputs
  // don't pollute meta until the user commits.
  const [newVersion, setNewVersion] = useState('');
  const [newVersionRelationship, setNewVersionRelationship] =
    useState<KernelVersionRelationship>('introduced');
  const [newFile, setNewFile] = useState('');
  const [newSymbol, setNewSymbol] = useState('');

  const addVersion = () => {
    const v = newVersion.trim();
    if (!v) return;
    if (meta.kernel_versions.some((e) => e.version === v && e.relationship === newVersionRelationship)) {
      setNewVersion('');
      return;
    }
    onChange({
      ...meta,
      kernel_versions: [
        ...meta.kernel_versions,
        { version: v, relationship: newVersionRelationship },
      ],
    });
    setNewVersion('');
  };

  const removeVersion = (index: number) => {
    onChange({
      ...meta,
      kernel_versions: meta.kernel_versions.filter((_, i) => i !== index),
    });
  };

  const updateVersionRelationship = (index: number, relationship: KernelVersionRelationship) => {
    onChange({
      ...meta,
      kernel_versions: meta.kernel_versions.map((entry, i) =>
        i === index ? { ...entry, relationship } : entry,
      ),
    });
  };

  const addFile = () => {
    const f = newFile.trim().replace(/^\/+/, '');
    if (!f) return;
    if (meta.source_files.includes(f)) {
      setNewFile('');
      return;
    }
    onChange({ ...meta, source_files: [...meta.source_files, f] });
    setNewFile('');
  };

  const removeFile = (path: string) => {
    onChange({ ...meta, source_files: meta.source_files.filter((p) => p !== path) });
  };

  const addSymbol = () => {
    const s = newSymbol.trim();
    if (!s) return;
    if (meta.symbols.includes(s)) {
      setNewSymbol('');
      return;
    }
    onChange({ ...meta, symbols: [...meta.symbols, s] });
    setNewSymbol('');
  };

  const removeSymbol = (symbol: string) => {
    onChange({ ...meta, symbols: meta.symbols.filter((s) => s !== symbol) });
  };

  return (
    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-950">Kernel references</h2>
        <p className="text-sm text-gray-500">
          Link this knowledge to specific kernel versions, source files, and symbols. Files and
          symbols become jump-to-code links (Elixir / git.kernel.org).
        </p>
      </div>

      {/* Kernel versions timeline */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Kernel versions</h3>
          <span className="text-xs text-gray-400">
            Primary version for links: <code className="text-gray-600">{primaryVersion}</code>
          </span>
        </div>
        {meta.kernel_versions.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No versions linked yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {meta.kernel_versions.map((entry, idx) => (
              <li
                key={`${entry.version}-${entry.relationship}-${idx}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                  RELATIONSHIP_TONE[entry.relationship]
                }`}
              >
                {canEdit ? (
                  <select
                    value={entry.relationship}
                    onChange={(e) =>
                      updateVersionRelationship(idx, e.target.value as KernelVersionRelationship)
                    }
                    className="rounded border border-transparent bg-transparent text-xs font-semibold uppercase focus:border-gray-300 focus:bg-white"
                  >
                    {KERNEL_VERSION_RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-semibold uppercase">
                    {RELATIONSHIP_LABELS[entry.relationship]}
                  </span>
                )}
                <code className="rounded bg-white/70 px-1.5 py-0.5 text-sm font-mono">
                  {entry.version}
                </code>
                {entry.note && <span className="text-xs">({entry.note})</span>}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeVersion(idx)}
                    className="ml-auto rounded p-1 hover:bg-white/60"
                    aria-label="Remove version"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-3 flex gap-2">
            <select
              value={newVersionRelationship}
              onChange={(e) =>
                setNewVersionRelationship(e.target.value as KernelVersionRelationship)
              }
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            >
              {KERNEL_VERSION_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </select>
            <input
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addVersion())}
              placeholder="v6.8"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={addVersion}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        )}
      </div>

      {/* Source files */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Source files</h3>
        {meta.source_files.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No files linked yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {meta.source_files.map((path) => (
              <li
                key={path}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-2 pr-1 text-xs"
              >
                <KernelSourceLink
                  version={primaryVersion}
                  path={path}
                  className="inline-flex items-center gap-1 font-mono text-gray-700 hover:text-indigo-600"
                >
                  {path}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </KernelSourceLink>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeFile(path)}
                    className="rounded p-0.5 hover:bg-white"
                    aria-label="Remove file"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-3 flex gap-2">
            <input
              value={newFile}
              onChange={(e) => setNewFile(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFile())}
              placeholder="mm/vmscan.c"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono"
            />
            <button
              type="button"
              onClick={addFile}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add file
            </button>
          </div>
        )}
      </div>

      {/* Symbols */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Symbols</h3>
        {meta.symbols.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No symbols linked yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {meta.symbols.map((symbol) => (
              <li
                key={symbol}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 py-1 pl-2 pr-1 text-xs"
              >
                <a
                  href={elixirIdentUrl(primaryVersion, symbol)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Search ${symbol} in Elixir (${primaryVersion})`}
                  className="inline-flex items-center gap-1 font-mono text-indigo-700 hover:text-indigo-900"
                >
                  {symbol}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
                {canEdit && (
                <button
                    type="button"
                    onClick={() => removeSymbol(symbol)}
                    className="rounded p-0.5 hover:bg-white"
                    aria-label="Remove symbol"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-3 flex gap-2">
            <input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSymbol())}
              placeholder="shrink_node"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono"
            />
            <button
              type="button"
              onClick={addSymbol}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add symbol
            </button>
          </div>
        )}
      </div>
 </section>
  );
}

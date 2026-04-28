import { useState } from 'react';
import { applyAskDraft, createAskDraft } from '../api/client';
import type { AskDraftApplyResponse, AskDraftResponse, AskResponse } from '../api/types';
import DraftReviewPanel from './DraftReviewPanel';

type Props = {
  answer: AskResponse;
};

export default function AskDraftPanel({ answer }: Props) {
  const [draft, setDraft] = useState<AskDraftResponse | null>(null);
  const [saved, setSaved] = useState<AskDraftApplyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadDraft = async () => {
    setLoading(true);
    setError('');
    setSaved(null);
    try {
      setDraft(await createAskDraft(answer));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create drafts');
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const result = await applyAskDraft(draft);
      setSaved(result);
      if (result.errors.length) {
        setError(result.errors.map((e) => `${e.type}[${e.index}]: ${e.message}`).join('\n'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save drafts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Save useful parts</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Turn this answer into reviewed knowledge, human notes, and existing tag assignments.
          </p>
        </div>
        {!draft && (
          <button
            onClick={loadDraft}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create review draft'}
          </button>
        )}
      </div>

      {!draft && error && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {draft && (
        <div className="mt-4">
          <DraftReviewPanel
            draft={draft}
            onChange={(nextDraft) => {
              setDraft(nextDraft);
              setSaved(null);
            }}
            onSave={saveDraft}
            saving={saving}
            saved={saved}
            error={error}
          />
        </div>
      )}
    </div>
  );
}

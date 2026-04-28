import { useState } from 'react';
import { askManualQuestion } from '../api/client';
import type { ManualAskResponse } from '../api/types';
import { PageHeader, PageShell, PrimaryButton, SectionPanel } from '../components/ui';

export default function ManualAskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ManualAskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 过滤选项
  const [manualType, setManualType] = useState('');
  const [contentType, setContentType] = useState('');

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await askManualQuestion(
        question,
        manualType || undefined,
        contentType || undefined
      );
      setAnswer(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Manuals"
        title="Ask Chip Manuals"
        description="Ask questions about processor architecture and instruction sets."
      />
      <SectionPanel>

      {/* 过滤选项 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manual Type</label>
          <select
            value={manualType}
            onChange={(e) => setManualType(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Manuals</option>
            <option value="intel_sdm">Intel SDM</option>
            <option value="arm_arm">ARM ARM</option>
            <option value="amd_apm">AMD APM</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Content Type</label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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

      {/* 问题输入 */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder="e.g. How does the MOV instruction work in x86-64?"
          className="flex-1 px-4 py-3 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
        />
        <PrimaryButton
          onClick={handleAsk}
          disabled={loading}
        >
          {loading ? 'Thinking...' : 'Ask'}
        </PrimaryButton>
      </div>
      </SectionPanel>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {answer && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Answer
              <span className="text-xs font-normal text-gray-400 ml-auto">{answer.retrieval_mode} mode</span>
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {answer.answer}
            </div>
          </div>

          {answer.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Sources ({answer.sources.length})
              </h3>
              <div className="space-y-2">
                {answer.sources.map((s, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-900">
                      [{s.section}] {s.section_title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {s.manual_type} · Pages {s.page_start}-{s.page_end}
                    </p>
                    {s.snippet && (
                      <p className="text-xs text-gray-600 mt-2 line-clamp-2">
                        {s.snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!answer && !loading && (
        <div className="text-center py-20 text-gray-400">
          <p>Ask a question about processor architecture and instruction sets</p>
        </div>
      )}
    </PageShell>
  );
}

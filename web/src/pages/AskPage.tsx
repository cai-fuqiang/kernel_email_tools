import { useState } from 'react';
import { askQuestion } from '../api/client';
import type { AskResponse } from '../api/types';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true); setError('');
    try { setAnswer(await askQuestion(question)); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Ask a Question</h2>
        <p className="text-sm text-gray-500">Ask questions about kernel development discussions</p>
      </div>
      <div className="flex gap-3 mb-6">
        <input type="text" value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
          placeholder="e.g. Why was the shmem mount behavior changed?"
          className="flex-1 px-4 py-3 bg-white border border-gray-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 text-sm" />
        <button onClick={handleAsk} disabled={loading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm">
          {loading ? 'Thinking...' : 'Ask'}
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {answer && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Answer
              <span className="text-xs font-normal text-gray-400 ml-auto">{answer.retrieval_mode} mode</span>
            </h3>
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{answer.answer}</div>
          </div>
          {answer.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sources ({answer.sources.length})</h3>
              <div className="space-y-2">
                {answer.sources.map((s, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.subject}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.sender} &middot; {s.date}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!answer && !loading && <div className="text-center py-20 text-gray-400"><p>Ask a question about kernel mailing list discussions</p></div>}
    </div>
  );
}
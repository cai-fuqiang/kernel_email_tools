import { useEffect, useState } from 'react';
import { getThread } from '../api/client';
import type { ThreadResponse } from '../api/types';

interface Props { threadId: string; onClose: () => void; }

export default function ThreadDrawer({ threadId, onClose }: Props) {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  useEffect(() => {
    setLoading(true);
    getThread(threadId).then(t => { setThread(t); if (t.emails.length > 0) setExpanded(new Set([t.emails[0].id])); })
      .catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [threadId]);
  const toggle = (id: number) => { const s = new Set(expanded); s.has(id) ? s.delete(id) : s.add(id); setExpanded(s); };
  return (
    <div className='fixed inset-0 z-50 flex'>
      <div className='absolute inset-0 bg-black/30' onClick={onClose} />
      <div className='relative ml-auto w-full max-w-2xl bg-white shadow-2xl overflow-y-auto'>
        <div className='sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10'>
          <h3 className='text-sm font-semibold text-gray-900'>Thread ({thread?.total ?? '...'} emails)</h3>
          <button onClick={onClose} className='text-gray-400 hover:text-gray-600'>&times;</button>
        </div>
        <div className='p-6'>
          {loading && <p className='text-sm text-gray-400'>Loading...</p>}
          {error && <p className='text-sm text-red-600'>{error}</p>}
          {thread && <div className='space-y-3'>
            {thread.emails.map(e => (
              <div key={e.id} className='border border-gray-200 rounded-lg overflow-hidden'>
                <button onClick={() => toggle(e.id)} className='w-full px-4 py-3 text-left hover:bg-gray-50'>
                  <p className='text-sm font-medium text-gray-900 truncate'>{e.subject}</p>
                  <p className='text-xs text-gray-500 mt-1'>{e.sender.split('<')[0].trim()} &middot; {e.date ? new Date(e.date).toLocaleString() : ''}</p>
                </button>
                {expanded.has(e.id) && <div className='px-4 pb-4 border-t border-gray-100'>
                  <pre className='text-xs text-gray-700 whitespace-pre-wrap mt-3 leading-relaxed max-h-80 overflow-y-auto'>{e.body}</pre>
                </div>}
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}

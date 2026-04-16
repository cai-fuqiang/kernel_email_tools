import type { SearchResponse, AskResponse, ThreadResponse, StatsResponse } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function searchEmails(
  query: string,
  opts: { list_name?: string; page?: number; page_size?: number; mode?: string } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (opts.list_name) params.set('list_name', opts.list_name);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.page_size) params.set('page_size', String(opts.page_size));
  if (opts.mode) params.set('mode', opts.mode);
  return fetchJSON<SearchResponse>(`${API_BASE}/search?${params}`);
}

export async function askQuestion(
  question: string,
  listName?: string,
): Promise<AskResponse> {
  const params = new URLSearchParams({ q: question });
  if (listName) params.set('list_name', listName);
  return fetchJSON<AskResponse>(`${API_BASE}/ask?${params}`);
}

export async function getThread(threadId: string): Promise<ThreadResponse> {
  return fetchJSON<ThreadResponse>(`${API_BASE}/thread/${encodeURIComponent(threadId)}`);
}

export async function getStats(): Promise<StatsResponse> {
  return fetchJSON<StatsResponse>(`${API_BASE}/stats`);
}

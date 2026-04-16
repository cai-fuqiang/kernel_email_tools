import type { SearchResponse, AskResponse, ThreadResponse, StatsResponse } from './types';

// 使用相对路径，同源请求不会有 CORS 问题
// 开发环境：Vite 代理 /api -> localhost:8000
// 生产环境：FastAPI 挂载前端在 /app/，API 在 /api/
const API_BASE = '/api';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface SearchOptions {
  list_name?: string;
  sender?: string;
  date_from?: string;
  date_to?: string;
  has_patch?: boolean;
  page?: number;
  page_size?: number;
  mode?: string;
}

export async function searchEmails(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (opts.list_name) params.set('list_name', opts.list_name);
  if (opts.sender) params.set('sender', opts.sender);
  if (opts.date_from) params.set('date_from', opts.date_from);
  if (opts.date_to) params.set('date_to', opts.date_to);
  if (opts.has_patch !== undefined) params.set('has_patch', String(opts.has_patch));
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
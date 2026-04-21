import type { 
  SearchResponse, 
  AskResponse, 
  ThreadResponse, 
  StatsResponse,
  ManualSearchResponse,
  ManualAskResponse,
  ManualStatsResponse
} from './types';

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

// ============================================================
// 标签管理 API
// ============================================================

export interface TagTree {
  id: number;
  name: string;
  color: string;
  children: TagTree[];
}

export interface TagStats {
  name: string;
  count: number;
}

export async function getTagTree(): Promise<TagTree[]> {
  return fetchJSON<TagTree[]>(`${API_BASE}/tags`);
}

export async function getTagStats(): Promise<TagStats[]> {
  return fetchJSON<TagStats[]>(`${API_BASE}/tags/stats`);
}

export async function createTag(
  name: string,
  parentId?: number,
  color?: string,
): Promise<TagTree> {
  const res = await fetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId, color }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function deleteTag(tagId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

// 邮件标签 API
export async function getEmailTags(messageId: string): Promise<string[]> {
  const data = await fetchJSON<{ message_id: string; tags: string[] }>(
    `${API_BASE}/email/${encodeURIComponent(messageId)}/tags`
  );
  return data.tags;
}

export async function addEmailTag(
  messageId: string,
  tagName: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/email/${encodeURIComponent(messageId)}/tags`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tagName }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

export async function removeEmailTag(
  messageId: string,
  tagName: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/email/${encodeURIComponent(messageId)}/tags/${encodeURIComponent(tagName)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

// ============================================================
// 搜索与问答 API
// ============================================================

export interface SearchOptions {
  list_name?: string;
  sender?: string;
  date_from?: string;
  date_to?: string;
  has_patch?: boolean;
  tags?: string | string[];
  tag_mode?: 'any' | 'all';
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
  if (opts.tags) {
    const tags = Array.isArray(opts.tags) ? opts.tags.join(',') : opts.tags;
    params.set('tags', tags);
  }
  if (opts.tag_mode) params.set('tag_mode', opts.tag_mode);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.page_size) params.set('page_size', String(opts.page_size));
  if (opts.mode) params.set('mode', opts.mode);
  return fetchJSON<SearchResponse>(`${API_BASE}/search?${params}`);
}

export interface AskOptions {
  list_name?: string;
  sender?: string;
  date_from?: string;
  date_to?: string;
  tags?: string | string[];
}

export async function askQuestion(
  question: string,
  opts: AskOptions = {},
): Promise<AskResponse> {
  const params = new URLSearchParams({ q: question });
  if (opts.list_name) params.set('list_name', opts.list_name);
  if (opts.sender) params.set('sender', opts.sender);
  if (opts.date_from) params.set('date_from', opts.date_from);
  if (opts.date_to) params.set('date_to', opts.date_to);
  if (opts.tags) {
    const tags = Array.isArray(opts.tags) ? opts.tags.join(',') : opts.tags;
    params.set('tags', tags);
  }
  return fetchJSON<AskResponse>(`${API_BASE}/ask?${params}`);
}

export async function getThread(threadId: string): Promise<ThreadResponse> {
  return fetchJSON<ThreadResponse>(`${API_BASE}/thread/${encodeURIComponent(threadId)}`);
}

export async function getStats(): Promise<StatsResponse> {
  return fetchJSON<StatsResponse>(`${API_BASE}/stats`);
}

// 芯片手册相关 API
export interface ManualSearchOptions {
  manual_type?: string;
  content_type?: string;
  page?: number;
  page_size?: number;
}

export async function searchManuals(
  query: string,
  opts: ManualSearchOptions = {},
): Promise<ManualSearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (opts.manual_type) params.set('manual_type', opts.manual_type);
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.page_size) params.set('page_size', String(opts.page_size));
  return fetchJSON<ManualSearchResponse>(`${API_BASE}/manual/search?${params}`);
}

export async function askManualQuestion(
  question: string,
  manualType?: string,
  contentType?: string,
): Promise<ManualAskResponse> {
  const params = new URLSearchParams({ q: question });
  if (manualType) params.set('manual_type', manualType);
  if (contentType) params.set('content_type', contentType);
  return fetchJSON<ManualAskResponse>(`${API_BASE}/manual/ask?${params}`);
}

export async function getManualStats(): Promise<ManualStatsResponse> {
  return fetchJSON<ManualStatsResponse>(`${API_BASE}/manual/stats`);
}

// ============================================================
// 翻译 API
// ============================================================

export interface TranslateRequest {
  text: string;
  source_lang?: string;
  target_lang?: string;
}

export interface TranslateResponse {
  translation: string;
  cached: boolean;
}

export interface TranslateBatchRequest {
  texts: string[];
  source_lang?: string;
  target_lang?: string;
}

export interface TranslateBatchResponse {
  translations: string[];
  cached_count: number;
}

export async function translateText(
  text: string,
  sourceLang: string = "auto",
  targetLang: string = "zh-CN"
): Promise<TranslateResponse> {
  const res = await fetch(`${API_BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Translation error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function translateBatch(
  texts: string[],
  sourceLang: string = "auto",
  targetLang: string = "zh-CN"
): Promise<TranslateBatchResponse> {
  const res = await fetch(`${API_BASE}/translate/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, source_lang: sourceLang, target_lang: targetLang }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Translation error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getTranslateHealth(): Promise<{
  available: boolean;
  translator: string;
  cache_enabled: boolean;
}> {
  return fetchJSON(`${API_BASE}/translate/health`);
}

export interface ClearCacheResponse {
  success: boolean;
  message: string;
  cleared_count: number;
}

export async function clearTranslationCache(
  scope: 'paragraph' | 'all',
  textHash?: string
): Promise<ClearCacheResponse> {
  const res = await fetch(`${API_BASE}/translate/cache`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, text_hash: textHash }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clear cache error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface ManualTranslateResponse {
  success: boolean;
  message: string;
  cache_key?: string;
}

export async function saveManualTranslation(
  originalText: string,
  translatedText: string,
  sourceLang: string = 'en',
  targetLang: string = 'zh-CN'
): Promise<ManualTranslateResponse> {
  const res = await fetch(`${API_BASE}/translate/manual`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original_text: originalText,
      translated_text: translatedText,
      source_lang: sourceLang,
      target_lang: targetLang,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manual translation error ${res.status}: ${text}`);
  }
  return res.json();
}

import type { 
  SearchResponse, 
  AskResponse, 
  ThreadResponse, 
  StatsResponse,
  ManualSearchResponse,
  ManualAskResponse,
  ManualStatsResponse,
  Annotation,
  AnnotationCreate,
  AnnotationListResponse,
  TagAssignment,
  TagRead,
  TagStats,
  TagTargetBundle,
  TagTree,
  KernelVersionsResponse,
  KernelTreeResponse,
  KernelFileResponse,
  CodeAnnotation,
  CodeAnnotationCreate,
  CodeAnnotationListResponse,
} from './types';
export type { TagAssignment, TagRead, TagStats, TagTargetBundle, TagTree } from './types';

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

type AnnotationTargetFields = {
  target_type?: string;
  target_ref?: string;
  target_label?: string;
  target_subtitle?: string;
  anchor?: Record<string, unknown>;
};

type AnnotationTargetView = {
  target: {
    type: string;
    ref: string;
    label: string;
    subtitle: string;
    anchor: Record<string, unknown>;
  };
};

function normalizeAnnotation<T extends object>(
  annotation: T & Partial<AnnotationTargetFields>,
): T & AnnotationTargetView {
  const anchorValue = annotation.anchor;
  const target = {
    type: String(annotation.target_type || ''),
    ref: String(annotation.target_ref || ''),
    label: String(annotation.target_label || ''),
    subtitle: String(annotation.target_subtitle || ''),
    anchor:
      anchorValue && typeof anchorValue === 'object' && !Array.isArray(anchorValue)
        ? anchorValue
        : {},
  };

  return {
    ...annotation,
    target,
  };
}

function normalizeAnnotations<T extends object>(
  annotations: Array<T & Partial<AnnotationTargetFields>>,
): Array<T & AnnotationTargetView> {
  return annotations.map((annotation) => normalizeAnnotation<T>(annotation));
}

// ============================================================
// 标签管理 API
// ============================================================

export async function getTagTree(flat: boolean = false): Promise<TagTree[]> {
  const params = flat ? '?flat=true' : '';
  return fetchJSON<TagTree[]>(`${API_BASE}/tags${params}`);
}

export async function getTagStats(): Promise<TagStats[]> {
  return fetchJSON<TagStats[]>(`${API_BASE}/tags/stats`);
}

export async function createTag(
  name: string,
  parentTagId?: number,
  color?: string,
  description: string = '',
  tagKind: string = 'topic',
): Promise<TagRead> {
  const res = await fetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      parent_tag_id: parentTagId,
      color,
      description,
      tag_kind: tagKind,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function updateTag(
  tagId: number,
  patch: {
    name?: string;
    description?: string;
    color?: string;
    parent_tag_id?: number | null;
    status?: string;
    tag_kind?: string;
    aliases?: string[];
  },
): Promise<TagRead> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface TagEmailItem {
  message_id: string;
  subject: string;
  sender: string;
  date: string | null;
  list_name: string;
  thread_id: string;
  has_patch: boolean;
  snippet: string;
}

export interface TagEmailsResponse {
  tag: string;
  emails: TagEmailItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function getEmailsByTag(
  tagName: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<TagEmailsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return fetchJSON<TagEmailsResponse>(
    `${API_BASE}/tags/${encodeURIComponent(tagName)}/emails?${params}`
  );
}

export async function deleteTag(tagId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

export async function listTagAssignments(opts?: {
  target_type?: string;
  target_ref?: string;
  anchor?: Record<string, unknown>;
  tag?: string;
  tag_kind?: string;
  status?: string;
}): Promise<TagAssignment[]> {
  const params = new URLSearchParams();
  if (opts?.target_type) params.set('target_type', opts.target_type);
  if (opts?.target_ref) params.set('target_ref', opts.target_ref);
  if (opts?.anchor) params.set('anchor_json', JSON.stringify(opts.anchor));
  if (opts?.tag) params.set('tag', opts.tag);
  if (opts?.tag_kind) params.set('tag_kind', opts.tag_kind);
  if (opts?.status) params.set('status', opts.status);
  return fetchJSON<TagAssignment[]>(`${API_BASE}/tag-assignments?${params}`);
}

export async function createTagAssignment(data: {
  tag_id?: number;
  tag_slug?: string;
  tag_name?: string;
  target_type: string;
  target_ref: string;
  anchor?: Record<string, unknown>;
  assignment_scope?: string;
  source_type?: string;
  evidence?: Record<string, unknown>;
  created_by?: string;
}): Promise<TagAssignment> {
  const res = await fetch(`${API_BASE}/tag-assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function deleteTagAssignment(assignmentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tag-assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

export async function getTargetTags(
  targetType: string,
  targetRef: string,
  anchor?: Record<string, unknown>,
): Promise<TagTargetBundle> {
  const params = new URLSearchParams();
  if (anchor) params.set('anchor_json', JSON.stringify(anchor));
  return fetchJSON<TagTargetBundle>(
    `${API_BASE}/tag-targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetRef)}/tags${params.toString() ? `?${params}` : ''}`
  );
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
  await createTagAssignment({
    tag_name: tagName,
    target_type: 'email_message',
    target_ref: messageId,
  });
}

export async function removeEmailTag(
  messageId: string,
  tagName: string,
): Promise<void> {
  const assignments = await listTagAssignments({
    target_type: 'email_message',
    target_ref: messageId,
    tag: tagName,
  });
  for (const item of assignments) {
    await deleteTagAssignment(item.assignment_id);
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
  const data = await fetchJSON<ThreadResponse>(`${API_BASE}/thread/${threadId}`);
  return {
    ...data,
    annotations: normalizeAnnotations(data.annotations),
  };
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
  targetLang: string = "zh-CN",
  messageId?: string
): Promise<TranslateBatchResponse> {
  const res = await fetch(`${API_BASE}/translate/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, source_lang: sourceLang, target_lang: targetLang, message_id: messageId }),
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

// 翻译线程列表相关类型和API
export interface TranslatedThreadInfo {
  thread_id: string;
  subject: string;
  sender: string;
  date: string | null;
  list_name: string;
  email_count: number;
  cached_paragraphs: number;
  tags: string[];
  last_translated_at: string | null;
}

export interface TranslatedThreadsResponse {
  threads: TranslatedThreadInfo[];
  total: number;
}

export async function getTranslatedThreads(): Promise<TranslatedThreadsResponse> {
  return fetchJSON(`${API_BASE}/translate/threads`);
}

// ============================================================
// 批注 API
// ============================================================

export async function createAnnotation(data: AnnotationCreate): Promise<Annotation> {
  const res = await fetch(`${API_BASE}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return normalizeAnnotation(await res.json()) as Annotation;
}

export async function getAnnotations(threadId: string): Promise<Annotation[]> {
  const data = await fetchJSON<Annotation[]>(`${API_BASE}/annotations/${encodeURIComponent(threadId)}`);
  return normalizeAnnotations(data) as Annotation[];
}

export async function updateAnnotation(annotationId: string, body: string): Promise<Annotation> {
  const res = await fetch(`${API_BASE}/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return normalizeAnnotation(await res.json()) as Annotation;
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

export async function exportAnnotations(threadId?: string): Promise<Record<string, unknown>> {
  const params = threadId ? `?thread_id=${threadId}` : '';
  const res = await fetch(`${API_BASE}/annotations/export${params}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function importAnnotations(data: Record<string, unknown>): Promise<{ status: string; total_imported: number }> {
  const res = await fetch(`${API_BASE}/annotations/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function listAnnotations(opts?: {
  q?: string;
  type?: 'all' | 'email' | 'code' | 'sdm_spec';
  version?: string;
  page?: number;
  page_size?: number;
}): Promise<AnnotationListResponse> {
  const params = new URLSearchParams();
  if (opts?.q) params.set('q', opts.q);
  if (opts?.type) params.set('type', opts.type);
  if (opts?.version) params.set('version', opts.version);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.page_size) params.set('page_size', String(opts.page_size));
  const data = await fetchJSON<AnnotationListResponse>(`${API_BASE}/annotations?${params}`);
  return {
    ...data,
    annotations: normalizeAnnotations(data.annotations) as AnnotationListResponse['annotations'],
  };
}

// ============================================================
// 内核源码浏览 API (PLAN-10000)
// ============================================================

export async function getKernelVersions(
  filter: 'release' | 'all' = 'release',
): Promise<KernelVersionsResponse> {
  return fetchJSON<KernelVersionsResponse>(
    `${API_BASE}/kernel/versions?filter=${filter}`
  );
}

export async function getKernelTree(
  version: string,
  path: string = '',
): Promise<KernelTreeResponse> {
  const url = path
    ? `${API_BASE}/kernel/tree/${encodeURIComponent(version)}/${path}`
    : `${API_BASE}/kernel/tree/${encodeURIComponent(version)}`;
  return fetchJSON<KernelTreeResponse>(url);
}

export async function getKernelFile(
  version: string,
  path: string,
): Promise<KernelFileResponse> {
  return fetchJSON<KernelFileResponse>(
    `${API_BASE}/kernel/file/${encodeURIComponent(version)}/${path}`
  );
}

export async function getCodeAnnotations(
  version: string,
  path: string,
): Promise<CodeAnnotation[]> {
  const data = await fetchJSON<CodeAnnotation[]>(
    `${API_BASE}/kernel/annotations/${encodeURIComponent(version)}/${path}`
  );
  return normalizeAnnotations(data) as CodeAnnotation[];
}

export async function listCodeAnnotations(opts?: {
  q?: string;
  version?: string;
  page?: number;
  page_size?: number;
}): Promise<CodeAnnotationListResponse> {
  const params = new URLSearchParams();
  if (opts?.q) params.set('q', opts.q);
  if (opts?.version) params.set('version', opts.version);
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.page_size) params.set('page_size', String(opts.page_size));
  const data = await fetchJSON<CodeAnnotationListResponse>(`${API_BASE}/kernel/annotations?${params}`);
  return {
    ...data,
    annotations: normalizeAnnotations(data.annotations) as CodeAnnotationListResponse['annotations'],
  };
}

export async function createCodeAnnotation(data: CodeAnnotationCreate): Promise<CodeAnnotation> {
  const res = await fetch(`${API_BASE}/kernel/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return normalizeAnnotation(await res.json()) as CodeAnnotation;
}

export async function updateCodeAnnotation(
  annotationId: string,
  body: string,
): Promise<CodeAnnotation> {
  const res = await fetch(`${API_BASE}/kernel/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return normalizeAnnotation(await res.json()) as CodeAnnotation;
}

export async function deleteCodeAnnotation(annotationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/kernel/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

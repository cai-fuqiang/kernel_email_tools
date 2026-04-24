export interface SearchHit {
  message_id: string;
  subject: string;
  sender: string;
  date: string;
  list_name: string;
  thread_id: string;
  has_patch: boolean;
  tags: string[];
  score: number;
  snippet: string;
  source: string;
}

export interface SearchResponse {
  query: string;
  mode: string;
  total: number;
  page: number;
  page_size: number;
  hits: SearchHit[];
}

export interface SourceRef {
  message_id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
}

export interface AskResponse {
  question: string;
  answer: string;
  sources: SourceRef[];
  model: string;
  retrieval_mode: string;
}

export interface ThreadEmail {
  id: number;
  message_id: string;
  subject: string;
  sender: string;
  date: string | null;
  in_reply_to: string;
  references: string[];
  has_patch: boolean;
  patch_content: string;
  body: string;
  body_raw: string;
}

export interface AnnotationTarget {
  type: string;
  ref: string;
  label: string;
  subtitle: string;
  anchor: Record<string, unknown>;
}

export interface Annotation {
  annotation_id: string;
  annotation_type: string;
  author: string;
  body: string;
  parent_annotation_id: string;
  created_at: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  anchor: Record<string, unknown>;
  thread_id: string;
  in_reply_to: string;
  version?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  meta?: Record<string, unknown>;
  target: AnnotationTarget;
}

export interface AnnotationCreate {
  annotation_type?: string;
  body: string;
  author?: string;
  parent_annotation_id?: string;
  target_type?: string;
  target_ref?: string;
  target_label?: string;
  target_subtitle?: string;
  anchor?: Record<string, unknown>;
  thread_id?: string;
  in_reply_to?: string;
  version?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  meta?: Record<string, unknown>;
}

export interface ThreadResponse {
  thread_id: string;
  emails: ThreadEmail[];
  annotations: Annotation[];
  total: number;
}

export interface StatsResponse {
  total_emails: number;
  lists: Record<string, number>;
}

// 芯片手册相关类型
export interface ManualSearchHit {
  chunk_id: string;
  manual_type: string;
  manual_version: string;
  volume: string;
  chapter: string;
  section: string;
  section_title: string;
  content_type: string;
  content: string;
  page_start: number;
  page_end: number;
  score: number;
  snippet: string;
}

export interface ManualSearchResponse {
  query: string;
  mode: string;
  total: number;
  hits: ManualSearchHit[];
}

export interface ManualSourceRef {
  chunk_id: string;
  section: string;
  section_title: string;
  manual_type: string;
  page_start: number;
  page_end: number;
  snippet: string;
}

export interface ManualAskResponse {
  question: string;
  answer: string;
  sources: ManualSourceRef[];
  model: string;
  retrieval_mode: string;
}

export interface ManualStatsResponse {
  total_chunks: number;
  by_manual_type: Record<string, number>;
  by_content_type: Record<string, number>;
}

// 批注列表相关类型
export interface AnnotationListItem {
  annotation_id: string;
  annotation_type: string;
  author: string;
  body: string;
  parent_annotation_id: string;
  created_at: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  anchor: Record<string, unknown>;
  meta?: Record<string, unknown>;
  thread_id?: string;
  in_reply_to?: string;
  email_subject?: string;
  email_sender?: string;
  version?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
}

export interface AnnotationListResponse {
  annotations: AnnotationListItem[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================
// 内核源码浏览相关类型 (PLAN-10000)
// ============================================================

export interface KernelVersionInfo {
  tag: string;
  major: number;
  minor: number;
  patch: number;
  rc: number;
  is_release: boolean;
}

export interface KernelVersionsResponse {
  versions: KernelVersionInfo[];
  total: number;
}

export interface KernelTreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'symlink';
  size: number;
}

export interface KernelTreeResponse {
  version: string;
  path: string;
  entries: KernelTreeEntry[];
  total: number;
}

export interface KernelFileResponse {
  version: string;
  path: string;
  content: string;
  line_count: number;
  size: number;
  truncated: boolean;
}

export interface CodeAnnotation {
  annotation_id: string;
  annotation_type: string;
  version: string;
  file_path: string;
  start_line: number;
  end_line: number;
  body: string;
  author: string;
  created_at: string;
  parent_annotation_id?: string;
  in_reply_to?: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  anchor: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface CodeAnnotationCreate {
  version: string;
  file_path: string;
  start_line: number;
  end_line: number;
  body: string;
  author?: string;
  in_reply_to?: string;
}

export interface CodeAnnotationListResponse {
  annotations: CodeAnnotation[];
  total: number;
  page: number;
  page_size: number;
}

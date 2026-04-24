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

export interface TagRead {
  id: number;
  slug: string;
  name: string;
  description: string;
  parent_tag_id?: number | null;
  color: string;
  status: string;
  tag_kind: string;
  visibility: 'public' | 'private';
  aliases: string[];
  owner_user_id?: string | null;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagTree {
  id: number;
  slug: string;
  name: string;
  description: string;
  color: string;
  status: string;
  tag_kind: string;
  visibility: 'public' | 'private';
  owner_user_id?: string | null;
  created_by_user_id?: string | null;
  assignment_count: number;
  children: TagTree[];
}

export interface TagStats {
  slug: string;
  name: string;
  count: number;
  target_count: number;
}

export interface TagAssignment {
  id: number;
  assignment_id: string;
  tag_id: number;
  tag_slug: string;
  tag_name: string;
  target_type: string;
  target_ref: string;
  anchor: Record<string, unknown>;
  anchor_hash: string;
  assignment_scope: string;
  source_type: string;
  evidence: Record<string, unknown>;
  created_by: string;
  created_by_user_id?: string | null;
  created_at: string;
}

export interface CurrentUser {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  role: 'admin' | 'editor' | 'viewer';
  status: string;
  auth_source: string;
  capabilities: string[];
}

export interface UserRead {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  disabled_reason: string;
  last_login_at?: string | null;
  role: 'admin' | 'editor' | 'viewer';
  status: string;
  auth_source: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  authenticated: boolean;
  user: CurrentUser | null;
}

export interface LoginResult {
  message: string;
  user: CurrentUser;
}

export interface RegisterResult {
  user_id: string;
  username: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  message: string;
}

export interface TagTargetBundle {
  target_type: string;
  target_ref: string;
  direct_tags: TagRead[];
  inherited_tags: TagRead[];
  aggregated_tags: TagRead[];
}

export interface TagTargetItem {
  assignment_id: string;
  target_type: string;
  target_ref: string;
  anchor: Record<string, unknown>;
  target_meta: Record<string, unknown>;
  tag: TagRead;
}

export interface TagTargetsResponse {
  tag: string;
  target_type?: string | null;
  targets: TagTargetItem[];
  total: number;
  page: number;
  page_size: number;
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
  author_user_id?: string | null;
  visibility: 'public' | 'private';
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
  visibility?: 'public' | 'private';
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
  author_user_id?: string | null;
  visibility: 'public' | 'private';
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
  author_user_id?: string | null;
  visibility: 'public' | 'private';
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
  visibility?: 'public' | 'private';
  in_reply_to?: string;
}

export interface CodeAnnotationListResponse {
  annotations: CodeAnnotation[];
  total: number;
  page: number;
  page_size: number;
}

export interface KernelSymbol {
  id: number;
  version: string;
  file_path: string;
  symbol: string;
  kind: string;
  line: number;
  column: number;
  end_line?: number | null;
  end_column?: number | null;
  signature?: string | null;
  scope?: string | null;
  language: string;
  meta: Record<string, unknown>;
}

export interface KernelSymbolDefinitionResponse {
  version: string;
  symbol: string;
  candidates: KernelSymbol[];
  total: number;
}

export interface KernelSymbolResolveResponse {
  version: string;
  path: string;
  line: number;
  column: number;
  symbol: string;
  candidates: KernelSymbol[];
  total: number;
}

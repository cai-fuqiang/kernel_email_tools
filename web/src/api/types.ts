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
  chunk_id?: string;
  message_id: string;
  subject: string;
  sender: string;
  date: string;
  list_name?: string;
  thread_id?: string;
  chunk_index?: number;
  snippet: string;
  score?: number;
  source?: string;
}

export interface SummarizeResponse {
  answer: string;
  sources: SourceRef[];
  model: string;
}

export interface KnowledgeDraftEntityDraft {
  selected: boolean;
  entity_type: string;
  canonical_name: string;
  slug?: string;
  entity_id?: string;
  aliases: string[];
  summary: string;
  description: string;
  status: string;
  meta: Record<string, unknown>;
  tags?: string[];
}

export interface KnowledgeDraftAnnotationDraft {
  selected: boolean;
  annotation_type: string;
  body: string;
  visibility: 'public' | 'private';
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  anchor: Record<string, unknown>;
  thread_id: string;
  in_reply_to: string;
  meta: Record<string, unknown>;
}

export interface KnowledgeDraftTagAssignmentDraft {
  selected: boolean;
  tag_name: string;
  tag_exists?: boolean;
  target_type: string;
  target_ref: string;
  anchor: Record<string, unknown>;
  assignment_scope: string;
  source_type: string;
  evidence: Record<string, unknown>;
}

export interface KnowledgeDraftPayload {
  draft_id?: string;
  knowledge_drafts: KnowledgeDraftEntityDraft[];
  annotation_drafts: KnowledgeDraftAnnotationDraft[];
  tag_assignment_drafts: KnowledgeDraftTagAssignmentDraft[];
  warnings: string[];
}

export interface KnowledgeDraftApplyResponse {
  created_entities: KnowledgeEntity[];
  created_annotations: Annotation[];
  created_tag_assignments: TagAssignment[];
  errors: Array<{ type: string; index: number; message: string }>;
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

export interface ChannelOption {
  value: string;
  label: string;
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
  aggregated_tags: TagRead[];
}

export interface CodeTarget {
  repo: string;
  version: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string;
  commit: string;
  patch_id: string;
  message_id: string;
  target_ref: string;
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

export interface AnnotationTargetRef {
  target_type: string;
  target_ref: string;
  target_label?: string;
  target_subtitle?: string;
  anchor?: Record<string, unknown>;
  role?: string;
}

export interface Annotation {
  annotation_id: string;
  annotation_type: string;
  short_label: string;
  author: string;
  author_user_id?: string | null;
  visibility: 'public' | 'private';
  publish_status: 'none' | 'pending' | 'approved' | 'rejected';
  body: string;
  pinned: boolean;
  parent_annotation_id: string;
  publish_requested_at?: string | null;
  publish_requested_by_user_id?: string | null;
  publish_reviewed_at?: string | null;
  publish_reviewed_by_user_id?: string | null;
  publish_review_comment?: string;
  created_at: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  related_targets: AnnotationTargetRef[];
  anchor: Record<string, unknown>;
  code_target?: CodeTarget;
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
  short_label?: string;
  author?: string;
  visibility?: 'public' | 'private';
  pinned?: boolean;
  parent_annotation_id?: string;
  target_type?: string;
  target_ref?: string;
  target_label?: string;
  target_subtitle?: string;
  related_targets?: AnnotationTargetRef[];
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

export interface ManualStatsResponse {
  total_chunks: number;
  by_manual_type: Record<string, number>;
  by_content_type: Record<string, number>;
}

// 批注列表相关类型
export interface AnnotationListItem {
  annotation_id: string;
  annotation_type: string;
  short_label: string;
  author: string;
  author_user_id?: string | null;
  visibility: 'public' | 'private';
  publish_status: 'none' | 'pending' | 'approved' | 'rejected';
  body: string;
  pinned: boolean;
  parent_annotation_id: string;
  publish_requested_at?: string | null;
  publish_requested_by_user_id?: string | null;
  publish_reviewed_at?: string | null;
  publish_reviewed_by_user_id?: string | null;
  publish_review_comment?: string;
  created_at: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  related_targets: AnnotationTargetRef[];
  anchor: Record<string, unknown>;
  code_target?: CodeTarget;
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

export type AnnotationRelationType =
  | 'references'
  | 'explains'
  | 'refines'
  | 'contradicts'
  | 'same_variable'
  | 'variable_evolves_to'
  | 'value_passed_to'
  | 'depends_on'
  | 'evidence_for';

export type AnnotationRelationSourceKind = 'manual' | 'markdown_link' | 'system';

export interface AnnotationRelation {
  relation_id: string;
  source_annotation_id: string;
  target_annotation_id: string;
  relation_type: AnnotationRelationType;
  source_kind: AnnotationRelationSourceKind;
  description: string;
  meta: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnotationRelationCreate {
  target_annotation_id: string;
  relation_type?: AnnotationRelationType;
  description?: string;
  meta?: Record<string, unknown>;
}

export interface AnnotationRelationsResponse {
  annotation_id: string;
  relations: AnnotationRelation[];
}

export interface KnowledgeEntity {
  entity_id: string;
  entity_type: string;
  canonical_name: string;
  slug: string;
  aliases: string[];
  summary: string;
  description: string;
  status: string;
  meta: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEntityListResponse {
  entities: KnowledgeEntity[];
  total: number;
  page: number;
  page_size: number;
  search_mode?: 'simple' | 'fulltext';
}

export interface KnowledgeRelation {
  relation_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  description: string;
  evidence_id: string;
  meta: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  source_entity?: KnowledgeEntity | null;
  target_entity?: KnowledgeEntity | null;
}

export interface KnowledgeRelationListResponse {
  outgoing: KnowledgeRelation[];
  incoming: KnowledgeRelation[];
}

export interface KnowledgeEvidence {
  evidence_id: string;
  entity_id: string;
  source_type: string;
  message_id: string;
  thread_id: string;
  claim: string;
  quote: string;
  confidence: string;
  meta: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDraft {
  draft_id: string;
  source_type: string;
  source_ref: string;
  question: string;
  payload: KnowledgeDraftPayload;
  status: string;
  review_note: string;
  created_by: string;
  updated_by: string;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDraftListResponse {
  drafts: KnowledgeDraft[];
  total: number;
  page: number;
  page_size: number;
}

export interface KnowledgeGraphResponse {
  nodes: KnowledgeEntity[];
  edges: KnowledgeRelation[];
  center: string;
  depth: number;
}

export interface KnowledgeStats {
  total_entities: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  total_relations: number;
  recent: KnowledgeEntity[];
}

export interface KnowledgeEntityCreateResponse {
  entity: KnowledgeEntity;
  suggestions: {
    duplicates: KnowledgeEntity[];
  };
}

export interface KnowledgeEntityMergeResponse {
  source: KnowledgeEntity;
  target: KnowledgeEntity;
  moved: Record<string, number>;
}

// ============================================================
// PLAN-31001 Phase 4：变更历史 + 导入导出
// ============================================================

export interface KnowledgeEntityVersion {
  entity_id: string;
  version: number;
  canonical_name: string;
  aliases: string[];
  summary: string;
  description: string;
  status: string;
  meta: Record<string, unknown>;
  change_note: string;
  changed_by: string;
  changed_by_user_id?: string | null;
  changed_at: string;
}

export interface KnowledgeExportEntity {
  entity_id: string;
  entity_type: string;
  canonical_name: string;
  slug?: string;
  aliases?: string[];
  summary?: string;
  description?: string;
  status?: string;
  meta?: Record<string, unknown>;
  created_by?: string;
  updated_by?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface KnowledgeExportRelation {
  relation_id?: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  description?: string;
  evidence_id?: string;
  meta?: Record<string, unknown>;
  created_by?: string;
  updated_by?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface KnowledgeExportPayload {
  schema_version?: number;
  exported_at?: string;
  entity_count?: number;
  relation_count?: number;
  entities: KnowledgeExportEntity[];
  relations: KnowledgeExportRelation[];
}

export interface KnowledgeImportSummary {
  entities_created: number;
  entities_updated: number;
  entities_skipped: number;
  relations_created: number;
  relations_skipped: number;
  errors: string[];
}

// ============================================================
// 内核源码浏览相关类型 (PLAN-10000)
// ============================================================

export interface KernelVersionInfo {
  kind: "release" | "rc";
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


export interface KernelFileResponse {
  version: string;
  path: string;
  content: string;
  line_count: number;
  size: number;
  truncated: boolean;
}

export interface KernelTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'dir';
  size: number;
}

export interface KernelTreeResponse {
  version: string;
  path: string;
  entries: KernelTreeEntry[];
  total: number;
}

export interface KernelResolveResponse {
  source: 'local' | 'elixir' | 'git.kernel.org';
  url: string;
  external_url: string;
  external_source: 'elixir' | 'git.kernel.org';
  local_file_available: boolean;
  resolved_version: string;
  path: string;
  line: number | null;
  line_count: number | null;
  fallback_reason: string | null;
}

export interface KernelSymbolCandidateResponse {
  version: string;
  path: string;
  line: number;
  local_url: string;
  external_url: string;
  local_file_available: boolean;
  source: 'local' | 'elixir';
}

export interface KernelSymbolResolveResponse {
  symbol: string;
  version: string;
  query_url: string;
  source: 'elixir';
  resolved: boolean;
  candidates: KernelSymbolCandidateResponse[];
  fallback_reason: string | null;
}

export interface KernelCommitJumpTarget {
  available: boolean;
  version: string;
  path: string;
  line: number;
  reason?: string | null;
}

export interface KernelCommitPatchLine {
  kind: 'context' | 'add' | 'del' | 'meta';
  text: string;
  old_line?: number | null;
  new_line?: number | null;
}

export interface KernelCommitPatchContextPreview {
  focus_start_line: number;
  focus_end_line: number;
  snippet: string;
  before_lines?: string[];
  after_lines?: string[];
}

export interface KernelCommitPatchHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: KernelCommitPatchLine[];
  context_preview: KernelCommitPatchContextPreview;
  current_version_target: KernelCommitJumpTarget;
  nearest_tag_target: KernelCommitJumpTarget;
}

export interface KernelCommitPatchFile {
  path: string;
  old_path: string;
  new_path: string;
  status: string;
  added: string;
  deleted: string;
  is_binary: boolean;
  truncated: boolean;
  hunks: KernelCommitPatchHunk[];
}

export interface KernelHistoryCommit {
  commit_hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  author_time: string;
  subject: string;
  message?: string;
  trailers: Record<string, string[]>;
  urls: string[];
  lore_links: string[];
  has_lore_link: boolean;
  nearest_tag_version?: string | null;
  files?: KernelCommitPatchFile[];
  changed_files: Array<{
    added: string;
    deleted: string;
    path: string;
  }>;
  patch?: string;
  patch_truncated?: boolean;
  version?: string;
}

export interface KernelLineHistoryResponse {
  version: string;
  path: string;
  start_line: number;
  end_line: number;
  commits: KernelHistoryCommit[];
  total: number;
}

export interface CodeAnnotation {
  annotation_id: string;
  annotation_type: string;
  short_label: string;
  version: string;
  file_path: string;
  start_line: number;
  end_line: number;
  body: string;
  author: string;
  author_user_id?: string | null;
  visibility: 'public' | 'private';
  publish_status: 'none' | 'pending' | 'approved' | 'rejected';
  pinned: boolean;
  publish_requested_at?: string | null;
  publish_requested_by_user_id?: string | null;
  publish_reviewed_at?: string | null;
  publish_reviewed_by_user_id?: string | null;
  publish_review_comment?: string;
  created_at: string;
  parent_annotation_id?: string;
  in_reply_to?: string;
  updated_at: string;
  target_type: string;
  target_ref: string;
  target_label: string;
  target_subtitle: string;
  related_targets: AnnotationTargetRef[];
  anchor: Record<string, unknown>;
  code_target?: CodeTarget;
  meta?: Record<string, unknown>;
}

export interface CodeAnnotationCreate {
  version: string;
  file_path: string;
  start_line: number;
  end_line: number;
  body: string;
  short_label?: string;
  author?: string;
  visibility?: 'public' | 'private';
  pinned?: boolean;
  in_reply_to?: string;
  related_targets?: AnnotationTargetRef[];
}

export interface CodeAnnotationListResponse {
  annotations: CodeAnnotation[];
  total: number;
  page: number;
  page_size: number;
}

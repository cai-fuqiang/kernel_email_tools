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

export interface ThreadResponse {
  thread_id: string;
  emails: ThreadEmail[];
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

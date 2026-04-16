export interface SearchHit {
  message_id: string;
  subject: string;
  sender: string;
  date: string;
  list_name: string;
  thread_id: string;
  has_patch: boolean;
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
  has_patch: boolean;
  body: string;
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

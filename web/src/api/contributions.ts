/**
 * PLAN-34001: 贡献度查询 API 客户端.
 *
 * 查询某 message_id / thread_id 在知识库中留下的痕迹:
 *   - knowledge_evidence_count: 被引用为 knowledge entity 证据的次数
 *   - annotation_count: 关联的批注数
 *   - draft_count: 待审核 knowledge draft 数 (仅 thread 级)
 *
 * 容错原则: lookup 失败必须不阻塞主流程, 返回空结果即可。
 */

export interface ContributionStats {
  knowledge_evidence_count: number;
  annotation_count: number;
  draft_count?: number;
}

export interface ContributionLookupResponse {
  by_message_id: Record<string, ContributionStats>;
  by_thread_id: Record<string, ContributionStats>;
}

const API_BASE = '/api';

export async function lookupContributions(
  messageIds: string[],
  threadIds: string[],
): Promise<ContributionLookupResponse> {
  const deduped = {
    message_ids: Array.from(new Set(messageIds.filter(Boolean))),
    thread_ids: Array.from(new Set(threadIds.filter(Boolean))),
  };

  if (deduped.message_ids.length === 0 && deduped.thread_ids.length === 0) {
    return { by_message_id: {}, by_thread_id: {} };
  }

  try {
    const res = await fetch(`${API_BASE}/contributions/lookup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deduped),
    });
    if (!res.ok) {
      // 轻提示: 失败就当没有贡献度, 不抛异常
      return { by_message_id: {}, by_thread_id: {} };
    }
    const data = (await res.json()) as ContributionLookupResponse;
    return {
      by_message_id: data?.by_message_id || {},
      by_thread_id: data?.by_thread_id || {},
    };
  } catch {
    return { by_message_id: {}, by_thread_id: {} };
  }
}

export function hasContribution(stats?: ContributionStats | null): boolean {
  if (!stats) return false;
  return (
    (stats.knowledge_evidence_count || 0) > 0 ||
    (stats.annotation_count || 0) > 0 ||
    (stats.draft_count || 0) > 0
  );
}
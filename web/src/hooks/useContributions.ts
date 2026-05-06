import { useEffect, useState } from 'react';
import {
  ContributionStats,
  hasContribution,
  lookupContributions,
} from '../api/contributions';

/**
 * PLAN-34001: 共享贡献度查询 hook.
 *
 * 使用方式:
 *   const { byMessageId, byThreadId } = useContributions(messageIds, threadIds);
 *
 * 实现:
 *  - 简单进程内缓存, 同 ID 短期内不重复请求
 *  - 输入变化时增量请求未命中的 ID
 *  - 失败静默回退为空 (lookupContributions 已内部处理)
 */

const CACHE_TTL_MS = 60_000; // 1 分钟内复用结果

interface CacheEntry {
  stats: ContributionStats;
  expireAt: number;
}

const messageCache = new Map<string, CacheEntry>();
const threadCache = new Map<string, CacheEntry>();

function readFromCache(
  cache: Map<string, CacheEntry>,
  ids: string[],
): { hits: Record<string, ContributionStats>; misses: string[] } {
  const now = Date.now();
  const hits: Record<string, ContributionStats> = {};
  const misses: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const entry = cache.get(id);
    if (entry && entry.expireAt > now) {
      hits[id] = entry.stats;
    } else {
      misses.push(id);
    }
  }
  return { hits, misses };
}

function writeToCache(
  cache: Map<string, CacheEntry>,
  ids: string[],
  result: Record<string, ContributionStats>,
) {
  const expireAt = Date.now() + CACHE_TTL_MS;
  for (const id of ids) {
    const stats = result[id] || {
      knowledge_evidence_count: 0,
      annotation_count: 0,
    };
    cache.set(id, { stats, expireAt });
  }
}

export interface UseContributionsResult {
  byMessageId: Record<string, ContributionStats>;
  byThreadId: Record<string, ContributionStats>;
}

export function useContributions(
  messageIds: string[],
  threadIds: string[],
): UseContributionsResult {
  const [byMessageId, setByMessageId] = useState<Record<string, ContributionStats>>({});
  const [byThreadId, setByThreadId] = useState<Record<string, ContributionStats>>({});

  // 用稳定 key 触发副作用
  const messageKey = Array.from(new Set(messageIds.filter(Boolean))).sort().join('|');
  const threadKey = Array.from(new Set(threadIds.filter(Boolean))).sort().join('|');

  useEffect(() => {
    const messageList = messageKey ? messageKey.split('|') : [];
    const threadList = threadKey ? threadKey.split('|') : [];

    const msgRead = readFromCache(messageCache, messageList);
    const thrRead = readFromCache(threadCache, threadList);

    // 先把缓存命中的结果暴露
    setByMessageId(msgRead.hits);
    setByThreadId(thrRead.hits);

    if (msgRead.misses.length === 0 && thrRead.misses.length === 0) return;

    let cancelled = false;
    lookupContributions(msgRead.misses, thrRead.misses)
      .then((resp) => {
        if (cancelled) return;
        writeToCache(messageCache, msgRead.misses, resp.by_message_id);
        writeToCache(threadCache, thrRead.misses, resp.by_thread_id);
        setByMessageId({ ...msgRead.hits, ...resp.by_message_id });
        setByThreadId({ ...thrRead.hits, ...resp.by_thread_id });
      })
      .catch(() => {
        // lookupContributions 已内部静默, 这里再兜底一次
      });

    return () => {
      cancelled = true;
    };
  }, [messageKey, threadKey]);

  return { byMessageId, byThreadId };
}

export { hasContribution };
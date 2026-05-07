import { useEffect, useState } from 'react';
import { searchEmails, listAnnotations, getTagTree } from '../../api/client';
import type { AnnotationListItem, SearchHit, TagTree } from '../../api/types';
import type { WorkspaceEntity } from '../types';
import { emailHitToEntity } from '../adapters/emailHit';
import { annotationToEntity } from '../adapters/annotation';
import { flattenTagTreeToEntities } from '../adapters/tag';

export type WorkspaceView = 'email' | 'tag' | 'annotation';

export interface WorkspaceFilters {
  q: string;
  // Email view filters
  mode?: 'hybrid' | 'keyword' | 'semantic';
  list_name?: string;
  sender?: string;
  date_from?: string; // yyyy-MM-dd
  date_to?: string;
  has_patch?: boolean;
  tags?: string[];
  tag_mode?: 'any' | 'all';
  sort_by?: '' | 'date';
  sort_order?: '' | 'asc' | 'desc';
  // Annotation view filters
  annotation_type?: 'all' | 'email' | 'code' | 'sdm_spec';
  publish_status?: 'all' | 'pending' | 'approved' | 'rejected';
}

export interface WorkspaceDataState {
  entities: WorkspaceEntity[];
  rawEmailHits: SearchHit[];
  rawAnnotations: AnnotationListItem[];
  rawTags: TagTree[];
  total: number;
  loading: boolean;
  error: string | null;
  /** 触发当前 view+filters 组合的重新拉取。 */
  refresh: () => void;
}

const EMPTY_STATE: Omit<WorkspaceDataState, 'refresh'> = {
  entities: [],
  rawEmailHits: [],
  rawAnnotations: [],
  rawTags: [],
  total: 0,
  loading: false,
  error: null,
};

function hasEmailSearchCondition(f: WorkspaceFilters): boolean {
  return Boolean(
    (f.q && f.q.trim()) ||
      f.sender ||
      f.date_from ||
      f.date_to ||
      f.has_patch !== undefined ||
      (f.tags && f.tags.length > 0) ||
      (f.list_name && f.list_name.trim()),
  );
}

/**
 * 按 view + filters 拉取数据并通过 adapter 转为 WorkspaceEntity。
 *
 * Stage 1 约束：每个 view 只调一个主 API，不做跨源合并分页。
 */
export function useWorkspaceData(
  view: WorkspaceView,
  filters: WorkspaceFilters,
  page: number,
  pageSize: number,
): WorkspaceDataState {
  const [state, setState] = useState<Omit<WorkspaceDataState, 'refresh'>>(EMPTY_STATE);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey((k) => k + 1);

  // 把非基本类型和易变字段拍平到基本类型，给 effect 做稳定依赖
  const tagsKey = JSON.stringify(filters.tags || []);
  const {
    q,
    mode,
    list_name,
    sender,
    date_from,
    date_to,
    has_patch,
    tag_mode,
    sort_by,
    sort_order,
    annotation_type,
    publish_status,
  } = filters;

  useEffect(() => {
    let cancelled = false;

    // email view：无任何搜索条件时不发请求（后端要求至少一个条件）
    if (view === 'email' && !hasEmailSearchCondition(filters)) {
      setState({ ...EMPTY_STATE });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    const task = async (): Promise<Omit<WorkspaceDataState, 'refresh'>> => {
      if (view === 'email') {
        const res = await searchEmails(q || '', {
          mode,
          list_name: list_name || undefined,
          sender: sender || undefined,
          date_from: date_from || undefined,
          date_to: date_to || undefined,
          has_patch,
          tags: filters.tags && filters.tags.length > 0 ? filters.tags : undefined,
          tag_mode,
          sort_by: sort_by || undefined,
          sort_order: sort_order || undefined,
          page,
          page_size: pageSize,
        });
        return {
          entities: res.hits.map(emailHitToEntity),
          rawEmailHits: res.hits,
          rawAnnotations: [],
          rawTags: [],
          total: res.total,
          loading: false,
          error: null,
        };
      }

      if (view === 'annotation') {
        const res = await listAnnotations({
          q: q || undefined,
          type: annotation_type && annotation_type !== 'all' ? annotation_type : undefined,
          publish_status:
            publish_status && publish_status !== 'all' ? publish_status : undefined,
          page,
          page_size: pageSize,
        });
        return {
          entities: res.annotations.map(annotationToEntity),
          rawEmailHits: [],
          rawAnnotations: res.annotations,
          rawTags: [],
          total: res.total,
          loading: false,
          error: null,
        };
      }

      // view === 'tag'
      const tree = await getTagTree(false);
      const flat = flattenTagTreeToEntities(tree);
      const qq = (q || '').toLowerCase().trim();
      const filtered = qq
        ? flat.filter((e) => e.title.toLowerCase().includes(qq) || (e.excerpt || '').toLowerCase().includes(qq))
        : flat;
      return {
        entities: filtered,
        rawEmailHits: [],
        rawAnnotations: [],
        rawTags: tree,
        total: filtered.length,
        loading: false,
        error: null,
      };
    };

    task()
      .then((next) => !cancelled && setState(next))
      .catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: String(e) })));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    q,
    mode,
    list_name,
    sender,
    date_from,
    date_to,
    has_patch,
    tagsKey,
    tag_mode,
    sort_by,
    sort_order,
    annotation_type,
    publish_status,
    page,
    pageSize,
    reloadKey,
  ]);

  return { ...state, refresh };
}
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
  list_name?: string;
  has_patch?: boolean;
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
  const [state, setState] = useState<WorkspaceDataState>({
    entities: [],
    rawEmailHits: [],
    rawAnnotations: [],
    rawTags: [],
    total: 0,
    loading: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const task = async (): Promise<WorkspaceDataState> => {
      if (view === 'email') {
        const res = await searchEmails(filters.q || '', {
          list_name: filters.list_name || undefined,
          has_patch: filters.has_patch,
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
          q: filters.q || undefined,
          type: filters.annotation_type && filters.annotation_type !== 'all' ? filters.annotation_type : undefined,
          publish_status:
            filters.publish_status && filters.publish_status !== 'all' ? filters.publish_status : undefined,
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
      const q = (filters.q || '').toLowerCase().trim();
      const filtered = q
        ? flat.filter((e) => e.title.toLowerCase().includes(q) || (e.excerpt || '').toLowerCase().includes(q))
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
  }, [view, filters.q, filters.list_name, filters.has_patch, filters.annotation_type, filters.publish_status, page, pageSize]);

  return state;
}
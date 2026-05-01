import type { ThreadEmail, Annotation } from '../api/types';

/**
 * 线程节点：邮件 / 批注混合树的统一节点类型。
 * - 真实邮件：`isAnnotation` 缺省，`email` 来自 `ThreadEmail`
 * - 批注：`isAnnotation = true`，`annotation` 持有原始批注对象，`email` 是包装的虚拟节点
 */
export interface ThreadNode {
  email: ThreadEmail;
  children: ThreadNode[];
  depth: number;
  isAnnotation?: boolean;
  annotation?: Annotation;
}

export type FoldLevel = 'expanded' | 'body_only' | 'collapsed';
export type ViewMode = 'tree' | 'layered';

/** 段落原文 → 翻译状态映射（缓存中文翻译 / loading / error） */
export type TranslationMap = Map<string, { translation: string; loading: boolean; error?: string }>;

/** 简单hash 函数用于生成批注的虚拟数字 ID */
export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/** 段落 anchor，用于翻译缓存键 */
export function getParagraphAnchor(text: string, index: number): Record<string, unknown> {
  return {
    paragraph_index: index,
    paragraph_hash: String(hashCode(text.trim())).padStart(8, '0'),
  };
}

/**
 * 构建线程（含批注混入）。
 *
 * - 批注转换为虚拟 `ThreadNode`（`isAnnotation=true`），`email.id` 取批注 ID 哈希的负值避免与真实邮件冲突
 * - 通过 `in_reply_to` 挂到对应邮件 / 批注节点下
 * - 排序：批注节点排在同级最前；同类型按日期升序
 * - 重新计算 depth 保证多级缩进正确
 */
export function buildThreadTree(emails: ThreadEmail[], annotations: Annotation[] = []): ThreadNode[] {
  const nodes: Map<string, ThreadNode> = new Map();
  const roots: ThreadNode[] = [];

  // 先创建邮件节点
  emails.forEach(email => {
    nodes.set(email.message_id, { email, children: [], depth: 0 });
  });

  // 将批注转为虚拟 ThreadNode 混入
  annotations.forEach(ann => {
    const fakeEmail: ThreadEmail = {
      id: -Math.abs(hashCode(ann.annotation_id)),  // 负数 ID 避免和真实邮件冲突
      message_id: ann.annotation_id,
      subject: '批注',
      sender: ann.author,
      date: ann.created_at,
      in_reply_to: ann.in_reply_to,
      references: [],
      has_patch: false,
      patch_content: '',
      body: ann.body,
      body_raw: '',
    };
    nodes.set(ann.annotation_id, {
      email: fakeEmail,
      children: [],
      depth: 0,
      isAnnotation: true,
      annotation: ann,
    });
  });

  // 构建父子关系
  nodes.forEach((node) => {
    const replyTo = node.email.in_reply_to;
    if (replyTo) {
      const parent = nodes.get(replyTo);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  const sortChildren = (children: ThreadNode[]) => {
    children.sort((a, b) => {
      // 批注优先排在最前面
      if (a.isAnnotation && !b.isAnnotation) return -1;
      if (!a.isAnnotation && b.isAnnotation) return 1;
      // 同类型按日期升序
      const dateA = a.email.date ? new Date(a.email.date).getTime() : 0;
      const dateB = b.email.date ? new Date(b.email.date).getTime() : 0;
      return dateA - dateB;
    });
    children.forEach(node => sortChildren(node.children));
  };
  sortChildren(roots);

  const recalcDepth = (children: ThreadNode[], depth: number) => {
    children.forEach(node => {
      node.depth = depth;
      recalcDepth(node.children, depth + 1);
    });
  };
  recalcDepth(roots, 0);

  return roots;
}

/** 收集节点下所有后代的 email.id（不含自身） */
export function collectDescendantIds(node: ThreadNode): number[] {
  const ids: number[] = [];
  const walk = (n: ThreadNode) => {
    for (const child of n.children) {
      ids.push(child.email.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}

/** 计算节点下所有后代的总数（不含自身） */
export function countDescendants(node: ThreadNode): number {
  let count = 0;
  const walk = (n: ThreadNode) => {
    for (const child of n.children) {
      count++;
      walk(child);
    }
  };
  walk(node);
  return count;
}

/** 把树展平为 `email.id -> node` 映射表 */
export function buildNodeMap(roots: ThreadNode[]): Map<number, ThreadNode> {
  const map = new Map<number, ThreadNode>();
  const walk = (node: ThreadNode) => {
    map.set(node.email.id, node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return map;
}

/**
 * 计算分层模式下可见的节点列表（扁平化）。
 *
 * 规则：
 * - 根节点始可见
 * - 子节点仅当其直接父节点被展开时可见
 */
export function getVisibleNodes(roots: ThreadNode[], expandedIds: Set<number>): ThreadNode[] {
  const visible: ThreadNode[] = [];
  const walk = (children: ThreadNode[], parentExpanded: boolean) => {
    for (const node of children) {
      if (node.depth === 0 || parentExpanded) {
        visible.push(node);
        const isExpanded = expandedIds.has(node.email.id);
        walk(node.children, isExpanded);
      }
    }
  };
  walk(roots, true);
  return visible;
}
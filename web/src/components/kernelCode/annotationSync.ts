import type { CodeAnnotation } from '../../api/types';

export type AnnotationRange = { start: number; end: number };
export type SyncSource = 'code' | 'annotation' | 'jump' | null;

export type RollerItem = {
  annotation: CodeAnnotation;
  position: number;
  active: boolean;
};

export type LineMarker = {
  kind: 'none' | 'dot' | 'range';
  selected: boolean;
  active: boolean;
  annotationCount: number;
};

export type RollerCardPosition = {
  id: string;
  top: number;
  height: number;
};

export type PeerScrollAction = 'passive-scroll' | 'explicit-jump';
export type PeerScrollSource = 'code' | 'annotation';

function numericField(source: Record<string, unknown> | undefined, key: string): number {
  const value = source?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isRootAnnotation(annotation: CodeAnnotation): boolean {
  return !annotation.in_reply_to;
}

function isValidAnnotationRange(range: AnnotationRange): boolean {
  return range.start > 0;
}

function hasValidRange(annotation: CodeAnnotation): boolean {
  return isValidAnnotationRange(getAnnotationLineRange(annotation));
}

export function getAnnotationLineRange(annotation: CodeAnnotation): AnnotationRange {
  const codeTarget = annotation.code_target as Record<string, unknown> | undefined;
  const metaCodeTarget = annotation.meta?.code_target as Record<string, unknown> | undefined;
  const start =
    annotation.start_line ||
    numericField(annotation.anchor, 'start_line') ||
    numericField(codeTarget, 'start_line') ||
    numericField(metaCodeTarget, 'start_line');
  const end =
    annotation.end_line ||
    numericField(annotation.anchor, 'end_line') ||
    numericField(codeTarget, 'end_line') ||
    numericField(metaCodeTarget, 'end_line') ||
    start;

  return {
    start,
    end: end > 0 ? Math.max(start, end) : start,
  };
}

export function lineDistanceToRange(line: number, range: AnnotationRange): number {
  if (range.start <= line && line <= range.end) return 0;
  if (line < range.start) return range.start - line;
  return line - range.end;
}

export function pickActiveAnnotation(
  annotations: CodeAnnotation[],
  centerLine: number | null,
): CodeAnnotation | null {
  if (!centerLine || annotations.length === 0) return null;
  return (
    annotations
      .filter((annotation) => isRootAnnotation(annotation) && hasValidRange(annotation))
      .slice()
      .sort((a, b) => {
        const aRange = getAnnotationLineRange(a);
        const bRange = getAnnotationLineRange(b);
        const distanceDelta = lineDistanceToRange(centerLine, aRange) - lineDistanceToRange(centerLine, bRange);
        if (distanceDelta !== 0) return distanceDelta;
        return aRange.start - bRange.start;
      })[0] || null
  );
}

export function rankRollerItems(annotations: CodeAnnotation[], activeAnnotationId: string | null): RollerItem[] {
  const roots = annotations
    .filter(isRootAnnotation)
    .slice()
    .sort((a, b) => getAnnotationLineRange(a).start - getAnnotationLineRange(b).start);
  const activeIndex = Math.max(0, roots.findIndex((annotation) => annotation.annotation_id === activeAnnotationId));

  return roots.map((annotation, index) => ({
    annotation,
    position: index - activeIndex,
    active: annotation.annotation_id === activeAnnotationId,
  }));
}

export function pickRollerActiveAnnotationId({
  scrollTop,
  clientHeight,
  scrollHeight,
  cards,
  edgeThreshold = 2,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  cards: RollerCardPosition[];
  edgeThreshold?: number;
}): string | null {
  const validCards = cards.filter((card) => card.id && card.height > 0);
  if (validCards.length === 0) return null;
  if (scrollTop <= edgeThreshold) return validCards[0].id;
  if (scrollTop + clientHeight >= scrollHeight - edgeThreshold) return validCards[validCards.length - 1].id;

  const center = scrollTop + clientHeight / 2;
  return validCards
    .slice()
    .sort((a, b) => {
      const aDistance = Math.abs(a.top + a.height / 2 - center);
      const bDistance = Math.abs(b.top + b.height / 2 - center);
      return aDistance - bDistance;
    })[0].id;
}

export function buildLineMarker({
  line,
  annotations,
  selectedLines,
  activeAnnotationId,
}: {
  line: number;
  annotations: CodeAnnotation[];
  selectedLines: Set<number>;
  activeAnnotationId: string | null;
}): LineMarker {
  const selected = selectedLines.has(line);
  const selectedRange = selected && selectedLines.size > 1;
  const matching = annotations.filter((annotation) => {
    if (!isRootAnnotation(annotation)) return false;
    const range = getAnnotationLineRange(annotation);
    if (!isValidAnnotationRange(range)) return false;
    return range.start <= line && line <= range.end;
  });
  const hasMultiLineAnnotation = matching.some((annotation) => {
    const range = getAnnotationLineRange(annotation);
    return range.end > range.start;
  });
  const active = matching.some((annotation) => annotation.annotation_id === activeAnnotationId);

  if (selectedRange || hasMultiLineAnnotation) {
    return { kind: 'range', selected, active, annotationCount: matching.length };
  }
  if (selected || matching.length > 0) {
    return { kind: 'dot', selected, active, annotationCount: matching.length };
  }
  return { kind: 'none', selected: false, active: false, annotationCount: 0 };
}

export function shouldAllowSync({
  source,
  requestedBy,
  now,
  lockedUntil,
}: {
  source: SyncSource;
  requestedBy: Exclude<SyncSource, null>;
  now: number;
  lockedUntil: number;
}): boolean {
  if (!source) return true;
  if (now >= lockedUntil) return true;
  return source === requestedBy;
}

export function shouldScrollPeer({
  followEnabled,
  action,
  source,
}: {
  followEnabled: boolean;
  action: PeerScrollAction;
  source: PeerScrollSource;
}): boolean {
  if (action === 'passive-scroll' && source === 'code') return true;
  return action === 'explicit-jump' || followEnabled;
}

export function resolveCodeAutoScrollLine({
  fileChanged,
  focusLine,
}: {
  fileChanged: boolean;
  focusLine: number | null;
}): number | null {
  if (focusLine && focusLine > 0) return focusLine;
  return fileChanged ? 1 : null;
}

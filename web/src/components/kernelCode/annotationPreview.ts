import type { CodeAnnotation } from '../../api/types';
import { getAnnotationLineRange } from './annotationSync';

export interface AnnotationPreviewState {
  target: CodeAnnotation | null;
  replies: CodeAnnotation[];
  missing: boolean;
}

type ClosestCapableTarget = {
  closest?: (selector: string) => unknown;
  parentElement?: ClosestCapableTarget | null;
};

type IsolatedClickEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function formatAnnotationPreviewLineRange(annotation: CodeAnnotation): string {
  const { start, end } = getAnnotationLineRange(annotation);
  if (start <= 0) return 'Line unknown';
  return `L${start}${end !== start ? `-${end}` : ''}`;
}

export function annotationPreviewStartLine(annotation: CodeAnnotation | null): number | null {
  if (!annotation) return null;
  const { start } = getAnnotationLineRange(annotation);
  return start > 0 ? start : null;
}

export function resolveAnnotationPreviewState(
  annotations: CodeAnnotation[],
  annotationId: string | null | undefined,
): AnnotationPreviewState {
  const id = annotationId?.trim() || '';
  if (!id) return { target: null, replies: [], missing: false };

  const target = annotations.find((annotation) => annotation.annotation_id === id) || null;
  const replies = target
    ? annotations.filter((annotation) =>
        annotation.in_reply_to === target.annotation_id ||
        annotation.parent_annotation_id === target.annotation_id,
      )
    : [];

  return {
    target,
    replies,
    missing: !target,
  };
}

export function handleAnnotationPreviewButtonClick(
  annotation: CodeAnnotation,
  event: IsolatedClickEvent,
  onPreview: (annotation: CodeAnnotation) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  onPreview(annotation);
}

export function shouldIgnoreAnnotationCardClick(target: EventTarget | ClosestCapableTarget | null): boolean {
  const maybeElement = target as ClosestCapableTarget | null;
  const closestSource =
    maybeElement && typeof maybeElement.closest === 'function'
      ? maybeElement
      : maybeElement?.parentElement && typeof maybeElement.parentElement.closest === 'function'
        ? maybeElement.parentElement
        : null;

  if (!closestSource) return true;
  const closest = closestSource.closest;
  if (typeof closest !== 'function') return true;
  return Boolean(
    closest.call(closestSource, 'button, a, input, textarea, select, label, [contenteditable="true"], [data-no-annotation-select]'),
  );
}

import { describe, expect, it } from 'vitest';

import {
  getKernelRangeTaggingLabel,
  getSupportedKnowledgeAnnotationTypes,
  shouldShowSecondaryKernelRangeTagging,
} from '../AnnotationPanel';

describe('AnnotationPanel kernel range tagging affordance', () => {
  it('treats line-range tagging as a secondary action', () => {
    expect(shouldShowSecondaryKernelRangeTagging()).toBe(true);
    expect(getKernelRangeTaggingLabel()).toBe('Advanced: tag selected lines');
  });

  it('supports claim and summary knowledge annotation categories', () => {
    expect(getSupportedKnowledgeAnnotationTypes()).toEqual(['claim', 'summary', 'link', 'note']);
  });
});

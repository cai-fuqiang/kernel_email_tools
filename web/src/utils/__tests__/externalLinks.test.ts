import { describe, expect, it } from 'vitest';
import {
  annotationSearchPath,
  kernelAnnotationPreviewPath,
  localAnnotationSearchUrl,
  localKernelAnnotationPreviewUrl,
} from '../externalLinks';

describe('annotation preview links', () => {
  it('builds a shareable annotation preview route from version, path, and annotation id', () => {
    expect(
      kernelAnnotationPreviewPath('v6.7-rc7', 'crypto/algif_aead.c', 'ann 123'),
    ).toBe('/kernel-code/annotation-preview?v=v6.7-rc7&path=crypto%2Falgif_aead.c&annotation=ann+123');
  });

  it('builds the app-prefixed annotation preview URL for anchors', () => {
    expect(
      localKernelAnnotationPreviewUrl('v6.7-rc7', 'crypto/algif_aead.c', 'ann-123'),
    ).toBe('/app/kernel-code/annotation-preview?v=v6.7-rc7&path=crypto%2Falgif_aead.c&annotation=ann-123');
  });

  it('builds universal annotation search route from annotation id', () => {
    expect(annotationSearchPath('ann 123')).toBe('/annotations?q=ann+123');
    expect(localAnnotationSearchUrl('ann-123')).toBe('/app/annotations?q=ann-123');
  });
});

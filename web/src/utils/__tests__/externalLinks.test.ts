import { describe, expect, it } from 'vitest';
import {
  annotationSearchPath,
  bootlinSourceUrl,
  codeBrowserPath,
  kernelAnnotationPreviewPath,
  kernelCodePath,
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

describe('generic code browser links', () => {
  it('builds a repository-specific code browser path', () => {
    expect(codeBrowserPath('qemu', 'master', 'hw/core/machine.c', 88)).toBe(
      '/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=88',
    );
  });

  it('keeps the kernel code path stable for existing links', () => {
    expect(kernelCodePath('v6.8', 'mm/vmscan.c', 12)).toBe(
      '/kernel-code?v=v6.8&path=mm%2Fvmscan.c&line=12',
    );
  });

  it('builds Bootlin source URLs from a repository base', () => {
    expect(
      bootlinSourceUrl('https://elixir.bootlin.com/qemu', 'master', 'hw/core/machine.c', 88),
    ).toBe('https://elixir.bootlin.com/qemu/master/source/hw/core/machine.c#L88');
  });
});

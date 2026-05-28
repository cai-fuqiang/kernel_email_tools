import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildRepositoryLocationToPersist,
  buildCodeRepositorySavedLocationRoute,
  buildCodeRepositorySelectOptions,
  buildCodeSymbolCandidateHref,
  buildKernelCodeSelectionMarkdownDragPayload,
  buildAnnotationPreviewAtlasPath,
  isCodeSymbolCandidateLocalJump,
  canRunRepositoryUrlEffects,
  isRepositoryStateResetComplete,
  shouldNotifyRepositoryResetComplete,
  shouldResetRepositoryState,
  clampRequestedLine,
  readSavedRepositoryLocation,
  repositoryLocationStorageKey,
  writeSavedRepositoryLocation,
} from '../KernelCodePage';

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
});

describe('clampRequestedLine', () => {
  it('clamps a requested line to the file line count', () => {
    expect(clampRequestedLine(159, 42)).toBe(42);
  });

  it('keeps an in-range line unchanged', () => {
    expect(clampRequestedLine(12, 42)).toBe(12);
  });

  it('returns null for missing or invalid requested lines', () => {
    expect(clampRequestedLine(null, 42)).toBeNull();
    expect(clampRequestedLine(0, 42)).toBeNull();
  });
});

describe('buildKernelCodeSelectionMarkdownDragPayload', () => {
  it('builds a fenced code preview with a link back to the selected range', () => {
    const payload = buildKernelCodeSelectionMarkdownDragPayload({
      version: 'v6.6',
      filePath: 'mm/mmap.c',
      rangeLabel: 'L123-L124',
      startLine: 123,
      selectedText: 'static int example(void)\n{\n}',
      origin: 'http://aliyun.cloud.vm:8080',
    });

    expect(payload.markdown).toContain('[code: mm/mmap.c L123-L124](http://aliyun.cloud.vm:8080/app/kernel-code?v=v6.6&path=mm%2Fmmap.c&line=123)');
    expect(payload.markdown).toContain('```c');
    expect(payload.markdown).toContain('static int example(void)');
    expect(payload.plainText).toBe(payload.markdown);
  });

  it('can build a fenced code preview for a configured non-kernel repository', () => {
    const payload = buildKernelCodeSelectionMarkdownDragPayload({
      repoId: 'qemu',
      version: 'master',
      filePath: 'hw/core/machine.c',
      rangeLabel: 'L88',
      startLine: 88,
      selectedText: 'void machine_run_board_init(void)',
      origin: 'http://aliyun.cloud.vm:8080',
    });

    expect(payload.markdown).toContain('[code: hw/core/machine.c L88](http://aliyun.cloud.vm:8080/app/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=88)');
  });
});

describe('buildCodeRepositorySelectOptions', () => {
  it('builds repository select labels and route targets with linux active for the legacy route', () => {
    const options = buildCodeRepositorySelectOptions(
      [
        { id: 'linux', name: 'Linux Kernel', default_version: 'v6.6' },
        { id: 'qemu', name: 'QEMU', default_version: 'master' },
      ],
      undefined,
    );

    expect(options).toEqual([
      { id: 'linux', label: 'Linux Kernel', value: 'linux', selected: true, targetPath: '/kernel-code' },
      { id: 'qemu', label: 'QEMU', value: 'qemu', selected: false, targetPath: '/code/qemu' },
    ]);
  });
});

describe('source code route helpers', () => {
  it('opens annotation preview atlas targets through the active non-linux repository route', () => {
    expect(buildAnnotationPreviewAtlasPath({
      repoId: 'qemu',
      selectedVersion: 'master',
      currentPath: 'hw/core/machine.c',
      annotation: {
        annotation_id: 'ann-1',
        version: 'master',
        file_path: 'hw/core/machine.c',
        start_line: 88,
        end_line: 88,
      },
    })).toBe('/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=88');
  });

  it('rebuilds local symbol candidate links from the active repository instead of trusting linux local_url', () => {
    expect(buildCodeSymbolCandidateHref('qemu', {
      local_file_available: true,
      local_url: '/app/kernel-code?v=master&path=hw%2Fcore%2Fmachine.c&line=88',
      external_url: 'https://example.invalid/qemu/source',
      version: 'master',
      path: 'hw/core/machine.c',
      line: 88,
    })).toBe('/app/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=88');
  });

  it('keeps non-linux symbol candidate jumps inside the active repository even when external_url points at Linux Elixir', () => {
    expect(buildCodeSymbolCandidateHref('qemu', {
      local_file_available: false,
      local_url: null,
      external_url: 'https://elixir.bootlin.com/linux/v11.0.0/source/chardev/char-serial.c',
      version: 'v11.0.0',
      path: 'chardev/char-serial.c',
      line: 1,
    })).toBe('/app/code/qemu?v=v11.0.0&path=chardev%2Fchar-serial.c&line=1');
  });

  it('treats non-linux symbol candidate jumps as local app navigation', () => {
    expect(isCodeSymbolCandidateLocalJump('qemu', { local_file_available: false })).toBe(true);
    expect(isCodeSymbolCandidateLocalJump('linux', { local_file_available: false })).toBe(false);
  });
});

describe('repository transition guards', () => {
  it('resets repo-owned state on repo transition even when version and path match', () => {
    expect(shouldResetRepositoryState({
      stateRepoId: 'linux',
      repoId: 'qemu',
    })).toBe(true);
  });

  it('does not reset repo-owned state when the repo is unchanged', () => {
    expect(shouldResetRepositoryState({
      stateRepoId: 'qemu',
      repoId: 'qemu',
    })).toBe(false);
  });

  it('does not mark repo reset complete while stale file state remains even if version and path match', () => {
    expect(isRepositoryStateResetComplete({
      selectedVersion: 'master',
      urlVersion: 'master',
      currentPath: 'hw/core/machine.c',
      urlPath: 'hw/core/machine.c',
      currentPathKind: 'file',
      hasCurrentFile: true,
    })).toBe(false);
  });

  it('marks repo reset complete after URL state is applied and repo-owned file state is cleared', () => {
    expect(isRepositoryStateResetComplete({
      selectedVersion: 'master',
      urlVersion: 'master',
      currentPath: 'hw/core/machine.c',
      urlPath: 'hw/core/machine.c',
      currentPathKind: null,
      hasCurrentFile: false,
    })).toBe(true);
  });

  it('notifies URL effects once reset completes for a pending repo transition', () => {
    expect(shouldNotifyRepositoryResetComplete({
      stateRepoId: 'linux',
      repoId: 'qemu',
      resetComplete: true,
    })).toBe(true);
  });

  it('does not notify URL effects when reset is incomplete or repo is already current', () => {
    expect(shouldNotifyRepositoryResetComplete({
      stateRepoId: 'linux',
      repoId: 'qemu',
      resetComplete: false,
    })).toBe(false);
    expect(shouldNotifyRepositoryResetComplete({
      stateRepoId: 'qemu',
      repoId: 'qemu',
      resetComplete: true,
    })).toBe(false);
  });

  it('skips URL open and persistence while component state still belongs to the previous repo', () => {
    expect(canRunRepositoryUrlEffects({
      stateRepoId: 'linux',
      repoId: 'qemu',
    })).toBe(false);
  });

  it('allows URL open and persistence for initial load or after repo reset completes', () => {
    expect(canRunRepositoryUrlEffects({
      stateRepoId: 'qemu',
      repoId: 'qemu',
    })).toBe(true);
  });
});

describe('repository last-location helpers', () => {
  it('builds repo-scoped localStorage keys', () => {
    expect(repositoryLocationStorageKey('qemu')).toBe('code-browser:last-location:qemu');
  });

  it('writes and reads saved repository locations', () => {
    writeSavedRepositoryLocation('qemu', {
      version: 'master',
      path: 'hw/core/machine.c',
      line: 12,
      annotationId: null,
    });

    expect(readSavedRepositoryLocation('qemu')).toEqual({
      version: 'master',
      path: 'hw/core/machine.c',
      line: 12,
      annotationId: null,
    });
  });

  it('returns null for invalid saved JSON', () => {
    localStorage.setItem(repositoryLocationStorageKey('qemu'), '{nope');

    expect(readSavedRepositoryLocation('qemu')).toBeNull();
  });

  it('returns null when storage reads throw', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
      },
    });

    expect(readSavedRepositoryLocation('qemu')).toBeNull();
  });

  it('swallows storage write errors', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error('storage unavailable');
        },
      },
    });

    expect(() => writeSavedRepositoryLocation('qemu', {
      version: 'master',
      path: 'hw/core/machine.c',
      line: 12,
      annotationId: null,
    })).not.toThrow();
  });

  it('prefers current selectedVersion over missing URL version while preserving URL target fields', () => {
    expect(buildRepositoryLocationToPersist({
      selectedVersion: 'master',
      currentPath: '',
      urlVersion: '',
      urlPath: 'hw/core/machine.c',
      urlLine: 12,
      urlAnnotationId: 'ann-1',
    })).toEqual({
      version: 'master',
      path: 'hw/core/machine.c',
      line: 12,
      annotationId: 'ann-1',
    });
  });

  it('builds a qemu route from a saved location', () => {
    expect(buildCodeRepositorySavedLocationRoute('qemu', {
      version: 'master',
      path: 'hw/core/machine.c',
      line: 12,
      annotationId: null,
    })).toBe('/code/qemu?v=master&path=hw%2Fcore%2Fmachine.c&line=12');
  });

  it('builds a linux route from a saved location', () => {
    expect(buildCodeRepositorySavedLocationRoute('linux', {
      version: 'v6.6',
      path: 'mm/mmap.c',
      line: 42,
      annotationId: null,
    })).toBe('/kernel-code?v=v6.6&path=mm%2Fmmap.c&line=42');
  });
});

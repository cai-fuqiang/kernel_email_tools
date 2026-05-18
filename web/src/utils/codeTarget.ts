export interface CodeTarget {
  repo: string;
  version: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string;
  commit: string;
  patch_id: string;
  message_id: string;
  target_ref: string;
}

type MaybeCodeTarget = Partial<CodeTarget> & {
  file_path?: string;
  anchor?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  code_target?: Partial<CodeTarget> | null;
  target_ref?: string;
  version?: string;
  start_line?: number;
  end_line?: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeCodeTarget(input?: MaybeCodeTarget | null): CodeTarget | null {
  if (!input) return null;
  const nested = input.code_target || {};
  const anchor = input.anchor || {};
  const meta = input.meta || {};

  let version = asString(nested.version || input.version || anchor.version || meta.version);
  let path = asString(nested.path || input.path || input.file_path || anchor.file_path || meta.file_path).replace(/^\/+/, '');

  const targetRef = asString(nested.target_ref || input.target_ref);
  if ((!version || !path) && targetRef.includes(':')) {
    const [refVersion, ...rest] = targetRef.split(':');
    version = version || refVersion;
    path = path || rest.join(':').replace(/^\/+/, '');
  }

  const startLine = asNumber(
    nested.start_line ?? input.start_line ?? anchor.start_line ?? meta.start_line,
  );
  let endLine = asNumber(
    nested.end_line ?? input.end_line ?? anchor.end_line ?? meta.end_line,
  );
  if (startLine > 0 && endLine <= 0) endLine = startLine;
  if (!version || !path) return null;

  return {
    repo: asString(nested.repo || input.repo || meta.repo) || 'linux',
    version,
    path,
    start_line: startLine,
    end_line: endLine,
    symbol: asString(nested.symbol || input.symbol || anchor.symbol || meta.symbol),
    commit: asString(nested.commit || input.commit || anchor.commit || meta.commit),
    patch_id: asString(nested.patch_id || input.patch_id || anchor.patch_id || meta.patch_id),
    message_id: asString(nested.message_id || input.message_id || anchor.message_id || meta.message_id),
    target_ref: targetRef || `${version}:${path}`,
  };
}

export function codeTargetToKernelCodeUrl(target: CodeTarget, annotationId?: string): string {
  const params = new URLSearchParams({ v: target.version, path: target.path });
  if (target.start_line > 0) params.set('line', String(target.start_line));
  if (annotationId) params.set('annotation', annotationId);
  return `/kernel-code?${params.toString()}`;
}

export function withNormalizedCodeTarget<T extends object>(
  input: T,
): T & { code_target?: CodeTarget; meta?: Record<string, unknown> } {
  const codeTarget = normalizeCodeTarget(input as MaybeCodeTarget);
  if (!codeTarget) return input;
  return {
    ...input,
    code_target: codeTarget,
    meta: {
      ...(((input as { meta?: Record<string, unknown> }).meta) || {}),
      code_target: codeTarget,
    },
  };
}

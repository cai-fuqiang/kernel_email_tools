import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { resolveKernelSource } from '../api/client';
import type { KernelResolveResponse } from '../api/types';
import { localKernelCodeUrl } from '../utils/externalLinks';

interface KernelSourceLinkProps {
  version: string;
  path: string;
  line?: number;
  children: ReactNode;
  className?: string;
  title?: string;
  target?: '_self' | '_blank';
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export default function KernelSourceLink({
  version,
  path,
  line,
  children,
  className,
  title,
  target = '_self',
  onClick,
}: KernelSourceLinkProps) {
  const initialHref = useMemo(
    () => localKernelCodeUrl(version, path, line),
    [line, path, version],
  );
  const [resolved, setResolved] = useState<KernelResolveResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveKernelSource(version, path, line)
      .then((res) => {
        if (!cancelled) setResolved(res);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [line, path, version]);

  const href = resolved?.url || initialHref;
  const isExternal = resolved ? resolved.source !== 'local' : target === '_blank';
  const sourceLabel =
    resolved?.source === 'local'
      ? '本地 Code Browser'
      : resolved?.source === 'elixir'
        ? 'Elixir'
        : resolved?.source === 'git.kernel.org'
          ? 'git.kernel.org'
          : '本地 Code Browser';
  const linkTitle =
    title ||
    `${sourceLabel}: ${version}:${path}${line ? `:${line}` : ''}${
      resolved?.fallback_reason ? ` (${resolved.fallback_reason})` : ''
    }`;

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : target}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={className}
      title={linkTitle}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

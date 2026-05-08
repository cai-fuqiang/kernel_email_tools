import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { resolveKernelSource } from '../api/client';
import type { KernelResolveResponse } from '../api/types';
import { localKernelCodeUrl, pickKernelSourceUrl } from '../utils/externalLinks';

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
  const shouldResolveLocally = !!version && version !== 'latest';
  const initialHref = useMemo(
    () =>
      shouldResolveLocally
        ? localKernelCodeUrl(version, path, line)
        : pickKernelSourceUrl(version || 'latest', path, line).url,
    [line, path, shouldResolveLocally, version],
  );
  const [resolved, setResolved] = useState<KernelResolveResponse | null>(null);

  useEffect(() => {
    if (!shouldResolveLocally) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    setResolved(null);
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
  }, [line, path, shouldResolveLocally, version]);

  const href = resolved?.url || initialHref;
  const fallbackSource = !shouldResolveLocally ? pickKernelSourceUrl(version || 'latest', path, line).source : null;
  const isExternal = !shouldResolveLocally || (resolved ? resolved.source !== 'local' : target === '_blank');
  const sourceLabel =
    !shouldResolveLocally
      ? fallbackSource === 'elixir'
        ? 'Elixir'
        : 'git.kernel.org'
      :
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
      shouldResolveLocally && resolved?.source !== 'local' && resolved?.fallback_reason
        ? ` (本地缺失，fallback: ${resolved.fallback_reason})`
        : ''
    }`;

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : target}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={className}
      title={linkTitle}
      aria-label={linkTitle}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

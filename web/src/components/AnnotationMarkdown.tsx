import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AnnotationMarkdownProps {
  body: string;
  className?: string;
  maxLength?: number;
  onOpenAnnotation?: (annotationId: string) => void;
}

interface AnnotationMarkdownLinkProps extends ComponentPropsWithoutRef<'a'> {
  children?: ReactNode;
  onOpenAnnotation?: (annotationId: string) => void;
}

const annotationLinkClassName =
  'inline-flex items-center rounded border border-slate-300 px-1.5 py-0.5 align-baseline text-[0.92em] leading-tight text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1';

function annotationUrlTransform(url: string): string {
  return url.startsWith('annotation:') ? url : defaultUrlTransform(url);
}

export function renderAnnotationMarkdownLink({
  children,
  href,
  onOpenAnnotation,
  ...anchorProps
}: AnnotationMarkdownLinkProps) {
  if (href?.startsWith('annotation:')) {
    const annotationId = href.slice('annotation:'.length);
    const label = typeof children === 'string' ? children : annotationId;

    return (
      <button
        type="button"
        aria-label={`Open annotation ${label}`}
        className={annotationLinkClassName}
        onClick={(event) => {
          event.preventDefault();
          onOpenAnnotation?.(annotationId);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <a {...anchorProps} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * 共享 Markdown 渲染组件
 * 用于邮件批注和代码标注的 Markdown 内容渲染
 */
export default function AnnotationMarkdown({ 
  body, 
  className = '', 
  maxLength,
  onOpenAnnotation,
}: AnnotationMarkdownProps) {
  const displayContent = maxLength && body.length > maxLength 
    ? body.slice(0, maxLength) + '...' 
    : body;

  return (
    <div className={`annotation-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={annotationUrlTransform}
        components={{
          a: ({ node: _node, ...props }) =>
            renderAnnotationMarkdownLink({
              ...props,
              onOpenAnnotation,
            }),
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}

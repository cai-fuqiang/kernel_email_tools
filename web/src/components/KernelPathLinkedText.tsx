import { Fragment, type ReactNode } from 'react';
import { parseKernelPathRefs } from '../utils/kernelPathRefs';
import { pickKernelSourceUrl } from '../utils/externalLinks';

interface Props {
  /** 原始文本，可能包含内核源码路径（如 `mm/vmscan.c:1234`） */
  text: string;
  /** 用于构造外链的内核版本（如 `v6.8`、`latest`） */
  version: string;
  /** 传给 <pre> 或 <span> 的 className */
  className?: string;
  /** 使用的包裹元素，默认 `pre` */
  as?: 'pre' | 'span' | 'div';
}

/**
 * 把文本中出现的内核源码路径渲染为可点击的外链，指向 Elixir Bootlin
 * 或 git.kernel.org（由 pickKernelSourceUrl 根据版本决定）。
 *
 * 非路径片段按原样以纯文本渲染，保留换行/空白。
 *
 * @see parseKernelPathRefs
 * @see PLAN-30002 Phase 3
 */
export default function KernelPathLinkedText({
  text,
  version,
  className,
  as = 'pre',
}: Props) {
  const Wrapper = as;
  const refs = parseKernelPathRefs(text);

  if (refs.length === 0) {
    return <Wrapper className={className}>{text}</Wrapper>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  refs.forEach((ref, i) => {
    if (ref.start > cursor) {
      parts.push(
        <Fragment key={`t-${i}`}>{text.slice(cursor, ref.start)}</Fragment>,
      );
    }
    const { url } = pickKernelSourceUrl(version, ref.path, ref.line);
    parts.push(
      <a
        key={`l-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 hover:text-indigo-800 hover:underline decoration-dotted"
        title={`在 Elixir / git.kernel.org 查看 (${version})`}
        onClick={(e) => e.stopPropagation()}
      >
        {ref.raw}
      </a>,
    );
    cursor = ref.end;
  });

  if (cursor < text.length) {
    parts.push(<Fragment key="t-tail">{text.slice(cursor)}</Fragment>);
  }

  return <Wrapper className={className}>{parts}</Wrapper>;
}
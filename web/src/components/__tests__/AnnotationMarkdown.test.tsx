import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AnnotationMarkdown, { renderAnnotationMarkdownLink } from '../AnnotationMarkdown';

describe('AnnotationMarkdown link rendering', () => {
  it('preserves annotation protocol links through ReactMarkdown rendering', () => {
    const html = renderToStaticMarkup(
      <AnnotationMarkdown body="See [Kernel note](annotation:ann-123)." />,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open annotation Kernel note"');
  });

  it('renders annotation links as buttons and opens the target annotation id on click', () => {
    const onOpenAnnotation = vi.fn();
    const element = renderAnnotationMarkdownLink({
      href: 'annotation:ann-123',
      children: 'Kernel note',
      onOpenAnnotation,
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open annotation Kernel note"');

    expect(element.props.onClick).toBeTypeOf('function');
    element.props.onClick({
      preventDefault: vi.fn(),
    });

    expect(onOpenAnnotation).toHaveBeenCalledWith('ann-123');
  });

  it('keeps https links as external anchors', () => {
    const element = renderAnnotationMarkdownLink({
      href: 'https://example.com/docs',
      children: 'Example docs',
    });

    expect(renderToStaticMarkup(element)).toBe(
      '<a href="https://example.com/docs" target="_blank" rel="noreferrer">Example docs</a>',
    );
  });
});

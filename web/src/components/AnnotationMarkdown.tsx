import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AnnotationMarkdownProps {
  body: string;
  className?: string;
  maxLength?: number;
}

/**
 * 共享 Markdown 渲染组件
 * 用于邮件批注和代码标注的 Markdown 内容渲染
 */
export default function AnnotationMarkdown({ 
  body, 
  className = '', 
  maxLength 
}: AnnotationMarkdownProps) {
  const displayContent = maxLength && body.length > maxLength 
    ? body.slice(0, maxLength) + '...' 
    : body;

  return (
    <div className={`annotation-markdown ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}
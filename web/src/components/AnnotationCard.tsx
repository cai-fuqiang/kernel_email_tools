import { useState } from 'react';
import AnnotationMarkdown from './AnnotationMarkdown';
import AnnotationActions from './AnnotationActions';

interface AnnotationCardProps {
  annotation_id?: string;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
  variant: 'email' | 'code';
  onEdit: (body: string) => void;
  onDelete: () => void;
  onReply?: () => void;
  onPreview?: (e: React.MouseEvent) => void;
  // code 变体附加信息
  version?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  // 邮件批注附加信息
  email_subject?: string;
  email_sender?: string;
  thread_id?: string;
  // 点击回调
  onClick?: () => void;
  // 是否显示 Goto 按钮（用于代码标注跳转）
  showGoto?: boolean;
  onGoto?: () => void;
}

/**
 * 统一卡片组件
 * 通过 variant 区分邮件批注和代码标注的样式
 */
export default function AnnotationCard({
  author,
  body,
  created_at,
  updated_at,
  variant,
  onEdit,
  onDelete,
  onReply,
  onPreview,
  version,
  file_path,
  start_line,
  end_line,
  email_subject,
  email_sender,
  onClick,
  showGoto,
  onGoto,
}: AnnotationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);

  // 颜色主题
  const themeColors = variant === 'email' 
    ? { 
        border: 'border-blue-400', 
        bg: 'bg-blue-50', 
        tag: 'bg-blue-100 text-blue-700',
        text: 'text-blue-900',
        secondary: 'text-blue-500',
        date: 'text-blue-500',
      }
    : { 
        border: 'border-indigo-400', 
        bg: 'bg-indigo-50', 
        tag: 'bg-indigo-100 text-indigo-700',
        text: 'text-indigo-900',
        secondary: 'text-indigo-500',
        date: 'text-indigo-500',
      };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAuthorInitial = (name: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  const handleSave = () => {
    if (editBody.trim()) {
      onEdit(editBody.trim());
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setEditBody(body);
    setEditing(false);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // 如果点击的是按钮，不触发卡片点击
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.annotation-actions')) return;
    onClick?.();
  };

  return (
    <div
      className={`annotation-card-${variant} border-l-4 ${themeColors.border} ${themeColors.bg} rounded-lg p-4 my-2`}
      onClick={handleCardClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{
            backgroundColor: `hsl(${author.charCodeAt(0) * 15 % 360}, 65%, 50%)`,
          }}
        >
          {getAuthorInitial(author)}
        </div>
        <span className="font-medium text-sm">{author}</span>
        <span className={`px-2 py-0.5 text-xs rounded font-medium ${themeColors.tag}`}>
          {variant === 'email' ? '邮件批注' : '代码标注'}
        </span>
        <span className={`text-xs ${themeColors.date} ml-auto`}>
          {formatDate(created_at)}
        </span>
        {updated_at !== created_at && (
          <span className={`text-xs ${themeColors.secondary}`}>(已编辑)</span>
        )}
      </div>

      {/* 附加信息 */}
      {variant === 'email' && (email_subject || email_sender) && (
        <div className="mb-2 text-xs text-gray-500 bg-white/50 px-3 py-1.5 rounded">
          {email_subject && (
            <span className="font-medium text-gray-600">{email_subject}</span>
          )}
          {email_sender && (
            <span className="ml-2 text-gray-400">— {email_sender}</span>
          )}
        </div>
      )}

      {variant === 'code' && (version || file_path) && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          {version && (
            <span className={`px-2 py-0.5 text-xs font-medium ${themeColors.tag} rounded`}>
              {version}
            </span>
          )}
          {file_path && (
            <span className="font-mono text-gray-600">
              {file_path}
              {start_line && (
                <span className="text-gray-400">
                  :{start_line}{end_line !== start_line && `-${end_line}`}
                </span>
              )}
            </span>
          )}
          {showGoto && onGoto && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onGoto();
              }}
              className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 font-medium px-2 py-0.5 rounded hover:bg-blue-50 transition-colors"
            >
              Goto
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {editing ? (
        <div className="mt-2">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="w-full min-h-[80px] p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 bg-white"
            placeholder="输入批注内容（支持 Markdown）..."
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSave}
              disabled={!editBody.trim()}
              className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存修改
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <AnnotationMarkdown 
            body={body} 
            className={`text-sm ${themeColors.text} leading-relaxed`}
          />
          <AnnotationActions
            onEdit={() => setEditing(true)}
            onDelete={() => onDelete()}
            onReply={onReply}
            onPreview={onPreview}
            showReply={!!onReply}
            showPreview={variant === 'code' && !!onPreview}
            variant={variant}
          />
        </>
      )}
    </div>
  );
}
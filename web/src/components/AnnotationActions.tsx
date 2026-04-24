interface AnnotationActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
  onPreview?: (e: React.MouseEvent) => void;
  showEdit?: boolean;
  showDelete?: boolean;
  showReply?: boolean;
  showPreview?: boolean;
  variant: 'email' | 'code';
}

/**
 * 共享操作按钮组件
 * 用于邮件批注和代码标注的编辑、删除、回复按钮
 */
import React from 'react';

interface AnnotationActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
  onPreview?: (e: React.MouseEvent) => void;
  showEdit?: boolean;
  showDelete?: boolean;
  showReply?: boolean;
  showPreview?: boolean;
  variant: 'email' | 'code';
}

export default function AnnotationActions({ 
  onEdit, 
  onDelete, 
  onReply, 
  onPreview,
  showEdit = true,
  showDelete = true,
  showReply = false,
  showPreview = false,
  variant 
}: AnnotationActionsProps) {
  // 根据 variant 确定颜色样式
  const baseColorClass = variant === 'email' 
    ? 'text-blue-600 hover:bg-blue-100' 
    : 'text-indigo-600 hover:bg-indigo-100';
  
  const deleteColorClass = variant === 'email'
    ? 'text-red-500 hover:bg-red-50'
    : 'text-red-500 hover:bg-red-50';

  return (
    <div className="annotation-actions flex gap-2 mt-2">
      {showReply && onReply && (
        <button
          onClick={onReply}
          className={`text-xs px-2 py-1 rounded transition-colors ${baseColorClass}`}
        >
          回复
        </button>
      )}
      {showPreview && onPreview && (
        <button
          onClick={onPreview}
          className={`text-xs px-2 py-1 rounded transition-colors ${baseColorClass}`}
        >
          Preview
        </button>
      )}
      {showEdit && (
        <button
          onClick={onEdit}
          className={`text-xs px-2 py-1 rounded transition-colors ${baseColorClass}`}
        >
          编辑
        </button>
      )}
      {showDelete && (
        <button
          onClick={onDelete}
          className={`text-xs px-2 py-1 rounded transition-colors ${deleteColorClass}`}
        >
          删除
        </button>
      )}
    </div>
  );
}

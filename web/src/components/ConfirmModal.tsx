import { useState } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'warning';
  showInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  onConfirm: (inputValue: string) => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  variant = 'danger',
  showInput = false,
  inputLabel,
  inputPlaceholder,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  const confirmColors: Record<string, string> = {
    danger: 'bg-red-600 hover:bg-red-700',
    primary: 'bg-indigo-600 hover:bg-indigo-700',
    warning: 'bg-amber-600 hover:bg-amber-700',
  };

  const handleConfirm = () => {
    onConfirm(inputValue);
    setInputValue('');
  };

  const handleCancel = () => {
    setInputValue('');
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>

        {showInput && (
          <div className="mt-4">
            {inputLabel && (
              <label className="block text-xs font-medium text-slate-500 mb-1">{inputLabel}</label>
            )}
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={inputPlaceholder}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            className={`rounded-xl px-4 py-2 text-sm text-white transition-colors ${confirmColors[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

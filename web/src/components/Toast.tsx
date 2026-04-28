/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

let nextId = 0;
let globalAddToast: ((message: string, type: 'error' | 'success' | 'info') => void) | null = null;

export function showToast(message: string, type: 'error' | 'success' | 'info' = 'error') {
  globalAddToast?.(message, type);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'error') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => { globalAddToast = null; };
  }, [addToast]);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const colors: Record<string, string> = {
    error: 'bg-red-600',
    success: 'bg-emerald-600',
    info: 'bg-blue-600',
  };

  return (
    <ToastContext.Provider value={{ showToast: addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${colors[toast.type]} text-white px-4 py-3 rounded-xl shadow-lg text-sm max-w-sm animate-slide-up`}
            onClick={() => removeToast(toast.id)}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

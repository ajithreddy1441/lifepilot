import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };
const STYLES = {
  success: 'border-emerald-200 dark:border-emerald-500/30',
  error: 'border-rose-200 dark:border-rose-500/30',
  info: 'border-brand-200 dark:border-brand-500/30',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message, type = 'success', { action, duration = 4000 } = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, message, type, action }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  toast.error = (m, o) => toast(m, 'error', o);
  toast.info = (m, o) => toast(m, 'info', o);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 md:bottom-6 md:top-auto md:right-6 md:left-auto md:items-end">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className={`card pointer-events-auto flex w-full max-w-sm items-start gap-3 border px-4 py-3 text-sm animate-slide-up ${STYLES[t.type]}`}>
              <Icon size={18} className={t.type === 'error' ? 'text-rose-500' : t.type === 'info' ? 'text-brand-500' : 'text-emerald-500'} />
              <p className="flex-1 whitespace-pre-line">{t.message}</p>
              {t.action && (
                <button className="font-semibold text-brand-600 dark:text-brand-300" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

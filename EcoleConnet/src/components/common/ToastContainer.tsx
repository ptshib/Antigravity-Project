import React from 'react';
import { useNotifications } from '../../context/NotificationContext';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => {
        const bgColors = {
          info: 'bg-blue-900 text-white border-blue-700',
          success: 'bg-emerald-900 text-white border-emerald-700',
          warning: 'bg-amber-900 text-white border-amber-700',
          urgent: 'bg-rose-900 text-white border-rose-700'
        };

        const icons = {
          info: <Info className="w-5 h-5 text-blue-300 shrink-0" />,
          success: <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" />,
          urgent: <AlertCircle className="w-5 h-5 text-rose-300 shrink-0" />
        };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between p-4 rounded-xl border shadow-xl transition-all duration-300 animate-slide-up ${bgColors[toast.type]}`}
          >
            <div className="flex items-start gap-3">
              {icons[toast.type]}
              <p className="text-sm font-medium leading-snug">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-300 transition-colors ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

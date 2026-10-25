import { CircleAlert, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { useChatStore } from '../../lib/store';

export default function Toast() {
  const toast = useChatStore((state) => state.toast);
  const clearToast = useChatStore((state) => state.clearToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => clearToast(), 4200);
    return () => window.clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) return null;

  const isError = toast.kind === 'error';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4 sm:bottom-28">
      <div
        role="alert"
        key={toast.id}
        className={`animate-pop pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
          isError
            ? 'border-danger-400/25 bg-[#2a1119]/95 text-danger-400'
            : 'border-mint-400/20 bg-[#0d211e]/95 text-mint-400'
        }`}
      >
        {isError ? (
          <CircleAlert size={18} className="mt-0.5 shrink-0" />
        ) : (
          <Info size={18} className="mt-0.5 shrink-0" />
        )}
        <p className="leading-5 text-mist-100">{toast.message}</p>
        <button
          type="button"
          onClick={clearToast}
          className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-mist-500 transition hover:bg-white/5 hover:text-mist-200"
          aria-label="关闭提示"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

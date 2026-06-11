import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// Global action-feedback toaster, bottom-right. Fires on user actions like
// "Leave applied", "Hours saved", "Approved"… so the user gets confirmation
// without an intrusive alert() or having to look at the page state to know
// the action went through.
//
// Usage from anywhere:
//   import { toast } from '../components/Toaster';
//   toast.success('Leave applied');
//   toast.error('Failed to save', e?.message);
//   toast.info('Comment posted');
//   toast.warning('Balance running low');
//
// This is intentionally a global event emitter rather than a React context
// so handlers, async callbacks, and non-component code can fire toasts
// without being wired through props or hooks.

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

type Listener = (toasts: Toast[]) => void;

let _toasts: Toast[] = [];
const _listeners = new Set<Listener>();
let _nextId = 1;

function emit() {
  for (const l of _listeners) l([..._toasts]);
}

function push(kind: ToastKind, title: string, description?: string) {
  // De-dupe spam: if the most recent toast matches title+kind, drop it.
  // Common when the same handler accidentally fires twice (React 18 strict
  // mode in dev, double-click on a button, etc.).
  const last = _toasts[_toasts.length - 1];
  if (last && last.kind === kind && last.title === title && last.description === description) {
    return last.id;
  }
  const id = _nextId++;
  _toasts.push({ id, kind, title, description });
  // Cap the visible queue at 4. Older toasts fall off the bottom.
  if (_toasts.length > 4) _toasts = _toasts.slice(_toasts.length - 4);
  emit();
  return id;
}

function dismiss(id: number) {
  _toasts = _toasts.filter(t => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error:   (title: string, description?: string) => push('error',   title, description),
  info:    (title: string, description?: string) => push('info',    title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
  dismiss,
};

const KIND_CONFIG: Record<ToastKind, { icon: any; iconColor: string; iconBg: string; borderTint: string }> = {
  success: { icon: CheckCircle,   iconColor: '#15803d', iconBg: '#dcfce7', borderTint: 'border-success/30' },
  error:   { icon: XCircle,       iconColor: '#b91c1c', iconBg: '#fee2e2', borderTint: 'border-danger/30' },
  info:    { icon: Info,          iconColor: '#3730a3', iconBg: '#e0e7ff', borderTint: 'border-accent/30' },
  warning: { icon: AlertTriangle, iconColor: '#92400e', iconBg: '#fef3c7', borderTint: 'border-warning/30' },
};

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    _listeners.add(setToasts);
    // Sync any toasts that fired before mount (rare but possible if a
    // toast() call ran during module init).
    setToasts([..._toasts]);
    return () => { _listeners.delete(setToasts); };
  }, []);

  // Auto-dismiss the oldest toast after 4.5s. We expire one at a time so a
  // stack of toasts walks itself off the screen at a readable pace instead
  // of all vanishing at once.
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const timer = setTimeout(() => dismiss(oldest.id), 4500);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    // Pointer-events-none on the wrapper so the dead space between toasts
    // doesn't block clicks on the page beneath. Each toast opts back in.
    <div className="fixed bottom-6 right-6 z-[80] flex flex-col gap-2 w-80 max-w-[calc(100vw-3rem)] pointer-events-none">
      {toasts.map(t => {
        const cfg = KIND_CONFIG[t.kind];
        const Icon = cfg.icon;
        return (
          <div key={t.id}
            className={`pointer-events-auto bg-surface rounded-xl-2 border ${cfg.borderTint} shadow-elev-3 p-3 flex items-start gap-3 animate-fade-up`}
            role="status" aria-live="polite">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: cfg.iconBg, color: cfg.iconColor }}>
              <Icon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-on-surface leading-tight">{t.title}</p>
              {t.description && (
                <p className="text-xs text-on-surface-muted mt-0.5 leading-snug line-clamp-2">{t.description}</p>
              )}
            </div>
            <button onClick={() => dismiss(t.id)}
              className="text-on-surface-subtle hover:text-on-surface p-0.5 flex-shrink-0"
              aria-label="Dismiss">
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

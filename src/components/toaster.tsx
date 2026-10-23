"use client";

import { useSyncExternalStore } from "react";
import { Info } from "lucide-react";
import { dismissToast, getServerToasts, getToasts, subscribeToasts } from "@/lib/toast";

/** Where `toast()` notes appear — bottom centre, above the phone's bottom bar. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="toast-in pointer-events-auto relative flex max-w-md items-center gap-3 overflow-hidden rounded-xl bg-[#06112f] py-3 pl-3.5 pr-2 text-sm text-white shadow-2xl"
        >
          {t.tone === "done" ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="butt" strokeLinejoin="miter" aria-hidden>
                <path d="M4 12.5 L9.5 18 L20 6.5" className="tick-draw" />
              </svg>
            </span>
          ) : (
            <Info size={20} strokeWidth={2} className="shrink-0 text-aqua" aria-hidden />
          )}
          {/* A note is read, not glanced at — it wraps rather than truncating. */}
          <span className={`bidi-auto min-w-0 flex-1 ${t.tone === "done" ? "truncate" : ""}`}>{t.text}</span>
          {t.onUndo && (
            <button
              onClick={() => {
                t.onUndo?.();
                dismissToast(t.id);
              }}
              className="shrink-0 rounded-md px-2.5 py-1 font-medium text-aqua hover:bg-white/10"
            >
              Undo
            </button>
          )}
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-1.5 py-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
          <span className="toast-timer absolute inset-x-0 bottom-0 h-0.5 bg-aqua" style={{ animationDuration: `${t.ms}ms` }} />
        </div>
      ))}
    </div>
  );
}

"use client";

// The one fold control for every panel at the side of a page (Nitsan,
// 2026-11-15: "whenever there is a panel on the right, add a clear, prominent
// button to fold and open it"). A labelled brand pill, the same in both states,
// so it reads as a control and not as a stray icon. Used by Plan's insights,
// the Salaries / Payments trends, and Scenarios' results.

import { PanelRightClose, PanelRightOpen } from "lucide-react";

export function PanelFold({ open, onClick, label, className = "" }: { open: boolean; onClick: () => void; /** what the panel is, e.g. "insights" */ label: string; className?: string }) {
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white shadow-card transition-colors hover:bg-brand-dark ${className}`}
    >
      <Icon size={16} strokeWidth={1.9} className="rtl:-scale-x-100" />
      {open ? `Hide ${label}` : `Show ${label}`}
    </button>
  );
}

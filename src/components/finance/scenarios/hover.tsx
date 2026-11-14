"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useT } from "@/components/finance/scenarios/lang";

/** The tip box itself: positioned under (or over) its anchor, kept on screen. */
function TipBox({ anchor, title, children }: { anchor: HTMLElement | null; title?: string; children: ReactNode }) {
  const { lang } = useT();
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const b = anchor.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const below = b.bottom + 8;
    const top = below + t.height > window.innerHeight - 8 && b.top - 8 - t.height > 8 ? b.top - 8 - t.height : below;
    const left = Math.min(Math.max(8, b.left + b.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    setPos({ top, left });
  }, [anchor]);
  return createPortal(
    <div
      ref={tip}
      role="tooltip"
      dir={lang === "he" ? "rtl" : "ltr"}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-2xl bg-surface p-4 text-start text-[15px] font-normal leading-6 text-foreground shadow-[0_12px_32px_rgba(6,17,47,0.16)] ring-1 ring-border"
    >
      {title && <p className="mb-1 font-medium text-brand">{title}</p>}
      <div className="text-muted">{children}</div>
    </div>,
    document.body,
  );
}

/** Wraps a figure or a name: hovering it (or a tap, on a phone) opens the
 * explanation — for table cells and headers where an (i) dot would crowd. */
export function HoverTip({ children, title, body, className = "" }: { children: ReactNode; title?: string; body: ReactNode; className?: string }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <span
      ref={setEl}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      className={`cursor-help ${className}`}
    >
      {children}
      {open && <TipBox anchor={el} title={title}>{body}</TipBox>}
    </span>
  );
}

/** A hover box that explains something on the page — readable type (15px),
 * an optional title. Opens on hover or focus; tap toggles it on a phone. */
export function Hover({ children, title, size = 16 }: { children: ReactNode; title?: string; size?: number }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current || !tip.current) return;
    const b = btn.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const below = b.bottom + 8;
    const top = below + t.height > window.innerHeight - 8 && b.top - 8 - t.height > 8 ? b.top - 8 - t.height : below;
    const left = Math.min(Math.max(8, b.left + b.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    setPos({ top, left });
  }, [open]);

  return (
    <span className="inline-flex align-middle">
      <button
        ref={btn}
        type="button"
        aria-label={title ? t("About: {title}", { title }) : t("More about this")}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          setOpen(false);
          setPos(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPos(null);
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex items-center justify-center rounded-full text-faint transition-colors hover:text-brand"
      >
        <Info size={size} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            dir={lang === "he" ? "rtl" : "ltr"}
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-50 w-80 max-w-[calc(100vw-16px)] rounded-2xl bg-surface p-4 text-start text-[15px] font-normal leading-6 text-foreground shadow-[0_12px_32px_rgba(6,17,47,0.16)] ring-1 ring-border"
          >
            {title && <p className="mb-1 font-medium text-brand">{title}</p>}
            <div className="text-muted">{children}</div>
          </div>,
          document.body,
        )}
    </span>
  );
}

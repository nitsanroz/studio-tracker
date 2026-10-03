"use client";

// A <select> that can show an icon on every option. A native <option> renders
// text only, so the stage and source looks could never reach a real dropdown.
//
// ⚠️ The list is `fixed` and portalled to <body>, measured from the trigger and
// flipped above it when the window runs out below — an `absolute` panel is cut
// off by any scrolling ancestor (the trap this app has hit five times).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface IconOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function IconSelect({
  value,
  options,
  onChange,
  className = "",
  style,
  ariaLabel,
  placeholder = "—",
}: {
  value: string;
  options: IconOption[];
  onChange: (value: string) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(options.length * 32 + 8, 320);
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, minWidth: r.width, up });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", shut, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", shut, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex cursor-pointer items-center gap-1.5 ${className}`}
        style={style}
      >
        {current?.icon}
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={12} strokeWidth={2} className="shrink-0 opacity-60" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            className="pop-in fixed z-[70] max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card"
            style={{
              left: pos.left,
              top: pos.top,
              minWidth: Math.max(pos.minWidth, 168),
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
          >
            {options.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    setOpen(false);
                    if (!on) onChange(o.value);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-background ${
                    on ? "font-medium text-foreground" : "text-muted"
                  }`}
                >
                  <span className="flex w-4 shrink-0 justify-center">{o.icon}</span>
                  <span className="bidi-auto flex-1 truncate">{o.label}</span>
                  {on && <Check size={13} strokeWidth={2} className="shrink-0 text-brand" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

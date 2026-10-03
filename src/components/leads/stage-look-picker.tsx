"use client";

// Settings → Leads: pick a stage's colour and icon. The button IS the stage's
// current look, so the row shows what the board will show.
//
// ⚠️ `fixed` + portalled, measured from the button — the settings popup is a
// scrolling modal, which would clip an `absolute` panel.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { LeadStage } from "@/lib/leads/types";
import { NEUTRAL, STAGE_COLORS, STAGE_ICONS, StageIcon } from "@/lib/leads/look";

export function StageLookPicker({
  stage,
  onChange,
}: {
  stage: LeadStage;
  onChange: (patch: { color?: string | null; icon?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const color = stage.color || NEUTRAL;

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = 230;
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up });
  }, [open]);

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
        onClick={() => setOpen((v) => !v)}
        aria-label={`Colour and icon for ${stage.name}`}
        title="Colour and icon"
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent hover:border-border"
        style={{ backgroundColor: `${color}1a` }}
      >
        <StageIcon stage={stage} size={14} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            className="pop-in fixed z-[80] w-[232px] rounded-xl border border-border bg-surface p-3 shadow-card"
            style={{ left: pos.left, top: pos.top, transform: pos.up ? "translateY(-100%)" : undefined }}
          >
            <p className="mb-1.5 text-[11.5px] text-muted">Colour</p>
            <div className="grid grid-cols-6 gap-1.5">
              {STAGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ color: c })}
                  aria-label={c}
                  className="flex size-7 items-center justify-center rounded-full"
                  style={{ backgroundColor: c }}
                >
                  {stage.color === c && <Check size={13} strokeWidth={2.5} className="text-white" />}
                </button>
              ))}
            </div>
            <p className="mt-3 mb-1.5 text-[11.5px] text-muted">Icon</p>
            <div className="grid grid-cols-6 gap-1">
              {Object.entries(STAGE_ICONS).map(([key, Icon]) => {
                const on = stage.icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChange({ icon: key })}
                    aria-label={key}
                    aria-pressed={on}
                    className={`flex size-7 items-center justify-center rounded-md ${on ? "" : "hover:bg-background"}`}
                    style={on ? { backgroundColor: `${color}1f`, color } : { color: "var(--color-muted)" }}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

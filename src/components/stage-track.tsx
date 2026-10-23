import type { ReactNode } from "react";
import { Check } from "lucide-react";

export type StagePlace = "at" | "passed" | "ahead";

/**
 * The neutral stage track on a lead's and a candidate's page (Nitsan's pick,
 * 2026-10-23): one white bar, the current stage a solid brand tile, the stages
 * behind it a grey tick, and one press moves to any of them. One component, so
 * the two pages can't drift apart.
 *
 * `current` is the index of the stage it is at — -1 for none yet, or
 * `stages.length` when it is past them all (a lead that was won or lost).
 * `mark` replaces the default marker (a tick on passed stages, nothing
 * otherwise); return undefined to keep the default for a place.
 */
export function StageTrack<S extends { id: string; name: string }>({
  stages,
  current,
  onPick,
  mark,
}: {
  stages: S[];
  current: number;
  onPick: (stage: S) => void;
  mark?: (stage: S, place: StagePlace) => ReactNode | undefined;
}) {
  return (
    <ol className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-surface p-1 shadow-card [scrollbar-width:none]">
      {stages.map((s, i) => {
        const place: StagePlace = i === current ? "at" : i < current ? "passed" : "ahead";
        const custom = mark?.(s, place);
        return (
          <li key={s.id} className="min-w-[8rem] flex-1">
            <button
              onClick={() => onPick(s)}
              aria-current={place === "at" ? "step" : undefined}
              title={place === "at" ? `${s.name} — current stage` : `Move to ${s.name}`}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm transition-colors ${
                place === "at"
                  ? "bg-brand font-medium text-white"
                  : place === "passed"
                    ? "text-muted hover:bg-background hover:text-foreground"
                    : "text-foreground hover:bg-background"
              }`}
            >
              {custom !== undefined
                ? custom
                : place === "passed" && <Check size={15} strokeWidth={2.25} className="shrink-0 text-faint" aria-hidden />}
              <span className="bidi-auto truncate">{s.name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

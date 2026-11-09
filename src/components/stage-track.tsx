import type { ReactNode } from "react";
import { Check } from "lucide-react";

export type StagePlace = "at" | "passed" | "ahead";

/**
 * The stage track on a lead's and a candidate's page, drawn as STEPS (v1.96.0,
 * Nitsan: "steps should look like steps and not just like tabs"): a numbered
 * circle per stage on one connecting line — passed stages a tick on a filled
 * line, the current one a solid brand circle with a halo, the ones ahead an
 * outlined number. One press still moves to any stage. One component, so the
 * two pages can't drift apart.
 *
 * `current` is the index of the stage it is at — -1 for none yet, or
 * `stages.length` when it is past them all (a lead that was won or lost).
 * `mark` replaces what sits INSIDE the circle (a tick on passed stages, the
 * number otherwise); return undefined to keep the default for a place.
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
    <ol className="flex min-w-0 flex-1 items-start overflow-x-auto rounded-2xl bg-surface px-3 pb-3.5 pt-4 shadow-card [scrollbar-width:none]">
      {stages.map((s, i) => {
        const place: StagePlace = i === current ? "at" : i < current ? "passed" : "ahead";
        const custom = mark?.(s, place);
        // The line INTO this step: filled once the track has reached it.
        const reached = i <= current;
        return (
          <li key={s.id} className="relative flex min-w-[6.5rem] flex-1 justify-center">
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[17px] h-0.5 rounded-full ${reached ? "bg-brand" : "bg-border"}`}
                style={{ left: "calc(-50% + 24px)", right: "calc(50% + 24px)" }}
              />
            )}
            <button
              onClick={() => onPick(s)}
              aria-current={place === "at" ? "step" : undefined}
              title={place === "at" ? `${s.name} — current stage` : `Move to ${s.name}`}
              className="group flex max-w-full flex-col items-center gap-2 px-1"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-medium tabular-nums transition-colors ${
                  place === "at"
                    ? "bg-brand text-white ring-4 ring-brand-soft"
                    : place === "passed"
                      ? "bg-brand text-white group-hover:bg-brand-dark"
                      : "bg-surface text-muted ring-1 ring-inset ring-border group-hover:text-brand group-hover:ring-brand"
                }`}
              >
                {custom !== undefined
                  ? custom
                  : place === "passed"
                    ? <Check size={16} strokeWidth={2.5} aria-hidden />
                    : i + 1}
              </span>
              <span
                className={`bidi-auto max-w-full truncate text-[13px] leading-4 ${
                  place === "at" ? "font-medium text-foreground" : place === "passed" ? "text-muted" : "text-muted group-hover:text-foreground"
                }`}
              >
                {s.name}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

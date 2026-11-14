import { POSITION_LABEL, type Position } from "@/lib/finance/people";

const TONE: Record<Exclude<Position, "designer">, string> = {
  project_manager: "bg-brand-soft text-brand-dark",
  office_manager: "bg-[var(--state-predicted-bg)] text-[var(--state-predicted-fg)]",
  owner: "bg-success/10 text-success",
};

/** A person's position as a small coloured tag; designers (the default) get none. */
export function PositionTag({ position }: { position: Position | null }) {
  if (!position || position === "designer") return null;
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${TONE[position]}`}>
      {POSITION_LABEL[position]}
    </span>
  );
}

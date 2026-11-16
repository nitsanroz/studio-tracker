/**
 * The mark that ties a label to its place on a bar: a small triangle pointing
 * from the text to the bar (Nitsan, 2026-11-16: "a triangle from the text
 * pointing to the bar — a more delicate solution"). It replaces every dark tick
 * line drawn through a bar — pace, target, floor, bad/good, need. A new marker
 * on a bar uses this, never a line through it.
 *
 * `up` sits under the bar pointing up at it; `down` sits over the bar pointing
 * down. Colour comes from `currentColor` — give it the label's text colour.
 */
export function Caret({ dir = "up", size = 10, className = "" }: { dir?: "up" | "down"; size?: number; className?: string }) {
  const h = Math.round(size * 0.6);
  return (
    <svg width={size} height={h} viewBox="0 0 10 6" aria-hidden className={`block shrink-0 ${className}`}>
      <path d={dir === "up" ? "M5 0 L10 6 H0 Z" : "M0 0 H10 L5 6 Z"} fill="currentColor" />
    </svg>
  );
}

/**
 * A caret placed on a bar's edge at `left` (a CSS length, e.g. "42%"), centred
 * on that point. Put it in a `relative` box laid over the bar: `up` hangs from
 * the box's top (under the bar), `down` sits on its bottom (over the bar).
 */
export function BarCaret({
  left,
  dir = "up",
  className = "",
  offset = 2,
  title,
}: {
  left: string;
  dir?: "up" | "down";
  className?: string;
  /** px between the caret and the bar */
  offset?: number;
  title?: string;
}) {
  return (
    <span
      className={`absolute -translate-x-1/2 ${className}`}
      style={dir === "up" ? { left, top: offset } : { left, bottom: offset }}
      title={title}
    >
      <Caret dir={dir} />
    </span>
  );
}

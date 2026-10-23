/**
 * The studio website's arrow, redrawn for the app (2026-10-23).
 *
 * From the website's design system (Figma "Design Systems" → Sandbox → Icons →
 * "24/Arrows & Directions/Right"): a near-straight shaft and a head whose two
 * arms sweep in to the tip, flat-cut ends, ~2 units of stroke at 24. The app
 * uses it wherever an arrow means "go there" — links, buttons that navigate,
 * and the corner of a card that opens — instead of the stock icon set's arrow.
 *
 * ⚠️ THE TIP IS DELIBERATELY NOT A NEEDLE. The first drawing met the arms at
 * ~60°, and with a mitred join that grew a long spike (Nitsan: "super sharp and
 * pointy"). The arms now arrive at ~95°, so the mitre is short: still a crisp
 * point, never a spike. Keep that angle if the curves are retouched.
 *
 * Strokes, not fills, so it takes `currentColor` and scales cleanly; the
 * stroke grows with `size`, like the website's (never a fixed hairline).
 */
export function StudioArrow({
  size = 16,
  up = false,
  className = "",
}: {
  size?: number;
  /** Points up-right (↗) — "opens" — instead of right (→) — "goes to". */
  up?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <g transform={up ? "rotate(-45 12 12)" : undefined}>
        <path d="M2.5 12.6 C7.5 11.7 13 11.7 19 12" />
        <path d="M12.6 4.8 C15.4 6.9 18 9.5 20.2 12 C18 14.5 15.4 17.1 12.6 19.2" />
      </g>
    </svg>
  );
}

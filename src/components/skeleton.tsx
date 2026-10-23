/**
 * Loaders, "Skeleton + line" (motion round 2, 2026-10-23): the shape of what
 * is coming, a light sweeping across it (`.skeleton` in globals.css), and a thin
 * brand line along the top of the card that is loading (`.load-line`). They
 * replace the grey "Loading…" lines, so a page no longer jumps when its data
 * lands — the rows arrive where their outlines already were.
 *
 * Each later row fades a little, so a skeleton never reads as real content.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

const WIDTHS = ["w-40", "w-28", "w-36", "w-24", "w-32"];

/** Rows of a list while they load: an optional avatar, a label, a figure. */
export function SkeletonRows({
  rows = 4,
  avatar = true,
  className = "",
}: {
  rows?: number;
  avatar?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-4 py-2 ${className}`} aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * (0.6 / Math.max(rows, 1)) }}>
          {avatar && <Skeleton className="size-8 shrink-0 rounded-lg" />}
          {/* varied widths, so the outline reads as text, not as a grid */}
          <Skeleton className={`h-3.5 ${WIDTHS[i % WIDTHS.length]}`} />
          <Skeleton className="ml-auto h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

/** A card's worth: the moving line along its top, a title, rows. */
export function SkeletonCard({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface p-5 shadow-card ${className}`}>
      <span className="load-line" aria-hidden />
      <Skeleton className="mb-4 h-4 w-40" />
      <SkeletonRows rows={rows} />
    </div>
  );
}

/** A thin moving line ABOVE a table while it reloads (a freelancer's month) —
 *  the same `.load-line` as a loading card, on a pale track. The parent must be
 *  positioned. */
export function LoadingLine() {
  return (
    <div aria-hidden className="absolute inset-x-0 -top-2 h-0.5 overflow-hidden rounded-full bg-brand-soft">
      <span className="load-line" />
    </div>
  );
}

/** A whole page before its first data: a title, a summary line, then a main
 *  card and (by default) a side column — the anatomy most pages share. */
export function PageSkeleton({ side = true }: { side?: boolean }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-6" aria-busy aria-label="Loading">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <div className={`grid items-start gap-4 ${side ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <SkeletonCard rows={7} />
        {side && <SkeletonCard rows={4} />}
      </div>
    </div>
  );
}

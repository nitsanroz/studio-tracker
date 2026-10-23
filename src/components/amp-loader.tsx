/**
 * The studio's animated ampersand (Nitsan's files, 2026-10-23) — the loader for
 * a whole screen, not for a list (lists use `skeleton.tsx`).
 *
 * ⚠️ IT IS WHITE ON TRANSPARENT, made for the brand blue. On the grey canvas or
 * a white card it all but disappears, so only put it on `bg-brand` (or navy).
 *
 * Two files, picked by size: the 200px GIF (49 KB) up to 100px — the most it
 * can cover crisply on a 2× screen — and the 450px WebP (320 KB) above that.
 * Nitsan's rule for the large one was "more than 250px"; the 100px line is that
 * rule with retina doubling, since the small file would blur sooner.
 */
export function AmpLoader({ size = 96, className = "" }: { size?: number; className?: string }) {
  const src = size > 100 ? "/brand/amp-loader-lg.webp" : "/brand/amp-loader.gif";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- animated; next/image would serve a still frame
    <img src={src} alt="" width={size} height={size} className={`shrink-0 select-none ${className}`} draggable={false} />
  );
}

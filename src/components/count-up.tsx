"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/reduced-motion";

/**
 * A figure that counts up to its value (motion round 2, "Settle + count",
 * 2026-10-23): from 0 when it first appears, and from the old value when it
 * changes — a new period on Home glides between the two instead of snapping.
 * "The old value" is the figure ON SCREEN (`at`), so a change mid-count carries
 * on from where the count is rather than jumping back to the last target —
 * and React's dev double-run of the effect, which never got to tick, still
 * counts from 0.
 *
 * Takes the figure as the STRING the caller already formatted ("398.5",
 * "12,683.25", "87") and keeps its decimals and thousands separators, so it can
 * drop in wherever a figure is printed. Anything that isn't a plain number is
 * shown as it is.
 *
 * ⚠️ 450ms, and the real value is the text from the first frame for screen
 * readers (`aria-label`); nothing waits on it. Reduced motion → no count.
 */
export function CountUp({ value, ms = 450 }: { value: string; ms?: number }) {
  const target = Number(value.replace(/,/g, ""));
  const numeric = value.trim() !== "" && Number.isFinite(target);
  const decimals = (value.split(".")[1] ?? "").length;
  const grouped = value.includes(",");
  const at = useRef(0);
  const [shown, setShown] = useState(numeric ? 0 : target);

  useEffect(() => {
    if (!numeric) return;
    const reduce = prefersReducedMotion();
    const start = at.current;
    if (reduce || start === target) {
      // no animation: land on the value
      at.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / ms, 1);
      at.current = start + (target - start) * (1 - Math.pow(1 - p, 3));
      setShown(at.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, numeric, ms]);

  if (!numeric) return <>{value}</>;
  const text = shown.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return (
    <span aria-label={value} className="tabular-nums">
      {text}
    </span>
  );
}

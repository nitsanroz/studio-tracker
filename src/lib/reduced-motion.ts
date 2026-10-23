/**
 * The visitor's "reduce motion" setting, for motion CSS can't switch off — a
 * requestAnimationFrame count, an inline transform, DOM built on the fly. The
 * CSS animations are covered by the guard in globals.css.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

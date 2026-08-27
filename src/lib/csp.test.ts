import { describe, expect, it } from "vitest";
import { policy } from "./csp";

/**
 * ⚠️ THE POINT OF THIS FILE IS THE FRAMING PAIR, and it is worth stating why so
 * nobody "simplifies" it away. On 2026-08-27 `frame-ancestors 'none'` plus
 * `X-Frame-Options: DENY` made the app unpaintable in Claude Code's preview pane,
 * which iframes localhost — the server was answering in 27ms while the pane sat
 * blank, so it read as "localhost:3000 is not responding" and cost two rounds of
 * chasing dev-server restarts and build directories. The fix exempts DEV ONLY.
 *
 * Both halves are asserted because either header alone still blocks framing:
 * relaxing the CSP while `next.config.ts` keeps an unconditional X-Frame-Options
 * would leave the pane just as broken, and the reverse would silently drop a real
 * protection from production. If one changes, this test should fail.
 */
describe("policy", () => {
  const NONCE = "test-nonce-value";

  it("blocks all framing in production", () => {
    const p = policy(NONCE, false);
    expect(p).toContain("frame-ancestors 'none'");
  });

  it("omits frame-ancestors in development so the preview pane can iframe it", () => {
    const p = policy(NONCE, true);
    expect(p).not.toContain("frame-ancestors");
  });

  it("never leaves an empty directive behind when one is omitted", () => {
    // The dev branch drops a directive from the middle of the list, so a missing
    // `.filter(Boolean)` would emit `form-action 'self'; ; upgrade-insecure-requests`
    // — which browsers reject as malformed, taking the whole policy with it.
    for (const isDev of [true, false]) {
      const parts = policy(NONCE, isDev).split(";");
      expect(parts.every((part) => part.trim().length > 0)).toBe(true);
    }
  });

  it("carries the nonce and 'strict-dynamic' in both modes", () => {
    for (const isDev of [true, false]) {
      const p = policy(NONCE, isDev);
      expect(p).toContain(`'nonce-${NONCE}'`);
      expect(p).toContain("'strict-dynamic'");
    }
  });

  it("allows 'unsafe-eval' only in development", () => {
    // React uses eval to rebuild server stacks for better dev errors. Shipping it
    // to production would hand an XSS foothold back the nonce is meant to remove.
    expect(policy(NONCE, true)).toContain("'unsafe-eval'");
    expect(policy(NONCE, false)).not.toContain("'unsafe-eval'");
  });

  it("keeps 'unsafe-inline' for styles and no style nonce", () => {
    // ⚠️ A nonce in style-src makes browsers IGNORE 'unsafe-inline', and inline
    // `style=` attributes position every Gantt bar, timeline row and chart element.
    // That combination blanks the Timeline, the charts and the client's shared plan.
    for (const isDev of [true, false]) {
      const styleSrc = policy(NONCE, isDev)
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("style-src"));
      expect(styleSrc).toBe("style-src 'self' 'unsafe-inline'");
    }
  });
});

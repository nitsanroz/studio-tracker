import { AmpLoader } from "@/components/amp-loader";
import { StudioArrow } from "@/components/studio-arrow";

/**
 * The frame every signed-out page shares — sign in, reset, set a password
 * (2026-11, design-lab round 7, option C "Blue"): the whole page brand blue
 * with the animated ampersand above a white card. The boot screen is the same
 * blue with the same ampersand, so signing in runs straight into it.
 *
 * ⚠️ `AmpLoader` is WHITE, which is why it only ever sits on brand blue.
 * ⚠️ These pages are outside `.app-canvas`; every value is set here by hand.
 */
export function AuthFrame({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand px-5 py-10">
      <AmpLoader size={96} />
      <div className="w-full max-w-[420px] rounded-[20px] bg-surface p-6 shadow-[0_24px_60px_rgba(6,17,47,0.25)] sm:p-8">
        {children}
      </div>
      {footer && <div className="text-center text-xs text-white/60">{footer}</div>}
    </div>
  );
}

/** A field on these pages: a Light White well, white with a brand ring on focus. 16px, so iOS doesn't zoom. */
export const authField =
  "w-full rounded-xl bg-[var(--light-white)] px-4 py-3 text-base outline-none ring-brand focus:bg-surface focus:ring-2";

export const authLabel = "flex flex-col gap-1.5 text-[15px] font-medium";

/** The page's one action, with the website's arrow unless it is busy. */
export function AuthButton({ busy, busyLabel, children, disabled }: { busy: boolean; busyLabel: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      disabled={busy || disabled}
      className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-base font-medium text-white hover:bg-brand-dark disabled:opacity-50"
    >
      {busy ? busyLabel : children}
      {!busy && <StudioArrow size={18} />}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useIsAdmin } from "@/lib/store";
import type { CycleProjection, EgressLevel } from "@/lib/egress";

/**
 * Warns admins at 80% and 95% of the org's 5 GB monthly egress allowance.
 *
 * ⚠️ WHY IT EXISTS: when the allowance runs out Supabase returns 402 and **every
 * client report link, the intake form and the shared Gantt go dead** — all three
 * read through the service role. v1.19.12 built a banner for that moment; this one
 * exists so the moment does not arrive unannounced. Nitsan asked for exactly 80%
 * and 95%.
 *
 * ⚠️ IT SAYS "ESTIMATE", AND THAT WORDING IS NOT MODESTY. Supabase publishes no
 * egress endpoint, so the figure is request counts × a bytes-per-request factor
 * calibrated against one real dashboard reading (see `src/lib/egress.ts`). An
 * admin who reads it as gospel and skips the dashboard is the failure this label
 * prevents — hence the link straight to the real page.
 *
 * ⚠️ DISMISSIBLE FOR THE DAY ONLY, which is a deliberate departure from the
 * serviceBlocked banner's "never dismissible". That one describes a live outage
 * nobody can act around; this one can sit at 85% for three weeks, and a banner
 * that cannot be dismissed for three weeks is a banner people learn to look past
 * — which would cost us the release where it mattered. The key carries the DATE,
 * so it comes back tomorrow.
 *
 * ⚠️ `stale` IS SHOWN AS LOUDLY AS a number, because Nitsan's access token expires
 * in 90 days and the poll will one day start failing. A monitor that goes quiet
 * looks exactly like a monitor saying "all clear".
 */

type Info = {
  level: EgressLevel;
  pct: number;
  bytes: number;
  cycle: { start: string; end: string };
  lastPolledAt: string | null;
  tokenConfigured: boolean;
  projection: CycleProjection | null;
};

const KEY = "egress.dismissed";

/** Bytes as MB or GB, whichever reads better at that size. */
function mb(bytes: number): string {
  const m = bytes / 1024 ** 2;
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`;
}

export function EgressBanner() {
  const isAdmin = useIsAdmin();
  const [info, setInfo] = useState<Info | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until read

  useEffect(() => {
    if (!isAdmin) return;
    // Read the dismissal here rather than in an initialiser: localStorage is not
    // available during SSR, and a mismatch would flash the banner on hydrate.
    const today = new Date().toISOString().slice(0, 10);
    try {
      setDismissed(localStorage.getItem(KEY) === today);
    } catch {
      setDismissed(false);
    }
    let alive = true;
    fetch("/api/egress")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setInfo(j as Info);
      })
      // A failed call is silent on purpose: the route already reports its own
      // trouble as `stale`, and a network blip is not worth a banner.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  if (!isAdmin || !info || dismissed) return null;
  if (info.level === "ok") return null;
  // Nothing configured yet — no token, nothing polled. Silence beats nagging
  // about a feature that was never switched on.
  if (info.level === "stale" && !info.tokenConfigured) return null;

  const critical = info.level === "critical";
  const stale = info.level === "stale";
  const gb = (info.bytes / 1024 ** 3).toFixed(2);

  function hide() {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, new Date().toISOString().slice(0, 10));
    } catch {}
  }

  return (
    <div
      role="alert"
      className={`fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 items-start gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-lg md:bottom-4 ${
        critical ? "bg-danger" : stale ? "bg-foreground" : "bg-amber-600"
      }`}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        {stale ? (
          <>
            <span className="font-semibold">The egress check has stopped reporting.</span>
            <span className="text-white/85">
              Last read{" "}
              {info.lastPolledAt ? new Date(info.lastPolledAt).toLocaleDateString() : "never"} — the
              Supabase access token may have expired (they last 90 days). Until it is replaced this
              warning cannot tell you how much of the allowance is left.
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold">
              Roughly {gb} GB of the 5 GB monthly allowance used — about {Math.round(info.pct)}%.
            </span>
            <span className="text-white/85">
              {critical
                ? "Past this the database starts refusing requests: client report links, the intake form and the shared plan all stop working. "
                : "Worth raising the plan before it runs out. "}
              This is an <strong>estimate</strong> from request counts, not a meter — check the real
              figure before acting. Cycle {info.cycle.start} → {info.cycle.end}.
            </span>
            {/* ⚠️ The forecast is what makes this useful BEFORE the limit rather
                than after it. Only shown once there are enough days behind it —
                `projection` is null below the minimum, and its own `confident`
                flag is what allowed it to raise this banner in the first place. */}
            {info.projection && (
              <span className="text-white/85">
                On this rate the cycle lands near{" "}
                <strong>{(info.projection.bytes / 1024 ** 3).toFixed(1)} GB</strong> by{" "}
                {info.cycle.end} — about {Math.round(info.projection.pct)}% of the allowance.{" "}
                {mb(info.projection.perWorkday)} a working day, {mb(info.projection.perWeekend)} at
                the weekend, from {info.projection.daysSampled} days measured.
              </span>
            )}
          </>
        )}
        <a
          href="https://supabase.com/dashboard/org/fhybmalkjzbwypracsmx/usage"
          target="_blank"
          rel="noreferrer"
          className="mt-1 self-start rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30"
        >
          Open usage &amp; billing →
        </a>
      </div>
      <button
        onClick={hide}
        aria-label="Hide for today"
        title="Hide for today"
        className="ml-auto shrink-0 rounded-full p-1 text-white/70 hover:bg-white/20 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}

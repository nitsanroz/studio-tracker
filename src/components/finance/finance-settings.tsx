"use client";

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { loadPrivacy, savePrivacy, type PrivacySettings } from "@/lib/finance/privacy";
import { Suspense } from "react";
import { Card } from "@/components/finance/ui";
import { MailSettings } from "@/components/finance/mail-settings";

/**
 * Finance's own settings: discreet mode for this device, and the mailboxes
 * &advice reads (owner only — everyone else gets nothing from MailSettings).
 * A tab of the tracker's Settings since the merge's stage 5; it was the page
 * /finance/settings, which now redirects there.
 */
export function FinanceSettings() {
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);

  useEffect(() => {
    setPrivacy(loadPrivacy());
  }, []);

  function apply(patch: Partial<PrivacySettings>) {
    setPrivacy((p) => {
      if (!p) return p;
      const next = { ...p, ...patch };
      savePrivacy(next);
      return next;
    });
  }

  return (
    // `finance-canvas`: these cards are finance's own and read its tokens.
    <div className="finance-canvas flex max-w-[860px] flex-col gap-4">

      <Card>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-brand-soft p-2 text-brand-dark">
            <EyeOff size={17} />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-medium">Discreet mode</h2>
            <p className="mt-0.5 text-sm text-muted">
              Blur every number on screen after a period of inactivity — for working in
              shared spaces. Move the mouse or press a key to reveal them again.
            </p>

            {privacy && (
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={privacy.enabled}
                    onChange={(e) => apply({ enabled: e.target.checked })}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  Blur numbers when idle
                </label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  After
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={privacy.seconds}
                    disabled={!privacy.enabled}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value));
                      if (Number.isFinite(v) && v >= 1) apply({ seconds: v });
                    }}
                    className="w-16 rounded-lg border border-border-strong px-2 py-1 text-right text-sm text-foreground outline-none focus:border-brand disabled:opacity-50"
                  />
                  seconds
                </label>
              </div>
            )}

            <p className="mt-3 text-xs text-faint">
              Stored on this device only. Stay still for {privacy?.seconds ?? 5} seconds to
              see it in action. To keep every number hidden while you show a page to someone,
              use <b className="font-medium">Hide numbers</b> at the top of the menu.
            </p>
          </div>
        </div>
      </Card>

      {/* It reads ?mail= (Google's answer), which needs a boundary. */}
      <Suspense fallback={null}>
        <MailSettings />
      </Suspense>
    </div>
  );
}

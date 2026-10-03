"use client";

// Settings, opened where they are used (Nitsan, 2026-10-03): the Leads
// settings from the Leads board, the Pricing settings from an estimate — as a
// popup over the page, so changing a stall limit or a library range does not
// mean leaving the board or the quote you are in the middle of.
//
// ⚠️ THE SAME COMPONENTS THE SETTINGS PAGE RENDERS, not copies: one place to
// change each control, and the Settings tab stays the full-page version.

import { useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Modal, ModalClose } from "@/components/ui";
import { LeadSettings } from "@/components/lead-settings";
import { LibrarySettings } from "@/components/leads/library-settings";

const TAB_KEY = "settings.tab";

export function SettingsPopupButton({
  which,
  label,
  iconOnly = false,
  onClosed,
}: {
  which: "leads" | "pricing";
  label: string;
  /** Just the gear — where the button sits beside a page's main action. */
  iconOnly?: boolean;
  /** Called when the popup closes — the page reloads what the settings may have changed. */
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-[12.5px] text-muted hover:border-brand hover:text-foreground ${
          iconOnly ? "w-8" : "px-2.5"
        }`}
        title={which === "leads" ? "Leads settings" : "Pricing settings"}
        aria-label={which === "leads" ? "Leads settings" : "Pricing settings"}
      >
        <Settings2 size={iconOnly ? 16 : 14} strokeWidth={1.75} />
        {!iconOnly && label}
      </button>
      {open && (
        <Modal onClose={close} width="5xl" align="center" className="max-h-[88vh] overflow-y-auto" labelledBy="settings-popup-title">
          {/* Pinned, so Close and "Open in Settings" stay in reach down a long panel. */}
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
            <h3 id="settings-popup-title" className="text-sm font-semibold">
              {which === "leads" ? "Leads settings" : "Pricing"}
            </h3>
            <Link
              href="/settings"
              onClick={() => {
                // Land on the matching tab of the full Settings page.
                try {
                  localStorage.setItem(TAB_KEY, which);
                } catch {
                  // The link still opens Settings, on its last tab.
                }
              }}
              className="text-[12px] text-brand hover:underline"
            >
              Open in Settings
            </Link>
            <span className="ml-auto">
              <ModalClose onClose={close} />
            </span>
          </div>
          {which === "leads" ? <LeadSettings /> : <LibrarySettings />}
        </Modal>
      )}
    </>
  );
}

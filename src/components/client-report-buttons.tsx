"use client";

import { useEffect, useState } from "react";
import { FileBarChart, Link2 } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { ensureClientReportLink } from "@/lib/report-links";

/** Admin-only "Client report" actions: open in new tab + copy link. */
export function ClientReportButtons({ clientId }: { clientId: string }) {
  const { currentUserId } = useData();
  const [toast, setToast] = useState(false);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  if (!isAdmin) return null;

  async function openReport() {
    const url = await ensureClientReportLink(clientId, currentUserId);
    if (url) window.open(url, "_blank");
  }

  async function copyReport() {
    const url = await ensureClientReportLink(clientId, currentUserId);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setToast(true);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={openReport}
        className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        title="Open the shareable client report in a new tab"
      >
        <FileBarChart size={14} />
        Client report
      </button>
      <button
        onClick={copyReport}
        className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-brand hover:text-brand"
        title="Copy report link"
      >
        <Link2 size={14} />
      </button>
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-white shadow-lg">
          Link to report copied to clipboard
        </div>
      )}
    </div>
  );
}

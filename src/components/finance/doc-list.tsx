"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, X } from "lucide-react";
import { docUrl, removeDoc, uploadDoc } from "@/lib/finance/docs-client";
import type { DocRef } from "@/lib/finance/mail/receipts";
import { ConfirmDialog } from "./ui";

/**
 * An expense's documents (v1.16.0, Nitsan 2026-11-06: "preview and download
 * them; I'll keep them in Google Drive for now"): one chip per file — click
 * to preview, the arrow to download — plus, where allowed, removing a file
 * and adding one. Files live in the private `finance-docs` bucket.
 */
export function DocList({
  docs,
  expenseId,
  editable = false,
  onChange,
  month,
  addLabel = "Add a file",
}: {
  docs: DocRef[];
  /** set where a file can be added to an expense */
  expenseId?: string;
  editable?: boolean;
  onChange?: () => void;
  /** the month ("YYYY-MM") a file added here is the invoice for — a Monthly row's line (v1.22.0) */
  month?: string;
  addLabel?: string;
}) {
  const [open, setOpen] = useState<DocRef | null>(null);
  // The file waiting on "Remove?" — the app's dialog, as window.confirm returns false at once in the desktop pane.
  const [removing, setRemoving] = useState<DocRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const download = async (d: DocRef) => {
    const url = await docUrl(d.id, true);
    if (!url) return setError("Couldn't open that file.");
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.click();
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      {docs.map((d) => (
        // A file, not a field (Nitsan, 2026-11-07: "the file chip looks like a text field"): a tinted pill.
        <span key={d.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-soft py-1 pr-1 pl-2.5 text-xs font-medium text-brand-dark">
          <button onClick={() => setOpen(d)} title={`Preview ${d.filename}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
            {d.mime.startsWith("image/") ? <ImageIcon size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}
            <span className="bidi-auto max-w-[13rem] truncate">{d.filename}</span>
          </button>
          <button onClick={() => void download(d)} title="Download" aria-label={`Download ${d.filename}`} className="flex size-5 items-center justify-center rounded-full hover:bg-brand hover:text-white">
            <Download size={12} />
          </button>
          {editable && (
            <button
              onClick={() => setRemoving(d)}
              title="Remove"
              aria-label={`Remove ${d.filename}`}
              className="flex size-5 items-center justify-center rounded-full text-brand-dark/60 hover:bg-danger hover:text-white"
            >
              <Trash2 size={12} />
            </button>
          )}
        </span>
      ))}
      {editable && expenseId && (
        <>
          <button
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-brand hover:bg-brand-soft disabled:opacity-50"
          >
            <Paperclip size={12} />
            {busy ? "Uploading…" : addLabel}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              const err = await uploadDoc(expenseId, file, month);
              setBusy(false);
              if (err) setError(err);
              else onChange?.();
            }}
          />
        </>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
      {open && <DocPreview doc={open} onClose={() => setOpen(null)} onDownload={() => void download(open)} />}
      {removing &&
        createPortal(
          <ConfirmDialog
            title="Remove this file?"
            body={`${removing.filename} is deleted from the app for good.`}
            confirmLabel="Remove"
            danger
            onConfirm={async () => {
              const d = removing;
              setRemoving(null);
              setBusy(true);
              const err = await removeDoc(d.id);
              setBusy(false);
              if (err) setError(err);
              else onChange?.();
            }}
            onCancel={() => setRemoving(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/** The file over the page: a PDF in the browser's own viewer, an image as it is. */
function DocPreview({ doc, onClose, onDownload }: { doc: DocRef; onClose: () => void; onDownload: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // onClose is a new function on every parent render (every 60s inside receipts): with it in the
  // signed-link effect's deps, the PDF reloaded and lost its scroll and zoom. Esc reads it from a ref.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    let live = true;
    void docUrl(doc.id).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [doc.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 md:p-8" onClick={onClose}>
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="bidi-auto min-w-0 flex-1 truncate text-sm font-medium">{doc.filename}</span>
          <button onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            <Download size={14} />
            Download
          </button>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-surface-2">
          {failed ? (
            <p className="p-6 text-sm text-muted">Couldn&apos;t open this file.</p>
          ) : !url ? (
            <p className="p-6 text-sm text-muted">Opening…</p>
          ) : doc.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
            <img src={url} alt={doc.filename} className="mx-auto h-full max-h-full object-contain" />
          ) : (
            <iframe src={url} title={doc.filename} className="h-full w-full" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

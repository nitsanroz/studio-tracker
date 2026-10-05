"use client";

// The Files card on an Overview tab — a client's and a lead's estimate's. The
// task panel's Attachments, in a card: list, open, remove, "+ Add files". Data
// comes from `src/lib/overview-files.ts`; this is only the surface.

import { useCallback, useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { formatSize } from "@/lib/uploads";
import type { OverviewFile } from "@/lib/overview-files";

export function OverviewFiles({
  load,
  add,
  remove,
  href,
  canRemove,
  className = "",
  empty = "No files yet — a brand book, a contract, the logo pack.",
}: {
  load: () => Promise<OverviewFile[]>;
  add: (file: File) => Promise<void>;
  remove: (f: OverviewFile) => Promise<void>;
  href: (path: string) => string;
  canRemove: (f: OverviewFile) => boolean;
  className?: string;
  empty?: string;
}) {
  const [files, setFiles] = useState<OverviewFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => setFiles(await load()), [load]);
  useEffect(() => {
    let alive = true;
    void load().then((f) => alive && setFiles(f));
    return () => {
      alive = false;
    };
  }, [load]);

  async function upload(list: File[]) {
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    for (const f of list) {
      try {
        await add(f);
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    await reload();
    setBusy(false);
  }

  async function drop(f: OverviewFile) {
    setError(null);
    setFiles((prev) => prev?.filter((x) => x.id !== f.id) ?? prev);
    try {
      await remove(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the file.");
      await reload();
    }
  }

  return (
    <section
      className={`group/files rounded-2xl border bg-surface p-4 shadow-card transition-colors ${over ? "border-brand" : "border-border"} ${className}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <h2 className="mb-2 text-sm font-semibold">Files</h2>
      {files !== null && files.length === 0 && <p className="mb-2 text-[13px] text-faint">{empty}</p>}
      {files && files.length > 0 && (
        <div className="mb-2 flex flex-col divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <div key={f.id} className="group/file flex items-center gap-2.5 px-3 py-2 text-[13px]">
              <Paperclip size={13} className="shrink-0 text-faint" />
              <a
                href={href(f.path)}
                target="_blank"
                rel="noreferrer"
                className="bidi-auto min-w-0 flex-1 truncate font-medium text-brand hover:underline"
              >
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-faint">{formatSize(f.size)}</span>
              {canRemove(f) && (
                <button
                  onClick={() => void drop(f)}
                  aria-label={`Remove ${f.name}`}
                  title="Remove"
                  className="shrink-0 text-faint opacity-0 hover:text-danger focus:opacity-100 group-hover/file:opacity-100"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <label
        className={`flex w-full cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 py-2 text-xs transition-colors focus-within:border-brand focus-within:text-brand ${
          busy
            ? "border-brand text-brand"
            : "border-border text-faint group-hover/files:border-border-strong group-hover/files:text-muted hover:!border-brand hover:!text-brand"
        }`}
      >
        {busy ? "Uploading…" : "+ Add files (up to 25MB each) — or drop them here"}
        <input
          type="file"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(picked);
          }}
        />
      </label>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

"use client";

// "New estimate → From a Claude conversation" (Nitsan, 2026-10-12). Three steps
// in one panel: copy the prompt (with the studio's library and rate), paste
// Claude's reply or upload it as a file, review what the tracker read. Nothing is
// written here — the host modal creates the draft from `onParsed`'s estimate.
// The reading itself is `parseImport` (estimate-import.ts), unit-tested there.

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Copy, FileUp } from "lucide-react";
import { loadLibrary, loadPricing } from "@/lib/leads/estimates-data";
import { buildImportPrompt, importTotals, parseImport, type ImportedEstimate } from "@/lib/leads/estimate-import";
import { fmtHours, fmtNis, type ServiceItem } from "@/lib/leads/estimate";

/**
 * Claude's spark, drawn inline in its orange (#d97757) — twelve rounded rays of
 * alternating length, so no image file has to be shipped or fetched.
 */
function ClaudeSpark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden fill="#d97757">
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="11" y={i % 2 ? 4 : 1.5} width="2" height={i % 2 ? 8 : 10.5} rx="1" transform={`rotate(${i * 30} 12 12)`} />
      ))}
    </svg>
  );
}

export function EstimateImportPanel({
  company,
  onParsed,
}: {
  company: string;
  onParsed: (est: ImportedEstimate | null) => void;
}) {
  const [library, setLibrary] = useState<ServiceItem[] | null>(null);
  const [pricing, setPricing] = useState<{ rate: number; vatPercent: number } | null>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadLibrary(), loadPricing()]).then(([l, p]) => {
      if (!alive) return;
      setLibrary(l);
      setPricing(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const result = useMemo(() => (input.trim() ? parseImport(input) : null), [input]);
  useEffect(() => onParsed(result?.estimate ?? null), [result, onParsed]);
  const t = result?.estimate && pricing ? importTotals(result.estimate, pricing.rate, pricing.vatPercent) : null;

  async function copyPrompt() {
    if (!library || !pricing) return;
    const prompt = buildImportPrompt(company, library, pricing.rate);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this prompt:", prompt);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3 text-[13px]">
      <div>
        <div className="font-medium">1. Ask Claude for the estimate in the tracker&rsquo;s format</div>
        <p className="mt-0.5 text-[12px] text-muted">
          At the end of your Claude conversation, paste this prompt. It lists your service library and rate, so Claude
          reuses the studio&rsquo;s own items and sizes.
        </p>
        <button
          onClick={() => void copyPrompt()}
          disabled={!library || !pricing}
          className="mt-2 flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] hover:border-brand disabled:opacity-50"
        >
          {copied ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
          {copied ? "Prompt copied" : "Copy prompt for Claude"}
        </button>
      </div>

      <div>
        <div className="font-medium">2. Paste Claude&rsquo;s reply, or upload it</div>
        {/* A terminal-style panel, like the Claude interface the reply comes from
            (Nitsan). Fixed hex colours, not theme tokens, so it stays dark under every
            app theme; the caret and selection are tinted so they show on the dark. */}
        <div className="mt-1.5 overflow-hidden rounded-lg bg-[#1f1e1d] ring-1 ring-black/10 focus-within:ring-2 focus-within:ring-brand">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-[#a8a29e]">
              <ClaudeSpark />
              Claude&rsquo;s reply
            </span>
          </div>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFileName(null);
            }}
            rows={8}
            spellCheck={false}
            placeholder="› Paste the whole reply — the tracker finds the estimate inside it."
            className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#e8e6dc] caret-[#d97757] outline-none placeholder:text-[#78716c] selection:bg-[#d97757]/30"
          />
        </div>
        <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted hover:text-brand">
          <FileUp size={14} />
          {fileName ? `Loaded ${fileName}` : "Upload a file (.json, .txt, .md)"}
          <input
            type="file"
            accept=".json,.txt,.md,application/json,text/plain,text/markdown"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setInput(await f.text());
              setFileName(f.name);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {result && (
        <div>
          <div className="font-medium">3. Check what was read</div>
          {result.errors.length > 0 && (
            <ul className="mt-1.5 list-disc rounded-lg border border-danger/30 bg-danger/5 py-2 pl-7 pr-3 text-[12.5px] text-danger">
              {result.errors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-1.5 list-disc rounded-lg border border-[#f0c65a] bg-[#fef7e7] py-2 pl-7 pr-3 text-[12px] text-[#92580a]">
              {result.warnings.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {result.estimate && (
            <div className="mt-1.5 rounded-lg border border-border bg-surface p-2.5">
              {result.estimate.phases.map((p, i) => {
                const n = p.items.length + p.groups.reduce((a, g) => a + g.items.length, 0);
                return (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    {p.timeframe && (
                      <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-brand">
                        <CalendarDays size={12} /> {p.timeframe}
                      </span>
                    )}
                    <span className="shrink-0 text-[12px] text-muted">
                      {n} {n === 1 ? "item" : "items"}
                      {p.groups.length > 0 && ` · ${p.groups.length} ${p.groups.length === 1 ? "group" : "groups"}`}
                    </span>
                    {t && <span className="w-24 shrink-0 text-right text-[12px] tabular-nums">{fmtHours(t.phase.get(String(i)) ?? { min: 0, max: 0 })}</span>}
                  </div>
                );
              })}
              {t && (
                <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-[12.5px] font-medium tabular-nums">
                  <span>{fmtHours(t.totalHours)}</span>
                  <span>{fmtNis(t.net)} + VAT</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

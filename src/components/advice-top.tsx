"use client";

// The top of the advisor's two tabs — &advice and Scenarios — drawn by one
// component so nothing moves when you switch between them or between English
// and Hebrew (Nitsan, 2026-11-15). One bar, laid out left to right in either
// language: the tab switch on the left, the language switch and the page's own
// control (Check again) on the right. Then the title, which follows the language.

import type { ReactNode } from "react";
import { AdviceLangSwitch } from "@/components/advice-lang";
import { ADVICE_VIEWS, PageViews } from "@/components/page-views";

export function AdviceTop({ title, note, status, control, rtl }: { title: ReactNode; note?: ReactNode; status?: ReactNode; control?: ReactNode; rtl: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div dir="ltr" className="flex h-9 items-center gap-3">
        <PageViews views={ADVICE_VIEWS} />
        <div className="ml-auto flex items-center gap-2">
          {status && <span className="hidden max-w-[22rem] truncate text-[12px] text-faint md:inline">{status}</span>}
          <AdviceLangSwitch />
          {/* A fixed slot, so the switch beside it stays put on a page with no control. */}
          <span className="flex size-9 items-center justify-center">{control}</span>
        </div>
      </div>
      <div dir={rtl ? "rtl" : "ltr"} className="min-h-[4.5rem]">
        <h1 className="page-title">{title}</h1>
        {note && <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>}
      </div>
    </div>
  );
}

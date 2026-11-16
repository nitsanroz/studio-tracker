"use client";

import { useContext, type ReactNode } from "react";
import { InfoTip, Tip, TipScope } from "@/components/advice-tip";
import { useT } from "@/components/finance/scenarios/lang";

/**
 * Scenarios' hover boxes — since the &all pass (2026-11-16) the app's one box,
 * `Tip` (components/advice-tip.tsx), with Scenarios' language deciding its
 * direction. The call sites keep these two names.
 */
function Scope({ children }: { children: ReactNode }) {
  const { lang } = useT();
  const outer = useContext(TipScope);
  return <TipScope.Provider value={{ ...outer, rtl: lang === "he" }}>{children}</TipScope.Provider>;
}

/** Wraps a figure or a name: hovering it (or a tap, on a phone) opens the
 * explanation — for table cells and headers where an (i) dot would crowd. */
export function HoverTip({ children, title, body, className = "" }: { children: ReactNode; title?: string; body: ReactNode; className?: string }) {
  return (
    <Scope>
      <Tip title={title} body={body} className={className}>
        {children}
      </Tip>
    </Scope>
  );
}

/** The (i) that explains something on the page. */
export function Hover({ children, title, size = 14 }: { children: ReactNode; title?: string; size?: number }) {
  const { t } = useT();
  return (
    <Scope>
      <InfoTip title={title} size={Math.min(size, 14)} label={title ? t("About: {title}", { title }) : t("More about this")}>
        {children}
      </InfoTip>
    </Scope>
  );
}

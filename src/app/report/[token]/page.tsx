import { notFound } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { ReportSnapshot } from "@/lib/types";
import { PublicReportView } from "./public-report-view";

// Public, token-gated client report. Shows ONLY the frozen snapshot that an
// admin explicitly published — never live hours.
export const dynamic = "force-dynamic";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Strip everything the admin marked hidden BEFORE it reaches the browser.
 * Hidden tasks and hidden period/week columns are physically removed (arrays
 * reindexed together); hidden estimate/total values are nulled. The client
 * therefore never receives hidden data in any form — not in the DOM, not in
 * the JSON payload, not in localStorage.
 *
 * Column keys (see report-table.tsx `columnKey`): "estimate", "total",
 * `p:{i}` for payment periods, `w:{i}` for week columns. Only estimate/total
 * are returned as still-hidden (they are leading columns kept in the array but
 * with their values removed); period/week columns are dropped outright.
 */
function sanitizeSnapshot(
  snap: ReportSnapshot,
  hiddenColumns: string[],
  hiddenTaskIds: string[],
): { snapshot: ReportSnapshot; leadingHidden: string[] } {
  const hc = new Set(hiddenColumns);
  const ht = new Set(hiddenTaskIds);
  const hideEstimate = hc.has("estimate");
  const hideTotal = hc.has("total");
  const useWeeks = !!snap.weeks?.length;

  const periodKeep = snap.periods.map((_, i) => !hc.has(`p:${i}`));
  const weekKeep = useWeeks ? snap.weeks!.map((_, i) => !hc.has(`w:${i}`)) : [];

  const sections = snap.sections
    .map((sec) => ({
      name: sec.name,
      tasks: sec.tasks
        .filter((t) => !ht.has(t.id))
        .map((t) => ({
          id: t.id,
          title: t.title,
          estimateHours: hideEstimate ? null : t.estimateHours,
          totalMinutes: hideTotal ? 0 : t.totalMinutes,
          periodMinutes: t.periodMinutes.filter((_, i) => periodKeep[i]),
          ...(t.weekMinutes
            ? { weekMinutes: useWeeks ? t.weekMinutes.filter((_, i) => weekKeep[i]) : t.weekMinutes }
            : {}),
        })),
    }))
    .filter((sec) => sec.tasks.length > 0);

  const snapshot: ReportSnapshot = {
    ...snap,
    periods: snap.periods.filter((_, i) => periodKeep[i]),
    ...(useWeeks ? { weeks: snap.weeks!.filter((_, i) => weekKeep[i]) } : {}),
    sections,
  };

  const leadingHidden = [
    ...(hideEstimate ? ["estimate"] : []),
    ...(hideTotal ? ["total"] : []),
  ];
  return { snapshot, leadingHidden };
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();

  const { data: link } = await sb
    .from("report_links")
    .select("active, snapshot, published_at, hidden_columns, hidden_task_ids, clients(name, color)")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.active) notFound();

  const raw = link.snapshot as ReportSnapshot | null;
  const client = link.clients as { name?: string; color?: string } | null;
  const clientName = client?.name ?? raw?.clientName ?? "Client";
  const clientColor = client?.color ?? raw?.clientColor ?? "#0b43ed";

  if (!raw) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl text-xl font-bold text-white"
          style={{ backgroundColor: clientColor }}
        >
          {clientName[0]}
        </span>
        <h1 className="text-xl font-bold">{clientName}</h1>
        <p className="text-sm text-muted">
          This report hasn&apos;t been published yet. Ask the studio for an updated link.
        </p>
      </main>
    );
  }

  const { snapshot, leadingHidden } = sanitizeSnapshot(
    raw,
    (link.hidden_columns as string[]) ?? [],
    (link.hidden_task_ids as string[]) ?? [],
  );

  return (
    <PublicReportView
      clientName={clientName}
      clientColor={clientColor}
      snapshot={snapshot}
      publishedAt={link.published_at}
      hiddenColumns={leadingHidden}
    />
  );
}

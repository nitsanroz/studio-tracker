import { notFound } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { ReportSnapshot, ReportViewFlags } from "@/lib/types";
import { sanitizeSnapshot } from "@/lib/report-sanitize";
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

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();

  const { data: link } = await sb
    .from("report_links")
    // ⚠️ `*`, not a column list, because `view_flags` needs migration 0031 and a
    // missing column NAMED in a select fails the whole query -- which here means
    // notFound() on every client's report link until that SQL is run. With `*` the
    // key is simply absent and both filters read as off.
    .select("*, clients(name, color)")
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
      viewFlags={(link.view_flags as ReportViewFlags | null) ?? null}
    />
  );
}

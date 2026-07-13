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

  const snapshot = link.snapshot as ReportSnapshot | null;
  const clientName = (link.clients as any)?.name ?? snapshot?.clientName ?? "Client";
  const clientColor = (link.clients as any)?.color ?? snapshot?.clientColor ?? "#0b43ed";

  if (!snapshot) {
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

  return (
    <PublicReportView
      token={token}
      clientName={clientName}
      clientColor={clientColor}
      snapshot={snapshot}
      publishedAt={link.published_at}
      defaultHiddenColumns={(link.hidden_columns as string[]) ?? []}
      defaultHiddenTaskIds={(link.hidden_task_ids as string[]) ?? []}
    />
  );
}

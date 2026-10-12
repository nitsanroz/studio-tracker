import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";
import { PublicEstimateView } from "./public-estimate-view";

// The client's copy of an approved estimate — public, token-gated, FROZEN.
//
// ⚠️ IT RENDERS A PUBLISHED SNAPSHOT AND NOTHING ELSE, the same rule as the
// client reports (`report/[token]`): what the client sees is exactly what was
// approved and published, never the live estimate an admin may be editing in a
// newer version. The snapshot holds no internal notes, no discount reason and
// no change log — `publishEstimate` leaves them out on purpose.
//
// ⚠️ EACH TOKEN IS ITS OWN PUBLICATION (0053): every publish mints a new link and
// the earlier ones keep showing what they were sent with, so the lookup goes to
// `estimate_publications` first. `lead_estimates.share_token` is the fallback —
// it covers links sent before 0053 ran, and the window before it is applied (the
// missing table just returns no row there).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Offer — Studio&more", robots: { index: false } };

function admin() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export default async function PublicEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const sb = admin();
  const { data: pub } = await sb.from("estimate_publications").select("snapshot").eq("token", token).maybeSingle();
  let s = (pub as { snapshot?: PublishedEstimate | null } | null)?.snapshot ?? null;
  if (!s) {
    const { data } = await sb.from("lead_estimates").select("published_snapshot").eq("share_token", token).maybeSingle();
    s = (data as { published_snapshot?: PublishedEstimate | null } | null)?.published_snapshot ?? null;
  }
  if (!s) notFound();
  // The old free-text Timeline is no longer shown (section timeframes replace it),
  // so it is not shipped to the browser either.
  return <PublicEstimateView s={{ ...s, timeline: null }} />;
}

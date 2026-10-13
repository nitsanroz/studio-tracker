import { FreelancerLogView } from "./log-view";

// A freelancer's private page (0054): log hours, see what's waiting for review,
// and this month's bill. No login — the token in the URL is the key, and every
// read and write goes through /api/log/[token] with the service key.
//
// ⚠️ Server file on purpose: the nonce CSP (src/proxy.ts) blocks the scripts of
// a PRERENDERED page, and route config is ignored in a "use client" module.
export const dynamic = "force-dynamic";

export default async function FreelancerLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FreelancerLogView token={token} />;
}

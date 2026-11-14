import { redirect } from "next/navigation";

/**
 * Finance's settings are a tab of the tracker's Settings since the merge's
 * stage 5 (one Settings for one app). This address is kept — old links and
 * bookmarks — and carries Google's `?mail=` answer along.
 */
export default async function FinanceSettingsRedirect({ searchParams }: { searchParams: Promise<{ mail?: string }> }) {
  const { mail } = await searchParams;
  redirect(`/settings?tab=finance${mail ? `&mail=${encodeURIComponent(mail)}` : ""}`);
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { AccountInactive } from "@/components/account-inactive";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Being signed in is not the same as still working here. `active` — and the
  // `end_date` that forces it (migration 0020) — had no effect anywhere before
  // this: an archived member kept a working login and full studio read access.
  // A missing profile row is treated the same way; an auth user with nothing to
  // attribute work to shouldn't get in either.
  //
  // This is the UI half only. See AccountInactive: real offboarding still means
  // banning the auth user, because every policy keys off auth.uid() alone.
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !profile.active) {
    return <AccountInactive name={profile?.name ?? null} />;
  }

  return <AppShell>{children}</AppShell>;
}

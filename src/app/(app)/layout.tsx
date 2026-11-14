import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { AccountInactive } from "@/components/account-inactive";
import { tierOf } from "@/lib/access";

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

  // Which finance entry the sidebar shows. Read HERE, on the server, from the
  // viewer's own row — the boot snapshot no longer carries `finance_full_access`
  // to anyone's browser, and a `?viewAs=` preview must not be able to raise it.
  // A separate query on purpose: if a column is missing it comes back empty
  // and the tier falls to member, instead of failing the check above and
  // locking everyone out. UI only — /finance has its own gate, and RLS.
  const { data: access } = await supabase
    .from("profiles")
    .select("role, position, finance_full_access")
    .eq("id", user.id)
    .maybeSingle();

  return <AppShell tier={tierOf(access)}>{children}</AppShell>;
}

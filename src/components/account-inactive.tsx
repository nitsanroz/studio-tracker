"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown instead of the app when the signed-in account has no profile, or has
 * one that is archived (`active = false`, which migration 0020's trigger also
 * forces whenever an `end_date` is set).
 *
 * Rendered rather than redirected on purpose: the session is still valid, so a
 * redirect to /login would bounce straight back here on the next navigation.
 *
 * NOTE this is a UI gate, not the security boundary. The row-level policies key
 * off `auth.uid()` alone, so a departed member holding a valid token could
 * still reach the API directly. Offboarding must ban or delete the `auth.users`
 * row — since migration 0018 dropped the FK, the profile and all of its history
 * survive that. See CLAUDE.md "Offboarding".
 */
export function AccountInactive({ name }: { name: string | null }) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-card">
        <span className="brand-wordmark w-44 bg-brand" aria-label="Studio&more" />
        <h1 className="text-lg font-semibold">
          {name ? `${name}, this account is archived` : "This account isn't active"}
        </h1>
        <p className="text-sm text-muted">
          It no longer has access to the tracker. If that&apos;s wrong, ask an admin to restore you
          from the Team page.
        </p>
        <button
          onClick={signOut}
          className="rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Map of profileId → the address the member signs in with. Admin-only server-side,
 * so this resolves to {} for members rather than failing — call sites just render
 * nothing when an address is missing.
 */
export function useMemberEmails(enabled: boolean): Record<string, string> {
  const [emails, setEmails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/admin/member-emails")
      .then((r) => (r.ok ? r.json() : { emails: {} }))
      .then((d) => {
        if (alive) setEmails(d.emails ?? {});
      })
      .catch(() => {
        /* non-fatal: the page just shows no addresses */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return emails;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, UserPen } from "lucide-react";

/**
 * Nudge shown on the home page until the member has confirmed their HR details
 * once. Silent for anyone who has already been through the welcome step.
 */
export function ConfirmDetailsBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/hr")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && !j.details?.confirmed_at) setShow(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <Link
      href="/welcome"
      className="flex items-center gap-2.5 rounded-2xl border border-brand bg-brand-soft px-4 py-3 text-sm font-medium text-brand-dark hover:brightness-95"
    >
      <UserPen size={16} strokeWidth={2} />
      Finish setting up your profile — confirm your details and add your pictures.
      <ArrowRight size={15} className="ml-auto shrink-0" />
    </Link>
  );
}

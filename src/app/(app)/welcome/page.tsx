"use client";

import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { HrDetailsForm } from "@/components/hr-details-form";
import { MemberPictures } from "@/components/picture-editor";

/**
 * First-sign-in welcome: the member confirms the details the studio holds for
 * them and can set their own pictures. Reachable any time from Settings.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { profiles, currentUserId } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const firstName = me?.name.split(" ")[0] ?? "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="rounded-2xl bg-brand px-7 py-6 text-white" style={{ boxShadow: "var(--shadow-hero)" }}>
        <div className="text-[11px] uppercase tracking-[0.09em] text-white/70">Welcome to the studio</div>
        <h1 className="mt-2 font-heading text-[26px] leading-snug">
          {firstName ? `Hi ${firstName} — let’s set you up.` : "Let’s set you up."}
        </h1>
        <p className="mt-2 max-w-lg text-sm text-white/80">
          Check the details below are right, fill in anything missing, and add your pictures. You can
          change all of this later in Settings.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-heading">Your pictures</h2>
        <p className="mb-4 text-xs text-muted">
          Your studio portrait is usually taken by the studio — ask an admin if you don’t have one yet.
        </p>
        {me && <MemberPictures profile={me} />}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-heading">Your details</h2>
        <p className="mb-4 text-xs text-muted">
          Used for HR and payroll paperwork. Visible only to you and the studio admins.
        </p>
        <HrDetailsForm confirmMode onSaved={() => router.push("/")} />
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/password-input";

export default function ResetUpdatePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-sm"
      >
        <span className="brand-wordmark w-44 bg-brand" aria-label="Studio&more" />
        <h1 className="text-lg">Choose a new password</h1>
        {hasSession === false && (
          <p className="text-sm text-danger">
            This link is invalid or expired — request a new one from the reset page.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          New password
          <PasswordInput value={password} onChange={setPassword} minLength={8} autoComplete="new-password" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Repeat password
          <PasswordInput value={confirm} onChange={setConfirm} minLength={8} autoComplete="new-password" />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          disabled={loading || hasSession === false}
          className="rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Saving…" : "Set password"}
        </button>
      </form>
    </div>
  );
}

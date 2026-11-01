"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/password-input";
import { AuthButton, AuthFrame, authLabel } from "@/components/auth-frame";

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
    <AuthFrame>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h1 className="page-title">
          New <span className="font-serif-accent">password</span>
        </h1>
        {hasSession === false && (
          <p className="text-sm text-danger">
            This link is invalid or expired — request a new one from the reset page.
          </p>
        )}
        <label className={authLabel}>
          New password
          <PasswordInput value={password} onChange={setPassword} minLength={8} autoComplete="new-password" />
        </label>
        <label className={authLabel}>
          Repeat password
          <PasswordInput value={confirm} onChange={setConfirm} minLength={8} autoComplete="new-password" />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <AuthButton busy={loading} busyLabel="Saving…" disabled={hasSession === false}>
          Set password
        </AuthButton>
      </form>
    </AuthFrame>
  );
}

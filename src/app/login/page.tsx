"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/password-input";
import { AuthButton, AuthFrame, authField, authLabel } from "@/components/auth-frame";
import { APP_VERSION } from "@/lib/version";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthFrame footer={APP_VERSION}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h1 className="page-title">
            Welcome <span className="font-serif-accent">back</span>
          </h1>
          <p className="mt-1 text-base text-muted">Sign in with your studio account.</p>
        </div>
        <label className={authLabel}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authField}
          />
        </label>
        <label className={authLabel}>
          Password
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <AuthButton busy={loading} busyLabel="Signing in…">
          Sign in
        </AuthButton>
        <a href="/reset" className="text-sm text-brand hover:underline">
          Forgot password? / First time here?
        </a>
      </form>
    </AuthFrame>
  );
}

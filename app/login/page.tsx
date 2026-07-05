"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (otpError) {
        throw otpError;
      }

      setMessage("Magic link sent. Check your inbox and open the link on this device.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <p className="text-xs uppercase tracking-widest text-sky-300">Expense Bot</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
          <p className="mt-2 text-sm text-slate-300">
            We will send a magic login link to your email.
          </p>

          <form className="mt-5 space-y-3" onSubmit={onSubmit}>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-sky-400 focus:ring-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-70"
            >
              {loading ? "Sending..." : "Send Magic Link"}
            </button>
          </form>

          {message ? <p className="mt-3 text-sm text-emerald-300">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        </section>
      </main>
    </div>
  );
}

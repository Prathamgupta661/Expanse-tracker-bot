"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const devAuthEnabled = process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true";

export function LoginClient() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const errorCode = searchParams.get("error");
  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  const googleLoginHref = `/api/auth/google/start?next=${encodeURIComponent(safeNext)}`;
  const [email, setEmail] = useState("");
  const [devLoading, setDevLoading] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  const submitDevLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!devAuthEnabled || devLoading) {
      return;
    }

    setDevLoading(true);
    setDevError(null);
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          next: safeNext,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        nextPath?: string;
        error?: string;
        details?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || payload.details || "Dev login failed");
      }

      window.location.assign(payload.nextPath && payload.nextPath.startsWith("/") ? payload.nextPath : safeNext);
    } catch (caught) {
      setDevError(caught instanceof Error ? caught.message : "Dev login failed");
      setDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <p className="text-xs uppercase tracking-widest text-sky-300">Expense Bot</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
          <p className="mt-2 text-sm text-slate-300">
            Continue with your Google account to open the dashboard.
          </p>

          {devAuthEnabled ? (
            <form className="mt-5 space-y-3 rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-3" onSubmit={(event) => void submitDevLogin(event)}>
              <p className="text-xs uppercase tracking-widest text-emerald-300">Dev Mode Login</p>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-emerald-500"
              />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                disabled={devLoading}
              >
                {devLoading ? "Signing in..." : "Sign in with Email (Dev)"}
              </button>
            </form>
          ) : null}

          <a
            href={googleLoginHref}
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            Continue with Google
          </a>

          {devError ? (
            <p className="mt-3 text-sm text-rose-300">
              Dev sign-in failed: {devError}
            </p>
          ) : null}

          {errorCode ? (
            <p className="mt-3 text-sm text-rose-300">
              Sign-in failed: {errorCode}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

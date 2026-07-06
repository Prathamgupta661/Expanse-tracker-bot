"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

export function LoginClient() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const errorCode = searchParams.get("error");
  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  const googleLoginHref = `/api/auth/google/start?next=${encodeURIComponent(safeNext)}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <p className="text-xs uppercase tracking-widest text-sky-300">Expense Bot</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
          <p className="mt-2 text-sm text-slate-300">
            Continue with your Google account to open the dashboard.
          </p>

          <a
            href={googleLoginHref}
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            Continue with Google
          </a>

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

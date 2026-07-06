import { Suspense } from "react";

import { LoginClient } from "@/app/login/page-client";

function LoginFallback() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <p className="text-xs uppercase tracking-widest text-sky-300">Expense Bot</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
          <p className="mt-3 text-sm text-slate-300">Loading login form...</p>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}

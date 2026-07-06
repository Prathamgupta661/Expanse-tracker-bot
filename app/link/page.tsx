import { Suspense } from "react";

import { LinkClient } from "@/app/link/page-client";

function LinkFallback() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <h1 className="text-xl font-semibold">Telegram Link</h1>
          <p className="mt-3 text-sm text-slate-200">Preparing...</p>
        </section>
      </main>
    </div>
  );
}

export default function LinkPage() {
  return (
    <Suspense fallback={<LinkFallback />}>
      <LinkClient />
    </Suspense>
  );
}

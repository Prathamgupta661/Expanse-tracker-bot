"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const code = searchParams.get("code");
        const tokenHash = searchParams.get("token_hash");
        const type = searchParams.get("type");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            window.location.href,
          );
          if (exchangeError) {
            throw exchangeError;
          }
        } else if (tokenHash && type) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (verifyError) {
            throw verifyError;
          }
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          throw new Error("No active session found. Please request a new magic link.");
        }

        const nextPath = searchParams.get("next");
        router.replace(nextPath && nextPath.startsWith("/") ? nextPath : "/");
      } catch (caught) {
        if (!active) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "Unknown auth callback error");
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <h1 className="text-xl font-semibold">Completing sign-in...</h1>
          {error ? (
            <p className="mt-3 text-sm text-rose-300">
              {error}
              {" "}
              Open /login and request a new link.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-300">Please wait while we verify your session.</p>
          )}
        </section>
      </main>
    </div>
  );
}

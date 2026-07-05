"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LinkPage() {
  const searchParams = useSearchParams();
  const code = useMemo(() => searchParams.get("code") || "", [searchParams]);

  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [loginLink, setLoginLink] = useState("/login");

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!code) {
        setStatus("error");
        setMessage("Missing link code.");
        return;
      }

      setStatus("checking");
      setMessage("Checking login session...");

      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session?.access_token) {
          const next = `/link?code=${encodeURIComponent(code)}`;
          setLoginLink(`/login?next=${encodeURIComponent(next)}`);
          setStatus("error");
          setMessage("You need to log in first.");
          return;
        }

        const response = await fetch("/api/auth/link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code }),
        });

        const payload = (await response.json()) as { error?: string; details?: string };
        if (!response.ok) {
          throw new Error(payload.error || payload.details || "Failed to link account");
        }

        if (!active) {
          return;
        }
        setStatus("done");
        setMessage("Telegram account linked successfully. You can open the dashboard now.");
      } catch (caught) {
        if (!active) {
          return;
        }
        setStatus("error");
        setMessage(caught instanceof Error ? caught.message : "Unknown linking error");
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [code]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <h1 className="text-xl font-semibold">Telegram Link</h1>
          <p className="mt-3 text-sm text-slate-200">{message || "Preparing..."}</p>

          {status === "done" ? (
            <Link
              href="/"
              className="mt-4 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
            >
              Open Dashboard
            </Link>
          ) : null}

          {status === "error" ? (
            <div className="mt-4 flex gap-3">
              <Link
                href={loginLink}
                className="inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
              >
                Login
              </Link>
              <Link
                href="/"
                className="inline-flex rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Back
              </Link>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

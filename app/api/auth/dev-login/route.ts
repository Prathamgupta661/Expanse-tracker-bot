import { NextResponse } from "next/server";

import { createSessionForGoogleIdentity, setSessionCookie } from "@/lib/auth-session";
import { config } from "@/lib/config";
import { getRequestId, logEvent } from "@/lib/logger";
import { listProfilesByEmail } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

function resolveSafeNext(nextPath: string | undefined): string {
  if (!nextPath || !nextPath.startsWith("/")) {
    return "/";
  }
  return nextPath;
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!config.isDevAuthEnabled()) {
      return NextResponse.json(
        { error: "Dev auth is disabled", requestId },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { email?: string; next?: string };
    const email = body.email?.trim().toLowerCase() || "";
    const nextPath = resolveSafeNext(body.next);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address", requestId },
        { status: 400 },
      );
    }

    const allowlist = config.getDevAuthAllowedEmails();
    if (allowlist.length && !allowlist.includes(email)) {
      return NextResponse.json(
        { error: "Email is not allowed for dev auth", requestId },
        { status: 403 },
      );
    }

    const candidates = await listProfilesByEmail(email);
    if (!candidates.length) {
      return NextResponse.json(
        {
          error: "No account found for this email. Send /email <your-email> in Telegram first.",
          requestId,
        },
        { status: 404 },
      );
    }

    const linked = candidates.filter((profile) => Boolean(profile.google_sub));
    let selectedProfile = linked[0];
    if (linked.length > 1) {
      return NextResponse.json(
        {
          error: "Multiple linked accounts found for this email. Use Google login to disambiguate.",
          requestId,
        },
        { status: 409 },
      );
    }

    if (!selectedProfile) {
      if (candidates.length > 1) {
        return NextResponse.json(
          {
            error: "Multiple Telegram accounts found for this email. Link one with Google first.",
            requestId,
          },
          { status: 409 },
        );
      }
      selectedProfile = candidates[0];
    }

    const session = createSessionForGoogleIdentity({
      googleSub: selectedProfile.google_sub || `dev:${email}`,
      email,
      name: email.split("@")[0] || "Dev User",
    });

    const response = NextResponse.json({
      ok: true,
      nextPath,
      requestId,
    });
    setSessionCookie(response, session);

    logEvent({
      requestId,
      route: "/api/auth/dev-login",
      phase: "done",
      severity: "info",
      message: "Dev login successful",
      details: {
        email,
        hasGoogleSub: Boolean(selectedProfile.google_sub),
      },
    });

    return response;
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/auth/dev-login",
      phase: "failed",
      severity: "error",
      message: "Dev login failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Dev login failed",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

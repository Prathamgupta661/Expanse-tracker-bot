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

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  // Strip the port, keeping bracketed IPv6 hosts intact.
  return hostHeader.trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Dev login has no password, so it must never be reachable from outside this machine. Tunnels
 * such as ngrok forward their public hostname in the Host header, which is rejected here.
 */
function isLocalRequest(request: Request): boolean {
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")].filter(
    (value): value is string => Boolean(value),
  );
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTNAMES.has(hostnameOf(host)));
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

    if (!isLocalRequest(request)) {
      logEvent({
        requestId,
        route: "/api/auth/dev-login",
        phase: "rejected_non_local",
        severity: "warn",
        message: "Rejected dev login from a non-local host",
      });
      return NextResponse.json(
        { error: "Dev login is only available on localhost", requestId },
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

import { NextResponse } from "next/server";

import { createOAuthState, setOAuthStateCookie } from "@/lib/auth-session";
import { config } from "@/lib/config";
import { getRequestId, logEvent } from "@/lib/logger";
import { resolveExternalOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tryGetOrigin(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const requestUrl = new URL(request.url);
  const externalOrigin = resolveExternalOrigin(request);
  const configuredBaseOrigin = tryGetOrigin(config.appBaseUrl);
  const nextPath = requestUrl.searchParams.get("next") || "/";
  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  const targetOrigin = configuredBaseOrigin || externalOrigin;
  const originSync = requestUrl.searchParams.get("__origin_sync") === "1";

  logEvent({
    requestId,
    route: "/api/auth/google/start",
    phase: "received",
    severity: "info",
    message: "Google OAuth start received",
    details: {
      externalOrigin,
      configuredBaseOrigin,
      nextPath: safeNext,
      originSync,
    },
  });

  if (configuredBaseOrigin && configuredBaseOrigin !== externalOrigin && !originSync) {
    const forwardStart = new URL("/api/auth/google/start", configuredBaseOrigin);
    forwardStart.searchParams.set("next", safeNext);
    forwardStart.searchParams.set("__origin_sync", "1");
    logEvent({
      requestId,
      route: "/api/auth/google/start",
      phase: "origin_sync_redirect",
      severity: "warn",
      message: "External origin mismatch; redirecting once to configured origin",
      details: {
        externalOrigin,
        configuredBaseOrigin,
      },
    });
    return NextResponse.redirect(forwardStart);
  }

  if (configuredBaseOrigin && configuredBaseOrigin !== externalOrigin && originSync) {
    logEvent({
      requestId,
      route: "/api/auth/google/start",
      phase: "origin_sync_bypass",
      severity: "warn",
      message: "Origin mismatch persisted after sync redirect; proceeding with configured origin",
      details: {
        externalOrigin,
        configuredBaseOrigin,
      },
    });
  }

  const state = createOAuthState(safeNext);
  const redirectUri = config.getGoogleRedirectUri(targetOrigin);
  const redirectOrigin = tryGetOrigin(redirectUri);

  if (redirectOrigin && redirectOrigin !== targetOrigin) {
    logEvent({
      requestId,
      route: "/api/auth/google/start",
      phase: "redirect_origin_mismatch",
      severity: "warn",
      message: "Google redirect URI origin does not match target origin",
      details: {
        externalOrigin,
        targetOrigin,
        redirectOrigin,
        redirectUri,
      },
    });
    const mismatchRedirect = new URL("/login", targetOrigin);
    mismatchRedirect.searchParams.set("error", "google_redirect_origin_mismatch");
    return NextResponse.redirect(mismatchRedirect);
  }

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", config.getGoogleClientId());
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state.nonce);
  googleUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(googleUrl);
  setOAuthStateCookie(response, state);

  logEvent({
    requestId,
    route: "/api/auth/google/start",
    phase: "redirect_google",
    severity: "info",
    message: "Google OAuth redirect generated",
    details: {
      externalOrigin,
      redirectUri,
      hasStateNonce: Boolean(state.nonce),
    },
  });
  return response;
}

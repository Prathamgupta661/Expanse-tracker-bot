import { NextResponse } from "next/server";

import {
  clearOAuthStateCookie,
  createSessionForGoogleIdentity,
  readOAuthState,
  setSessionCookie,
} from "@/lib/auth-session";
import { config } from "@/lib/config";
import { getRequestId, logEvent } from "@/lib/logger";
import { resolveExternalOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenInfoResponse {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  exp?: string;
}

function loginRedirect(baseUrl: string, message?: string): URL {
  const url = new URL("/login", baseUrl);
  if (message) {
    url.searchParams.set("error", message);
  }
  return url;
}

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
  const baseUrl = config.appBaseUrl || externalOrigin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const originSync = requestUrl.searchParams.get("__origin_sync") === "1";
  const oauthState = readOAuthState(request);

  logEvent({
    requestId,
    route: "/api/auth/google/callback",
    phase: "received",
    severity: "info",
    message: "Google OAuth callback received",
    details: {
      externalOrigin,
      configuredBaseOrigin,
      hasCode: Boolean(code),
      hasStateQuery: Boolean(state),
      hasStateCookie: Boolean(oauthState),
      originSync,
    },
  });

  if (configuredBaseOrigin && configuredBaseOrigin !== externalOrigin && !originSync) {
    const forwardCallback = new URL("/api/auth/google/callback", configuredBaseOrigin);
    requestUrl.searchParams.forEach((value, key) => {
      forwardCallback.searchParams.set(key, value);
    });
    forwardCallback.searchParams.set("__origin_sync", "1");
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "origin_sync_redirect",
      severity: "warn",
      message: "External origin mismatch; redirecting once to configured origin",
      details: {
        externalOrigin,
        configuredBaseOrigin,
      },
    });
    return NextResponse.redirect(forwardCallback);
  }

  if (configuredBaseOrigin && configuredBaseOrigin !== externalOrigin && originSync) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "origin_sync_bypass",
      severity: "warn",
      message: "Origin mismatch persisted after sync redirect; proceeding with configured origin",
      details: {
        externalOrigin,
        configuredBaseOrigin,
      },
    });
  }

  if (!code || !state) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "state_query_missing",
      severity: "warn",
      message: "Missing required OAuth callback query params",
      details: {
        hasCode: Boolean(code),
        hasState: Boolean(state),
      },
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_state_missing_query"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  if (!oauthState) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "state_cookie_missing",
      severity: "warn",
      message: "OAuth state cookie missing in callback",
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_state_cookie_missing"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  if (state !== oauthState.nonce) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "state_mismatch",
      severity: "warn",
      message: "OAuth state query does not match cookie nonce",
      details: {
        statePrefix: state.slice(0, 8),
        noncePrefix: oauthState.nonce.slice(0, 8),
      },
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_state_mismatch"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const redirectUri = config.getGoogleRedirectUri(baseUrl);
  const redirectOrigin = tryGetOrigin(redirectUri);
  logEvent({
    requestId,
    route: "/api/auth/google/callback",
    phase: "token_exchange",
    severity: "info",
    message: "Exchanging Google auth code for token",
    details: {
      externalOrigin,
      redirectUri,
      redirectOrigin,
    },
  });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.getGoogleClientId(),
      client_secret: config.getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text();
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "token_exchange_failed",
      severity: "error",
      message: "Google token exchange failed",
      details: details.slice(0, 500),
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_token_exchange_failed"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokenPayload.id_token) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "id_token_missing",
      severity: "warn",
      message: "Google token response missing id_token",
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_id_token_missing"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const tokenInfoResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenPayload.id_token)}`,
  );

  if (!tokenInfoResponse.ok) {
    const details = await tokenInfoResponse.text();
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "token_info_failed",
      severity: "error",
      message: "Google tokeninfo validation failed",
      details: details.slice(0, 500),
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_token_invalid"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const tokenInfo = (await tokenInfoResponse.json()) as GoogleTokenInfoResponse;
  if (!tokenInfo.sub || tokenInfo.aud !== config.getGoogleClientId()) {
    logEvent({
      requestId,
      route: "/api/auth/google/callback",
      phase: "identity_invalid",
      severity: "warn",
      message: "Google identity validation failed",
      details: {
        hasSub: Boolean(tokenInfo.sub),
        audienceMatches: tokenInfo.aud === config.getGoogleClientId(),
      },
    });
    const redirect = NextResponse.redirect(loginRedirect(baseUrl, "google_identity_invalid"));
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const redirectTarget = new URL(
    oauthState.nextPath.startsWith("/") ? oauthState.nextPath : "/",
    baseUrl,
  );
  const response = NextResponse.redirect(redirectTarget);
  setSessionCookie(
    response,
    createSessionForGoogleIdentity({
      googleSub: tokenInfo.sub,
      email: tokenInfo.email || null,
      name: tokenInfo.name || null,
    }),
  );
  clearOAuthStateCookie(response);
  logEvent({
    requestId,
    route: "/api/auth/google/callback",
    phase: "done",
    severity: "info",
    message: "Google OAuth callback completed",
    details: {
      redirectTo: redirectTarget.pathname,
      hasEmail: Boolean(tokenInfo.email),
    },
  });
  return response;
}

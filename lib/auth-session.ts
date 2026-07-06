import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config";

const SESSION_COOKIE_NAME = "app_session";
const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AppAuthSession {
  googleSub: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
}

interface OAuthStatePayload {
  nonce: string;
  nextPath: string;
}

function base64UrlEncode(input: Buffer | string): string {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return source.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }
    result[rawKey] = decodeURIComponent(rawValueParts.join("=") || "");
  }
  return result;
}

function createJwt(payload: AppAuthSession, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = sign(data, secret);
  return `${data}.${signature}`;
}

function verifyJwt(token: string, secret: string): AppAuthSession | null {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(data, secret);

  const providedBuffer = Buffer.from(encodedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: AppAuthSession;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as AppAuthSession;
  } catch {
    return null;
  }

  if (!payload.googleSub || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

export function createSessionForGoogleIdentity(identity: {
  googleSub: string;
  email?: string | null;
  name?: string | null;
}): AppAuthSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    googleSub: identity.googleSub,
    email: identity.email || null,
    name: identity.name || null,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
}

export function getSessionFromRequest(request: Request): AppAuthSession | null {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  return verifyJwt(token, config.getAppAuthSecret());
}

export function setSessionCookie(response: Response, session: AppAuthSession): void {
  const token = createJwt(session, config.getAppAuthSecret());
  const cookie = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  response.headers.append("Set-Cookie", cookie);
}

export function clearSessionCookie(response: Response): void {
  const cookie = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  response.headers.append("Set-Cookie", cookie);
}

export function createOAuthState(nextPath: string): OAuthStatePayload {
  return {
    nonce: randomBytes(24).toString("base64url"),
    nextPath: nextPath.startsWith("/") ? nextPath : "/",
  };
}

export function setOAuthStateCookie(response: Response, payload: OAuthStatePayload): void {
  const value = base64UrlEncode(JSON.stringify(payload));
  const cookie = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  response.headers.append("Set-Cookie", cookie);
}

export function readOAuthState(request: Request): OAuthStatePayload | null {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  const raw = cookies[OAUTH_STATE_COOKIE_NAME];
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(raw).toString("utf8")) as OAuthStatePayload;
    if (!parsed.nonce || !parsed.nextPath) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthStateCookie(response: Response): void {
  const cookie = [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  response.headers.append("Set-Cookie", cookie);
}

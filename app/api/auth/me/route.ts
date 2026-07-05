import { NextResponse } from "next/server";

import { getRequestId, logEvent } from "@/lib/logger";
import { resolveAuthIdentityFromRequest, resolveProfileFromRequest } from "@/lib/request-user";
import { linkProfileAuthUser, listProfilesByEmail } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const identity = await resolveAuthIdentityFromRequest(request);
    if (!identity) {
      return NextResponse.json({ authenticated: false, requestId }, { status: 401 });
    }

    let profile = await resolveProfileFromRequest(request);

    if (!profile && identity.email) {
      const candidates = await listProfilesByEmail(identity.email);
      const unlinked = candidates.filter((item) => !item.auth_user_id);

      if (unlinked.length === 1) {
        profile = await linkProfileAuthUser({
          userId: unlinked[0].user_id,
          authUserId: identity.authUserId,
          email: identity.email,
        });
      }
    }

    return NextResponse.json({
      authenticated: true,
      authUserId: identity.authUserId,
      email: identity.email,
      profile,
      linked: Boolean(profile),
      requestId,
    });
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/auth/me",
      phase: "failed",
      severity: "error",
      message: "Failed to fetch auth session",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to fetch auth session",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

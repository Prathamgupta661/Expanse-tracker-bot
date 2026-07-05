import { NextResponse } from "next/server";

import { resolveAuthIdentityFromRequest } from "@/lib/request-user";
import { consumeAuthLinkRequest } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = await resolveAuthIdentityFromRequest(request);
    if (!identity || !identity.email) {
      return NextResponse.json(
        { error: "Login is required before linking account" },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as { code?: string };
    const code = payload.code?.trim();
    if (!code) {
      return NextResponse.json({ error: "Link code is required" }, { status: 400 });
    }

    const profile = await consumeAuthLinkRequest({
      code,
      authUserId: identity.authUserId,
      authEmail: identity.email,
    });

    return NextResponse.json({
      ok: true,
      linked: true,
      profile,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to link account",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}

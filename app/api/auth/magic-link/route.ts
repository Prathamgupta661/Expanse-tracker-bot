import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { next?: string };
    const nextPath = payload.next?.startsWith("/") ? payload.next : "/";

    return NextResponse.json({
      error: "Magic link login is disabled",
      message: "Use Google sign-in instead",
      loginUrl: `/api/auth/google/start?next=${encodeURIComponent(nextPath)}`,
    }, { status: 410 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to process auth request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

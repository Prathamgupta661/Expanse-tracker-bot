import { NextResponse } from "next/server";

import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; next?: string };
    const email = payload.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const baseUrl = config.appBaseUrl || new URL(request.url).origin;
    const nextPath = payload.next?.startsWith("/") ? payload.next : "/";
    const redirectUrl = `${baseUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const response = await fetch(`${config.getSupabaseUrl()}/auth/v1/otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.getSupabaseAnonKey(),
        Authorization: `Bearer ${config.getSupabaseAnonKey()}`,
      },
      body: JSON.stringify({
        email,
        create_user: true,
        email_redirect_to: redirectUrl,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        {
          error: "Failed to send magic link",
          details,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Magic link sent",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to initiate login",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

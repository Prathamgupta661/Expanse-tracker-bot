import { NextResponse } from "next/server";

import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const configured = config.cronSecret;
  if (!configured) {
    return false;
  }

  const incoming = request.headers.get("x-cron-secret");
  return incoming === configured;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      message: "Rule-based categorization is active. No AI queue processing is required.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Categorization cron failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

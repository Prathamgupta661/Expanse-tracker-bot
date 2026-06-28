import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { generateAndStoreInsightForProfile } from "@/lib/insights";
import { listProfiles } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const configured = config.cronSecret;
  if (!configured) {
    return false;
  }
  const token = request.headers.get("x-cron-secret");
  return token === configured;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profiles = await listProfiles(1000);
    const summary = {
      totalProfiles: profiles.length,
      generated: 0,
      failed: 0,
      errors: [] as Array<{ userId: string; message: string }>,
    };

    for (const profile of profiles) {
      try {
        await generateAndStoreInsightForProfile({
          profile,
          period: "daily",
          force: false,
        });
        summary.generated += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          userId: profile.user_id,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Cron execution failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

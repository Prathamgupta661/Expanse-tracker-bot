import { NextResponse } from "next/server";

import { getInsightForUser } from "@/lib/insights";
import { InsightPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsightPeriod(value: string): value is InsightPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const periodParam = searchParams.get("period") || "daily";
    const generateParam = searchParams.get("generate");

    if (!userId) {
      return badRequest("Missing required query param: userId");
    }

    if (!isInsightPeriod(periodParam)) {
      return badRequest("Invalid period. Use daily, weekly, or monthly.");
    }

    const insight = await getInsightForUser({
      userId,
      period: periodParam,
      generate: generateParam === "true",
    });

    return NextResponse.json({ insight });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch insight",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

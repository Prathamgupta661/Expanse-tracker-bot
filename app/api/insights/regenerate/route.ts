import { NextResponse } from "next/server";

import { generateAndStoreInsight } from "@/lib/insights";
import { InsightPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsightPeriod(value: string): value is InsightPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      userId?: string;
      period?: string;
    };

    if (!payload.userId) {
      return NextResponse.json({ error: "Missing required field: userId" }, { status: 400 });
    }

    const period = payload.period || "daily";
    if (!isInsightPeriod(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use daily, weekly, or monthly." },
        { status: 400 },
      );
    }

    const insight = await generateAndStoreInsight({
      userId: payload.userId,
      period,
      force: true,
    });

    return NextResponse.json({ insight });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to regenerate insight",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { generateAndStoreInsight } from "@/lib/insights";
import { getRequestId, logEvent } from "@/lib/logger";
import { resolveProfileFromRequest } from "@/lib/request-user";
import { InsightPeriod } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsightPeriod(value: string): value is InsightPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    logEvent({
      requestId,
      route: "/api/insights/regenerate",
      phase: "received",
      severity: "info",
      message: "Insight regenerate request received",
    });

    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const payload = (await request.json()) as {
      period?: string;
    };

    const period = payload.period || "daily";
    if (!isInsightPeriod(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use daily, weekly, or monthly." },
        { status: 400 },
      );
    }

    const insight = await generateAndStoreInsight({
      userId: profile.user_id,
      period,
      force: true,
      requestId,
    });

    const fallbackUsed = insight.model.startsWith("fallback");
    const parseFailed = insight.model === "fallback-parser";

    logEvent({
      requestId,
      route: "/api/insights/regenerate",
      phase: "done",
      severity: "info",
      message: "Insight regenerate completed",
      details: { period, fallbackUsed, parseFailed, model: insight.model },
    });

    return NextResponse.json({ insight, fallbackUsed, parseFailed, requestId });
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/insights/regenerate",
      phase: "failed",
      severity: "error",
      message: "Failed to regenerate insight",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to regenerate insight",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

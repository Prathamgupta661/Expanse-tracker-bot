import { NextResponse } from "next/server";

import { getInsightForUser } from "@/lib/insights";
import { getRequestId, logEvent } from "@/lib/logger";
import { resolveProfileFromRequest } from "@/lib/request-user";
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
  const requestId = getRequestId(request);
  try {
    logEvent({
      requestId,
      route: "/api/insights",
      phase: "received",
      severity: "info",
      message: "Insights request received",
    });

    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      logEvent({
        requestId,
        route: "/api/insights",
        phase: "auth",
        severity: "warn",
        message: "Unauthorized insight request",
      });
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get("period") || "daily";
    const requestedGenerate = searchParams.get("generate") === "true";

    if (!isInsightPeriod(periodParam)) {
      return badRequest("Invalid period. Use daily, weekly, or monthly.");
    }

    const insight = await getInsightForUser({
      userId: profile.user_id,
      period: periodParam,
      generate: requestedGenerate,
    });

    const cacheMiss = insight === null && !requestedGenerate;
    logEvent({
      requestId,
      route: "/api/insights",
      phase: cacheMiss ? "cache_miss" : "done",
      severity: "info",
      message: cacheMiss ? "No cached insight found" : "Insight response ready",
      details: {
        period: periodParam,
        requestedGenerate,
      },
    });

    return NextResponse.json({ insight, cacheMiss, requestId });
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/insights",
      phase: "failed",
      severity: "error",
      message: "Failed to fetch insight",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to fetch insight",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

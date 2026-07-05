import { formatCurrency } from "@/lib/analytics";
import { logEvent } from "@/lib/logger";
import {
  generateInsightWithOpenRouter,
  OpenRouterInsightParseError,
  OpenRouterTimeoutError,
} from "@/lib/openrouter";
import {
  getCachedInsight,
  getLatestInsight,
  getProfileByUserId,
  listExpensesByUser,
  upsertInsight,
} from "@/lib/supabase";
import { InsightPeriod, InsightRecord, NewInsightRecord, Profile } from "@/lib/types";

const PERIOD_WINDOWS_DAYS: Record<InsightPeriod, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function buildBucketKey(period: InsightPeriod, now: Date = new Date()): string {
  if (period === "daily") {
    return formatUtcDate(now);
  }
  if (period === "weekly") {
    return getWeekKey(now);
  }
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function windowForPeriod(period: InsightPeriod, now: Date = new Date()): {
  start: string;
  end: string;
} {
  const end = new Date(now);
  const days = PERIOD_WINDOWS_DAYS[period];
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function fallbackInsight(record: {
  userId: string;
  period: InsightPeriod;
  bucketKey: string;
  start: string;
  end: string;
  reason: string;
  model?: string;
}): InsightRecord {
  return {
    id: "fallback",
    user_id: record.userId,
    period: record.period,
    bucket_key: record.bucketKey,
    period_start: record.start,
    period_end: record.end,
    summary: record.reason,
    anomalies: [],
    tips: ["Add more categorized expenses to improve insight quality."],
    model: record.model || "fallback",
    generated_at: new Date().toISOString(),
  };
}

function buildFallbackFromExpenses(params: {
  userId: string;
  period: InsightPeriod;
  bucketKey: string;
  start: string;
  end: string;
  currency: string;
  expenses: Array<{ amount: number; category: string; expense_date: string }>;
  reason: string;
}): InsightRecord {
  const total = params.expenses.reduce((sum, item) => sum + item.amount, 0);
  const dailyAverage = params.expenses.length ? total / params.expenses.length : 0;

  const categoryMap = new Map<string, number>();
  for (const expense of params.expenses) {
    categoryMap.set(expense.category, (categoryMap.get(expense.category) || 0) + expense.amount);
  }

  const topCategories = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const topText = topCategories.length
    ? topCategories
        .map(([category, amount]) => `${category}: ${formatCurrency(amount, params.currency)}`)
        .join(", ")
    : "No category leaders yet.";

  const summary = [
    `${params.period} snapshot: ${params.expenses.length} expense(s) totaling ${formatCurrency(total, params.currency)}.`,
    `Top categories: ${topText}`,
  ].join(" ");

  const anomalies = [
    `Average transaction size is ${formatCurrency(dailyAverage, params.currency)}.`,
  ];

  const tips = [
    "Use consistent note names (e.g. uber, grocery) for better categorization.",
    "Run regenerate insight again after adding more entries.",
  ];

  return {
    id: "fallback-parser",
    user_id: params.userId,
    period: params.period,
    bucket_key: params.bucketKey,
    period_start: params.start,
    period_end: params.end,
    summary,
    anomalies,
    tips,
    model: "fallback-parser",
    generated_at: new Date().toISOString(),
  };
}

export async function generateAndStoreInsight(params: {
  userId: string;
  period: InsightPeriod;
  force?: boolean;
  requestId?: string;
}): Promise<InsightRecord> {
  const profile = await getProfileByUserId(params.userId);
  if (!profile) {
    throw new Error(`Profile not found for user_id=${params.userId}`);
  }

  return generateAndStoreInsightForProfile({
    profile,
    period: params.period,
    force: params.force,
    requestId: params.requestId,
  });
}

export async function generateAndStoreInsightForProfile(params: {
  profile: Profile;
  period: InsightPeriod;
  force?: boolean;
  requestId?: string;
}): Promise<InsightRecord> {
  const now = new Date();
  const bucketKey = buildBucketKey(params.period, now);

  if (!params.force) {
    const cached = await getCachedInsight({
      userId: params.profile.user_id,
      period: params.period,
      bucketKey,
    });
    if (cached) {
      return cached;
    }
  }

  const { start, end } = windowForPeriod(params.period, now);
  const expenses = await listExpensesByUser(params.profile.user_id, {
    from: start,
    to: end,
    limit: 500,
  });

  if (!expenses.length) {
    return fallbackInsight({
      userId: params.profile.user_id,
      period: params.period,
      bucketKey,
      start,
      end,
      reason: "No spending data found for this period.",
    });
  }

  try {
    const parsed = await generateInsightWithOpenRouter({
      expenses,
      timezone: params.profile.timezone,
      currency: params.profile.currency,
    });

    const record: NewInsightRecord = {
      user_id: params.profile.user_id,
      period: params.period,
      bucket_key: bucketKey,
      period_start: start,
      period_end: end,
      summary: parsed.summary,
      anomalies: parsed.anomalies,
      tips: parsed.tips,
      model: parsed.model,
    };

    return upsertInsight(record);
  } catch (error) {
    if (
      error instanceof OpenRouterInsightParseError ||
      error instanceof OpenRouterTimeoutError
    ) {
      if (params.requestId) {
        logEvent({
          requestId: params.requestId,
          route: "/lib/insights",
          phase: "fallback_used",
          severity: "warn",
          message: "Using deterministic fallback insight due to model parse/timeout issue",
          details: error.message,
        });
      }

      const fallback = buildFallbackFromExpenses({
        userId: params.profile.user_id,
        period: params.period,
        bucketKey,
        start,
        end,
        currency: params.profile.currency,
        expenses,
        reason: error.message,
      });

      const record: NewInsightRecord = {
        user_id: fallback.user_id,
        period: fallback.period,
        bucket_key: fallback.bucket_key,
        period_start: fallback.period_start,
        period_end: fallback.period_end,
        summary: fallback.summary,
        anomalies: fallback.anomalies,
        tips: fallback.tips,
        model: fallback.model,
      };
      return upsertInsight(record);
    }

    throw error;
  }
}

export async function getInsightForUser(params: {
  userId: string;
  period: InsightPeriod;
  generate?: boolean;
}): Promise<InsightRecord | null> {
  if (params.generate) {
    return generateAndStoreInsight({
      userId: params.userId,
      period: params.period,
    });
  }

  const latest = await getLatestInsight({
    userId: params.userId,
    period: params.period,
  });

  return latest || null;
}

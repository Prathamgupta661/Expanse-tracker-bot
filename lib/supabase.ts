import { createHash } from "node:crypto";

import { config } from "@/lib/config";
import { Expense, IngestionEvent, InsightPeriod, InsightRecord, NewExpense, NewInsightRecord, Profile } from "@/lib/types";

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface SupabaseRequestOptions<TBody> {
  path: string;
  method?: RestMethod;
  query?: Record<string, string>;
  body?: TBody;
  prefer?: string;
}

function buildUrl(path: string, query: Record<string, string> = {}): string {
  const url = new URL(`/rest/v1/${path}`, config.getSupabaseUrl());
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function supabaseRequest<TResponse, TBody = unknown>({
  path,
  method = "GET",
  query,
  body,
  prefer,
}: SupabaseRequestOptions<TBody>): Promise<TResponse> {
  const key = config.getSupabaseServiceRoleKey();
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Supabase ${method} ${path} failed (${response.status}): ${payload}`);
  }

  if (response.status === 204) {
    return null as TResponse;
  }

  return (await response.json()) as TResponse;
}

export function deriveUserIdFromTelegramId(telegramId: number): string {
  const hex = createHash("sha256")
    .update(`telegram:${telegramId}`)
    .digest("hex")
    .slice(0, 32);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function getProfileByTelegramId(telegramId: number): Promise<Profile | null> {
  const rows = await supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      telegram_id: `eq.${telegramId}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function getProfileByUserId(userId: string): Promise<Profile | null> {
  const rows = await supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      user_id: `eq.${userId}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function listProfiles(limit = 200): Promise<Profile[]> {
  return supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      order: "created_at.asc",
      limit: String(limit),
      select: "*",
    },
  });
}

export async function upsertTelegramProfile(params: {
  telegramId: number;
  timezone: string;
  currency: string;
}): Promise<Profile> {
  const userId = deriveUserIdFromTelegramId(params.telegramId);

  const rows = await supabaseRequest<Profile[], Array<Partial<Profile>>>({
    path: "profiles",
    method: "POST",
    query: { on_conflict: "telegram_id", select: "*" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        user_id: userId,
        telegram_id: params.telegramId,
        timezone: params.timezone,
        currency: params.currency,
      },
    ],
  });

  if (!rows[0]) {
    throw new Error("Failed to upsert Telegram profile");
  }
  return rows[0];
}

export async function listExpensesByUser(
  userId: string,
  options: { from?: string; to?: string; limit?: number } = {},
): Promise<Expense[]> {
  const query: Record<string, string> = {
    user_id: `eq.${userId}`,
    order: "expense_date.desc",
    select: "*",
    limit: String(options.limit || 200),
  };

  if (options.from && options.to) {
    query.and = `(expense_date.gte.${options.from},expense_date.lte.${options.to})`;
  } else if (options.from) {
    query.expense_date = `gte.${options.from}`;
  } else if (options.to) {
    query.expense_date = `lte.${options.to}`;
  }

  const rows = await supabaseRequest<Expense[]>({
    path: "expenses",
    query,
  });

  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    confidence: Number(row.confidence),
  }));
}

export async function insertExpenses(rows: NewExpense[]): Promise<Expense[]> {
  if (!rows.length) {
    return [];
  }

  const inserted = await supabaseRequest<Expense[], NewExpense[]>({
    path: "expenses",
    method: "POST",
    query: { select: "*" },
    prefer: "return=representation",
    body: rows,
  });

  return inserted.map((row) => ({
    ...row,
    amount: Number(row.amount),
    confidence: Number(row.confidence),
  }));
}

export async function patchExpenseById(params: {
  expenseId: string;
  userId: string;
  fields: Partial<Pick<Expense, "category" | "merchant" | "note" | "expense_date">>;
}): Promise<Expense | null> {
  const updated = await supabaseRequest<Expense[], typeof params.fields>({
    path: "expenses",
    method: "PATCH",
    query: {
      id: `eq.${params.expenseId}`,
      user_id: `eq.${params.userId}`,
      select: "*",
      limit: "1",
    },
    prefer: "return=representation",
    body: params.fields,
  });

  if (!updated[0]) {
    return null;
  }

  return {
    ...updated[0],
    amount: Number(updated[0].amount),
    confidence: Number(updated[0].confidence),
  };
}

export async function deleteExpenseById(expenseId: string, userId: string): Promise<boolean> {
  await supabaseRequest<null>({
    path: "expenses",
    method: "DELETE",
    query: {
      id: `eq.${expenseId}`,
      user_id: `eq.${userId}`,
    },
  });

  return true;
}

export async function getCachedInsight(params: {
  userId: string;
  period: InsightPeriod;
  bucketKey: string;
}): Promise<InsightRecord | null> {
  const rows = await supabaseRequest<InsightRecord[]>({
    path: "ai_insights",
    query: {
      user_id: `eq.${params.userId}`,
      period: `eq.${params.period}`,
      bucket_key: `eq.${params.bucketKey}`,
      limit: "1",
      select: "*",
    },
  });

  return rows[0] || null;
}

export async function getLatestInsight(params: {
  userId: string;
  period: InsightPeriod;
}): Promise<InsightRecord | null> {
  const rows = await supabaseRequest<InsightRecord[]>({
    path: "ai_insights",
    query: {
      user_id: `eq.${params.userId}`,
      period: `eq.${params.period}`,
      limit: "1",
      select: "*",
      order: "generated_at.desc",
    },
  });

  return rows[0] || null;
}

export async function upsertInsight(record: NewInsightRecord): Promise<InsightRecord> {
  const rows = await supabaseRequest<InsightRecord[], NewInsightRecord[]>({
    path: "ai_insights",
    method: "POST",
    query: { on_conflict: "user_id,period,bucket_key", select: "*" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: [record],
  });

  if (!rows[0]) {
    throw new Error("Failed to upsert insight");
  }

  return rows[0];
}

export async function createIngestionEvent(params: {
  userId: string;
  rawText: string;
  sourceUpdateId?: string;
}): Promise<IngestionEvent> {
  const rows = await supabaseRequest<IngestionEvent[], Array<Partial<IngestionEvent>>>({
    path: "ingestion_events",
    method: "POST",
    query: { select: "*" },
    prefer: "return=representation",
    body: [
      {
        user_id: params.userId,
        raw_text: params.rawText,
        source_update_id: params.sourceUpdateId || null,
        status: "received",
      },
    ],
  });

  if (!rows[0]) {
    throw new Error("Failed to create ingestion event");
  }

  return rows[0];
}

export async function getIngestionByUpdateId(updateId: string): Promise<IngestionEvent | null> {
  const rows = await supabaseRequest<IngestionEvent[]>({
    path: "ingestion_events",
    query: {
      source_update_id: `eq.${updateId}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function updateIngestionEvent(params: {
  id: string;
  status: "processed" | "failed";
  parsedPayload?: unknown;
  error?: string;
}): Promise<void> {
  await supabaseRequest<null, Record<string, unknown>>({
    path: "ingestion_events",
    method: "PATCH",
    query: {
      id: `eq.${params.id}`,
    },
    body: {
      status: params.status,
      parsed_payload: params.parsedPayload || null,
      error: params.error || null,
      updated_at: new Date().toISOString(),
    },
  });
}

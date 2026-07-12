import { createHash, randomBytes } from "node:crypto";

import { config } from "@/lib/config";
import {
  AuthLinkRequest,
  CategorySource,
  CategorizationJob,
  CategorizationJobStatus,
  Expense,
  IngestionEvent,
  InsightPeriod,
  InsightRecord,
  NewExpense,
  NewInsightRecord,
  Profile,
  ProfileTelegramLink,
} from "@/lib/types";

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

  const text = await response.text();
  if (!text) {
    return null as TResponse;
  }

  return JSON.parse(text) as TResponse;
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

export async function getTelegramLinkByTelegramId(telegramId: number): Promise<ProfileTelegramLink | null> {
  const rows = await supabaseRequest<ProfileTelegramLink[]>({
    path: "profile_telegram_links",
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

export async function getProfileByAuthUserId(authUserId: string): Promise<Profile | null> {
  const rows = await supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      auth_user_id: `eq.${authUserId}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function getProfileByGoogleSub(googleSub: string): Promise<Profile | null> {
  const rows = await supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      google_sub: `eq.${googleSub}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function listProfilesByEmail(email: string): Promise<Profile[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return supabaseRequest<Profile[]>({
    path: "profiles",
    query: {
      email: `eq.${normalized}`,
      select: "*",
      order: "created_at.asc",
    },
  });
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

export async function upsertProfileTelegramLink(params: {
  ownerUserId: string;
  telegramId: number;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
}): Promise<ProfileTelegramLink> {
  const rows = await supabaseRequest<ProfileTelegramLink[], Array<Partial<ProfileTelegramLink>>>({
    path: "profile_telegram_links",
    method: "POST",
    query: { on_conflict: "telegram_id", select: "*" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: [
      {
        owner_user_id: params.ownerUserId,
        telegram_id: params.telegramId,
        telegram_username: params.telegramUsername || null,
        telegram_first_name: params.telegramFirstName || null,
        telegram_last_name: params.telegramLastName || null,
      },
    ],
  });

  if (!rows[0]) {
    throw new Error("Failed to upsert Telegram profile link");
  }
  return rows[0];
}

export async function updateProfileEmailByUserId(params: {
  userId: string;
  email: string;
}): Promise<Profile> {
  const normalized = params.email.trim().toLowerCase();
  const rows = await supabaseRequest<Profile[], Record<string, unknown>>({
    path: "profiles",
    method: "PATCH",
    query: {
      user_id: `eq.${params.userId}`,
      select: "*",
      limit: "1",
    },
    prefer: "return=representation",
    body: {
      email: normalized,
      email_collected_at: new Date().toISOString(),
    },
  });

  if (!rows[0]) {
    throw new Error("Failed to update profile email");
  }

  return rows[0];
}

export async function listExpensesByUser(
  userId: string,
  options: { from?: string; to?: string; limit?: number; categorySources?: CategorySource[] } = {},
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

  if (options.categorySources?.length) {
    query.category_source = `in.(${options.categorySources.join(",")})`;
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

export async function getExpenseById(expenseId: string): Promise<Expense | null> {
  const rows = await supabaseRequest<Expense[]>({
    path: "expenses",
    query: {
      id: `eq.${expenseId}`,
      limit: "1",
      select: "*",
    },
  });

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    amount: Number(rows[0].amount),
    confidence: Number(rows[0].confidence),
  };
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
  fields: Partial<
    Pick<Expense, "category" | "merchant" | "note" | "expense_date" | "category_source" | "category_reason">
  >;
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

export async function patchExpenseByIdAny(params: {
  expenseId: string;
  fields: Partial<
    Pick<Expense, "category" | "merchant" | "note" | "expense_date" | "category_source" | "category_reason" | "confidence">
  >;
}): Promise<Expense | null> {
  const updated = await supabaseRequest<Expense[], typeof params.fields>({
    path: "expenses",
    method: "PATCH",
    query: {
      id: `eq.${params.expenseId}`,
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

function generateLinkCode(): string {
  return randomBytes(24).toString("base64url");
}

export async function createAuthLinkRequest(params: {
  userId: string;
  email: string;
  ttlMinutes?: number;
}): Promise<AuthLinkRequest> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMinutes || 15) * 60 * 1000).toISOString();

  const code = generateLinkCode();
  const rows = await supabaseRequest<AuthLinkRequest[], Array<Partial<AuthLinkRequest>>>({
    path: "auth_link_requests",
    method: "POST",
    query: { select: "*" },
    prefer: "return=representation",
    body: [
      {
        user_id: params.userId,
        email: params.email.trim().toLowerCase(),
        code,
        expires_at: expiresAt,
      },
    ],
  });

  if (!rows[0]) {
    throw new Error("Failed to create auth link request");
  }

  return rows[0];
}

export async function getAuthLinkRequestByCode(code: string): Promise<AuthLinkRequest | null> {
  const rows = await supabaseRequest<AuthLinkRequest[]>({
    path: "auth_link_requests",
    query: {
      code: `eq.${code}`,
      limit: "1",
      select: "*",
    },
  });
  return rows[0] || null;
}

export async function consumeAuthLinkRequest(params: {
  code: string;
  googleSub: string;
  googleEmail: string;
}): Promise<Profile> {
  const request = await getAuthLinkRequestByCode(params.code);
  if (!request) {
    throw new Error("Invalid link code");
  }

  if (request.consumed_at) {
    throw new Error("Link code already used");
  }

  if (new Date(request.expires_at).getTime() < Date.now()) {
    throw new Error("Link code expired");
  }

  const normalizedAuthEmail = params.googleEmail.trim().toLowerCase();
  if (normalizedAuthEmail !== request.email.trim().toLowerCase()) {
    throw new Error("Logged in email does not match Telegram email");
  }

  const linkedRows = await supabaseRequest<Profile[], Record<string, unknown>>({
    path: "profiles",
    method: "PATCH",
    query: {
      user_id: `eq.${request.user_id}`,
      select: "*",
      limit: "1",
    },
    prefer: "return=representation",
    body: {
      google_sub: params.googleSub,
      email: normalizedAuthEmail,
    },
  });

  if (!linkedRows[0]) {
    throw new Error("Failed to link auth account");
  }

  await supabaseRequest<null, Record<string, unknown>>({
    path: "auth_link_requests",
    method: "PATCH",
    query: {
      id: `eq.${request.id}`,
    },
    body: { consumed_at: new Date().toISOString() },
  });

  return linkedRows[0];
}

export async function linkProfileAuthUser(params: {
  userId: string;
  googleSub: string;
  email?: string;
}): Promise<Profile> {
  const rows = await supabaseRequest<Profile[], Record<string, unknown>>({
    path: "profiles",
    method: "PATCH",
    query: {
      user_id: `eq.${params.userId}`,
      select: "*",
      limit: "1",
    },
    prefer: "return=representation",
    body: {
      google_sub: params.googleSub,
      ...(params.email ? { email: params.email.trim().toLowerCase() } : {}),
    },
  });

  if (!rows[0]) {
    throw new Error("Failed to link profile");
  }
  return rows[0];
}

export async function createCategorizationJobs(expenses: Expense[]): Promise<void> {
  if (!expenses.length) {
    return;
  }

  await supabaseRequest<CategorizationJob[], Array<Partial<CategorizationJob>>>({
    path: "expense_categorization_jobs",
    method: "POST",
    query: { select: "id", on_conflict: "expense_id" },
    prefer: "resolution=merge-duplicates,return=representation",
    body: expenses.map((expense) => ({
      expense_id: expense.id,
      user_id: expense.user_id,
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
    })),
  });
}

export async function listCategorizationJobs(limit = 50): Promise<CategorizationJob[]> {
  return supabaseRequest<CategorizationJob[]>({
    path: "expense_categorization_jobs",
    query: {
      status: "eq.pending",
      order: "next_attempt_at.asc",
      limit: String(limit),
      select: "*",
    },
  });
}

export async function countCategorizationJobsByUser(
  userId: string,
  statuses: CategorizationJobStatus[],
): Promise<number> {
  if (!statuses.length) {
    return 0;
  }

  const rows = await supabaseRequest<Array<{ id: string }>>({
    path: "expense_categorization_jobs",
    query: {
      user_id: `eq.${userId}`,
      status: `in.(${statuses.join(",")})`,
      select: "id",
      limit: "5000",
    },
  });

  return rows.length;
}

export async function updateCategorizationJob(params: {
  jobId: string;
  status: CategorizationJobStatus;
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string | null;
}): Promise<void> {
  await supabaseRequest<null, Record<string, unknown>>({
    path: "expense_categorization_jobs",
    method: "PATCH",
    query: {
      id: `eq.${params.jobId}`,
    },
    body: {
      status: params.status,
      attempts: params.attempts,
      next_attempt_at: params.nextAttemptAt,
      last_error: params.lastError ?? null,
      updated_at: new Date().toISOString(),
    },
  });
}

export type InsightPeriod = "daily" | "weekly" | "monthly";

export type ExpenseSource = "telegram" | "dashboard";
export type CategorySource = "rule" | "ai" | "manual";
export type CategorizationJobStatus = "pending" | "processing" | "done" | "failed";

export interface MobileExpenseLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
}

export interface MobileExpenseMeta {
  event_id: string;
  channel: "notification" | "sms";
  app_or_sender: string | null;
  payload_hash: string;
  fingerprint: string;
  captured_at: string;
  duplicate_of_expense_id?: string | null;
  location?: MobileExpenseLocation | null;
}

export interface Profile {
  user_id: string;
  telegram_id: number | null;
  auth_user_id: string | null;
  google_sub: string | null;
  email: string | null;
  email_collected_at: string | null;
  timezone: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  category: string;
  merchant: string;
  note: string;
  expense_date: string;
  source: ExpenseSource;
  category_source: CategorySource;
  category_reason: string | null;
  confidence: number;
  mobile_meta: MobileExpenseMeta | null;
  added_by_telegram_id: number | null;
  added_by_telegram_name: string | null;
  created_at: string;
}

export interface NewExpense {
  user_id: string;
  amount: number;
  currency: string;
  category: string;
  merchant: string;
  note: string;
  expense_date: string;
  source: ExpenseSource;
  category_source?: CategorySource;
  category_reason?: string;
  confidence?: number;
  mobile_meta?: MobileExpenseMeta | null;
  added_by_telegram_id?: number | null;
  added_by_telegram_name?: string | null;
}

export interface ProfileTelegramLink {
  id: string;
  owner_user_id: string;
  telegram_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  linked_at: string;
  created_at: string;
  updated_at: string;
}

export interface ParsedExpenseLine {
  amount: number;
  category: string;
  merchant: string;
  note: string;
}

export interface InvalidExpenseLine {
  line: string;
  reason: string;
}

export interface InsightRecord {
  id: string;
  user_id: string;
  period: InsightPeriod;
  bucket_key: string;
  period_start: string;
  period_end: string;
  summary: string;
  anomalies: string[];
  tips: string[];
  model: string;
  generated_at: string;
}

export interface NewInsightRecord {
  user_id: string;
  period: InsightPeriod;
  bucket_key: string;
  period_start: string;
  period_end: string;
  summary: string;
  anomalies: string[];
  tips: string[];
  model: string;
}

export interface ParsedInsight {
  summary: string;
  anomalies: string[];
  tips: string[];
  model: string;
}

export interface IngestionEvent {
  id: string;
  user_id: string;
  source_update_id: string | null;
  raw_text: string;
  parsed_payload: unknown;
  status: "received" | "processed" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseStats {
  totalAmount: number;
  count: number;
  categoryTotals: Array<{ category: string; total: number }>;
  dailyTotals: Array<{ date: string; total: number }>;
}

export interface AuthLinkRequest {
  id: string;
  user_id: string;
  email: string;
  code: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface CategorizationJob {
  id: string;
  expense_id: string;
  user_id: string;
  status: CategorizationJobStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

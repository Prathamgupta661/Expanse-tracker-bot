export type InsightPeriod = "daily" | "weekly" | "monthly";

export type ExpenseSource = "telegram" | "dashboard";

export interface Profile {
  user_id: string;
  telegram_id: number | null;
  auth_user_id: string | null;
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
  confidence: number;
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
  confidence?: number;
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

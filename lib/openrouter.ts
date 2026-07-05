import { config } from "@/lib/config";
import { Expense, ParsedInsight } from "@/lib/types";

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenRouterInsightParseError extends Error {
  rawContent: string;

  constructor(message: string, rawContent: string) {
    super(message);
    this.name = "OpenRouterInsightParseError";
    this.rawContent = rawContent;
  }
}

export class OpenRouterCategoryParseError extends Error {
  rawContent: string;

  constructor(message: string, rawContent: string) {
    super(message);
    this.name = "OpenRouterCategoryParseError";
    this.rawContent = rawContent;
  }
}

export class OpenRouterTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterTimeoutError";
  }
}

function buildPrompt(expenses: Expense[], timezone: string, currency: string): string {
  const compact = expenses.slice(0, 100).map((expense) => ({
    amount: expense.amount,
    category: expense.category,
    merchant: expense.merchant,
    note: expense.note,
    expense_date: expense.expense_date,
  }));

  return [
    "You are a spending analyst.",
    "Return strict JSON only with shape:",
    '{"summary":"string","anomalies":["string"],"tips":["string"]}',
    "Rules:",
    "- summary <= 80 words",
    "- anomalies max 4 items",
    "- tips max 4 items",
    "- no markdown",
    `Timezone: ${timezone}`,
    `Currency: ${currency}`,
    `Expenses JSON: ${JSON.stringify(compact)}`,
  ].join("\n");
}

function extractJson(text: string): { summary: string; anomalies: string[]; tips: string[] } {
  for (const candidate of collectJsonCandidates(text)) {
    try {
      return normalizeParsedInsight(JSON.parse(candidate));
    } catch {
      // Try next candidate.
    }
  }

  throw new OpenRouterInsightParseError("Insight response was not valid JSON", text);
}

function extractCodeFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() || null;
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null) => {
    if (!value) {
      return;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  push(trimmed);
  const fenced = extractCodeFence(trimmed);
  push(fenced);
  push(extractFirstBalancedObject(trimmed));
  if (fenced) {
    push(extractFirstBalancedObject(fenced));
  }

  return candidates;
}

function extractFirstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractCategoryJson(text: string): {
  category: string;
  reason: string;
  confidence: number;
} {
  for (const candidate of collectJsonCandidates(text)) {
    try {
      return normalizeParsedCategory(JSON.parse(candidate));
    } catch {
      // Try next candidate.
    }
  }

  throw new OpenRouterCategoryParseError("Category response was not valid JSON", text);
}

function normalizeParsedCategory(value: unknown): {
  category: string;
  reason: string;
  confidence: number;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Category response JSON was not an object");
  }

  const candidate = value as {
    category?: unknown;
    reason?: unknown;
    confidence?: unknown;
  };

  const category =
    typeof candidate.category === "string" && candidate.category.trim()
      ? candidate.category.trim()
      : "Other";

  const reason =
    typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason.trim()
      : "AI categorized based on note and merchant.";

  const numericConfidence =
    typeof candidate.confidence === "number" ? candidate.confidence : Number(candidate.confidence);
  const confidence = Number.isFinite(numericConfidence) ? numericConfidence : 0.7;

  return {
    category,
    reason,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))),
  };
}

function normalizeParsedInsight(value: unknown): {
  summary: string;
  anomalies: string[];
  tips: string[];
} {
  if (!value || typeof value !== "object") {
    throw new Error("Insight response JSON was not an object");
  }

  const candidate = value as {
    summary?: unknown;
    anomalies?: unknown;
    tips?: unknown;
  };

  const summary =
    typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : "No summary available.";

  const anomalies = Array.isArray(candidate.anomalies)
    ? candidate.anomalies.filter((item): item is string => typeof item === "string").slice(0, 4)
    : [];

  const tips = Array.isArray(candidate.tips)
    ? candidate.tips.filter((item): item is string => typeof item === "string").slice(0, 4)
    : [];

  return { summary, anomalies, tips };
}

export async function generateInsightWithOpenRouter(params: {
  expenses: Expense[];
  timezone: string;
  currency: string;
}): Promise<ParsedInsight> {
  const apiKey = config.getOpenRouterKey();
  const model = config.openRouterInsightModel;

  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": config.appBaseUrl || "https://localhost",
        "X-Title": "Expense Bot Insight Engine",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You analyze personal spending and return concise, useful advice as strict JSON with no markdown.",
          },
          {
            role: "user",
            content: buildPrompt(params.expenses, params.timezone, params.currency),
          },
        ],
        response_format: {
          type: "json_object",
        },
        temperature: 0.1,
        max_tokens: 350,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterTimeoutError(`OpenRouter timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenRouter failed (${response.status}): ${payload}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  const parsed = extractJson(content);
  return {
    ...parsed,
    model: payload.model || model,
  };
}

function buildCategoryPrompt(input: { note: string; merchant: string; amount: number }): string {
  return [
    "Categorize the expense into exactly one category.",
    "Allowed categories: Food, Transport, Groceries, Bills, Health, Entertainment, Shopping, Travel, Other",
    "Return strict JSON only with shape:",
    '{"category":"string","reason":"string","confidence":0.0}',
    `Expense note: ${input.note}`,
    `Merchant: ${input.merchant}`,
    `Amount: ${input.amount}`,
  ].join("\n");
}

export async function categorizeExpenseWithOpenRouter(params: {
  note: string;
  merchant: string;
  amount: number;
}): Promise<{ category: string; reason: string; confidence: number; model: string }> {
  const apiKey = config.getOpenRouterKey();
  const model = config.openRouterInsightModel;

  const timeoutMs = 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": config.appBaseUrl || "https://localhost",
        "X-Title": "Expense Bot Categorizer",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a strict JSON expense categorizer.",
          },
          {
            role: "user",
            content: buildCategoryPrompt(params),
          },
        ],
        response_format: {
          type: "json_object",
        },
        temperature: 0,
        max_tokens: 120,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterTimeoutError(`OpenRouter category timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenRouter category failed (${response.status}): ${payload}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter category returned empty content");
  }

  const parsed = extractCategoryJson(content);

  return {
    category: parsed.category,
    reason: parsed.reason,
    confidence: parsed.confidence,
    model: payload.model || model,
  };
}

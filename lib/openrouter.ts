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
  const trimmed = text.trim();
  try {
    return normalizeParsedInsight(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Insight response was not valid JSON");
    }
    return normalizeParsedInsight(JSON.parse(trimmed.slice(start, end + 1)));
  }
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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": config.appBaseUrl || "https://localhost",
      "X-Title": "Expense Bot Insight Engine",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You analyze personal spending and return concise, useful advice as strict JSON.",
        },
        {
          role: "user",
          content: buildPrompt(params.expenses, params.timezone, params.currency),
        },
      ],
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

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

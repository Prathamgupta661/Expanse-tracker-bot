import { NextResponse } from "next/server";

import { computeExpenseStats, formatCurrency } from "@/lib/analytics";
import { config } from "@/lib/config";
import { parseExpenseMessage } from "@/lib/expense-parser";
import { getInsightForUser } from "@/lib/insights";
import {
  createIngestionEvent,
  getIngestionByUpdateId,
  insertExpenses,
  listExpensesByUser,
  updateIngestionEvent,
  upsertTelegramProfile,
} from "@/lib/supabase";
import { sendTelegramMessage, TelegramUpdate } from "@/lib/telegram";
import { InsightPeriod, NewExpense } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateTelegramSecret(request: Request): boolean {
  const configured = config.telegramWebhookSecret;
  if (!configured) {
    return true;
  }
  const incoming = request.headers.get("x-telegram-bot-api-secret-token");
  return incoming === configured;
}

function parseInsightPeriod(input: string): InsightPeriod {
  if (input.includes("week")) {
    return "weekly";
  }
  if (input.includes("month")) {
    return "monthly";
  }
  return "daily";
}

function startOfTodayIso(now: Date): string {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfMonthIso(now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth(), 1);
  return date.toISOString();
}

async function handleCommand(params: {
  text: string;
  chatId: number;
  userId: string;
  currency: string;
}) {
  const lower = params.text.toLowerCase();

  if (lower.startsWith("/start") || lower.startsWith("/help")) {
    await sendTelegramMessage(
      params.chatId,
      [
        "Expense bot is active.",
        "Send expenses like:",
        "pizza 450",
        "uber 220",
        "",
        "Commands:",
        "/today - today total",
        "/month - month total",
        "/insight - cached daily insight",
        "/insight refresh - regenerate now",
      ].join("\n"),
    );
    return;
  }

  if (lower.startsWith("/today")) {
    const expenses = await listExpensesByUser(params.userId, {
      from: startOfTodayIso(new Date()),
      limit: 500,
    });
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);
    await sendTelegramMessage(
      params.chatId,
      `Today's spend: ${formatCurrency(total, params.currency)} (${expenses.length} items)`,
    );
    return;
  }

  if (lower.startsWith("/month")) {
    const expenses = await listExpensesByUser(params.userId, {
      from: startOfMonthIso(new Date()),
      limit: 1000,
    });
    const stats = computeExpenseStats(expenses);
    const topCats = stats.categoryTotals
      .slice(0, 3)
      .map((item) => `${item.category}: ${formatCurrency(item.total, params.currency)}`)
      .join("\n");
    await sendTelegramMessage(
      params.chatId,
      [
        `This month: ${formatCurrency(stats.totalAmount, params.currency)} (${stats.count} items)`,
        topCats ? `Top categories:\n${topCats}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    return;
  }

  if (lower.startsWith("/insight")) {
    const shouldGenerate = lower.includes("refresh") || lower.includes("generate");
    const period = parseInsightPeriod(lower);
    const insight = await getInsightForUser({
      userId: params.userId,
      period,
      generate: shouldGenerate,
    });

    if (!insight) {
      await sendTelegramMessage(params.chatId, "No insight available yet.");
      return;
    }

    const anomalyText = insight.anomalies.length
      ? `Anomalies:\n- ${insight.anomalies.join("\n- ")}`
      : "Anomalies: none";
    const tipsText = insight.tips.length ? `Tips:\n- ${insight.tips.join("\n- ")}` : "Tips: none";

    await sendTelegramMessage(
      params.chatId,
      [
        `${period.toUpperCase()} insight`,
        `Updated: ${new Date(insight.generated_at).toLocaleString("en-IN")}`,
        "",
        insight.summary,
        "",
        anomalyText,
        "",
        tipsText,
      ].join("\n"),
    );
    return;
  }

  await sendTelegramMessage(params.chatId, "Unknown command. Use /help");
}

async function handleExpenseText(params: {
  text: string;
  chatId: number;
  userId: string;
  expenseDate: string;
  currency: string;
}) {
  const parsed = parseExpenseMessage(params.text);

  if (!parsed.parsed.length) {
    await sendTelegramMessage(
      params.chatId,
      [
        "Could not parse any expense.",
        "Expected: `<name> <amount>`",
        "Example:",
        "pizza 450",
        "uber 220",
      ].join("\n"),
    );
    return { parsed };
  }

  const rows: NewExpense[] = parsed.parsed.map((line) => ({
    user_id: params.userId,
    amount: line.amount,
    currency: params.currency,
    category: line.category,
    merchant: line.merchant,
    note: line.note,
    expense_date: params.expenseDate,
    source: "telegram",
    confidence: 1,
  }));

  const inserted = await insertExpenses(rows);
  const total = inserted.reduce((sum, item) => sum + item.amount, 0);
  const invalidCount = parsed.invalid.length;

  await sendTelegramMessage(
    params.chatId,
    [
      `Saved ${inserted.length} expense(s), total ${formatCurrency(total, params.currency)}.`,
      invalidCount
        ? `Skipped ${invalidCount} line(s):\n${parsed.invalid
            .slice(0, 3)
            .map((item) => `- ${item.line}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  return { parsed, inserted };
}

export async function POST(request: Request) {
  try {
    if (!validateTelegramSecret(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    if (!message || !message.from?.id || !message.chat?.id) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const updateId = String(update.update_id);
    const existing = await getIngestionByUpdateId(updateId);
    if (existing) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }

    const profile = await upsertTelegramProfile({
      telegramId: message.from.id,
      timezone: config.defaultTimezone,
      currency: config.defaultCurrency,
    });

    const text = message.text?.trim() || "";
    const event = await createIngestionEvent({
      userId: profile.user_id,
      rawText: text || "[non-text message]",
      sourceUpdateId: updateId,
    });

    if (!text) {
      await sendTelegramMessage(message.chat.id, "Only text messages are supported right now.");
      await updateIngestionEvent({
        id: event.id,
        status: "failed",
        error: "Non-text message",
      });
      return NextResponse.json({ ok: true });
    }

    const expenseDate = new Date(message.date * 1000).toISOString();
    if (text.startsWith("/")) {
      await handleCommand({
        text,
        chatId: message.chat.id,
        userId: profile.user_id,
        currency: profile.currency,
      });
      await updateIngestionEvent({
        id: event.id,
        status: "processed",
      });
      return NextResponse.json({ ok: true });
    }

    const result = await handleExpenseText({
      text,
      chatId: message.chat.id,
      userId: profile.user_id,
      expenseDate,
      currency: profile.currency,
    });

    await updateIngestionEvent({
      id: event.id,
      status: "processed",
      parsedPayload: result.parsed,
    });

    return NextResponse.json({
      ok: true,
      inserted: result.inserted?.length || 0,
      invalid: result.parsed.invalid.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Webhook processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

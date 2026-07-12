import { NextResponse } from "next/server";

import { computeExpenseStats, formatCurrency } from "@/lib/analytics";
import { config } from "@/lib/config";
import { parseExpenseMessage } from "@/lib/expense-parser";
import { getInsightForUser } from "@/lib/insights";
import { getRequestId, logEvent } from "@/lib/logger";
import {
  createAuthLinkRequest,
  createIngestionEvent,
  getIngestionByUpdateId,
  getProfileByUserId,
  getTelegramLinkByTelegramId,
  insertExpenses,
  listExpensesByUser,
  listProfilesByEmail,
  updateIngestionEvent,
  updateProfileEmailByUserId,
  upsertProfileTelegramLink,
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

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
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

function formatTelegramDisplayName(user: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName && user.username) {
    return `${fullName} (@${user.username})`;
  }
  if (fullName) {
    return fullName;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return `Telegram ${user.id}`;
}

async function handleCommand(params: {
  text: string;
  chatId: number;
  ownerUserId: string;
  senderUserId: string;
  senderTelegram: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  currency: string;
  appBaseUrl: string;
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
        "/email you@example.com - link dashboard login",
      ].join("\n"),
    );
    return;
  }

  if (lower.startsWith("/today")) {
    const expenses = await listExpensesByUser(params.ownerUserId, {
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
    const expenses = await listExpensesByUser(params.ownerUserId, {
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
      userId: params.ownerUserId,
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
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  if (lower.startsWith("/email")) {
    const email = params.text.replace(/^\/email/i, "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      await sendTelegramMessage(
        params.chatId,
        "Please use: /email you@example.com",
      );
      return;
    }

    try {
      const profiles = await listProfilesByEmail(email);
      const linkedOwner = profiles.find((profile) => Boolean(profile.google_sub));

      if (linkedOwner) {
        await upsertProfileTelegramLink({
          ownerUserId: linkedOwner.user_id,
          telegramId: params.senderTelegram.id,
          telegramUsername: params.senderTelegram.username,
          telegramFirstName: params.senderTelegram.first_name,
          telegramLastName: params.senderTelegram.last_name,
        });

        await sendTelegramMessage(
          params.chatId,
          [
            `Linked this Telegram account to ${email}.`,
            "Future expenses from this account will appear in that dashboard.",
          ].join("\n"),
        );
        return;
      }

      await updateProfileEmailByUserId({
        userId: params.senderUserId,
        email,
      });

      const linkRequest = await createAuthLinkRequest({
        userId: params.senderUserId,
        email,
        ttlMinutes: 15,
      });

      const linkUrl = `${params.appBaseUrl}/link?code=${encodeURIComponent(linkRequest.code)}`;
      await sendTelegramMessage(
        params.chatId,
        [
          `Email saved: ${email}`,
          "Open this link within 15 minutes to connect your dashboard login:",
          linkUrl,
        ].join("\n"),
      );
    } catch {
      await sendTelegramMessage(
        params.chatId,
        "Could not save this email. It may already be linked to another account.",
      );
    }
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
  addedByTelegramId: number;
  addedByTelegramName: string;
}): Promise<{
  parsed: ReturnType<typeof parseExpenseMessage>;
  inserted?: Awaited<ReturnType<typeof insertExpenses>>;
  messageError?: string;
}> {
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
    category_source: "rule",
    confidence: 1,
    added_by_telegram_id: params.addedByTelegramId,
    added_by_telegram_name: params.addedByTelegramName,
  }));

  const inserted = await insertExpenses(rows);
  const total = inserted.reduce((sum, item) => sum + item.amount, 0);
  const invalidCount = parsed.invalid.length;
  const categorizationStatus = "Categorized instantly using rules.";

  let messageError: string | undefined;
  try {
    await sendTelegramMessage(
      params.chatId,
      [
        `Saved ${inserted.length} expense(s), total ${formatCurrency(total, params.currency)}.`,
        `Added by: ${params.addedByTelegramName}.`,
        categorizationStatus,
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
  } catch (error) {
    messageError = error instanceof Error ? error.message : "Unknown Telegram send error";
  }

  return { parsed, inserted, messageError };
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  let eventId: string | null = null;
  let updateId: string | null = null;
  try {
    if (!validateTelegramSecret(request)) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    if (!message || !message.from?.id || !message.chat?.id) {
      return NextResponse.json({ ok: true, ignored: true, requestId });
    }

    updateId = String(update.update_id);
    logEvent({
      requestId,
      route: "/api/telegram/webhook",
      phase: "received",
      severity: "info",
      message: "Telegram webhook update received",
      details: { updateId },
    });

    const existing = await getIngestionByUpdateId(updateId);
    if (existing?.status === "processed") {
      logEvent({
        requestId,
        route: "/api/telegram/webhook",
        phase: "deduplicated",
        severity: "info",
        message: "Update already processed",
        details: { updateId },
      });
      return NextResponse.json({ ok: true, deduplicated: true, requestId });
    }

    if (existing?.status === "received") {
      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < 30_000) {
        logEvent({
          requestId,
          route: "/api/telegram/webhook",
          phase: "duplicate_inflight",
          severity: "info",
          message: "Update still in-flight; skipping duplicate delivery",
          details: { updateId, ageMs },
        });
        return NextResponse.json({ ok: true, deduplicated: true, requestId });
      }
    }

    const profile = await upsertTelegramProfile({
      telegramId: message.from.id,
      timezone: config.defaultTimezone,
      currency: config.defaultCurrency,
    });
    const senderName = formatTelegramDisplayName(message.from);

    let ownerUserId = profile.user_id;
    let ownerCurrency = profile.currency;
    try {
      const memberLink = await getTelegramLinkByTelegramId(message.from.id);
      if (memberLink && memberLink.owner_user_id !== profile.user_id) {
        const ownerProfile = await getProfileByUserId(memberLink.owner_user_id);
        if (ownerProfile) {
          ownerUserId = ownerProfile.user_id;
          ownerCurrency = ownerProfile.currency;
        }
      }
    } catch (error) {
      logEvent({
        requestId,
        route: "/api/telegram/webhook",
        phase: "member_lookup_failed",
        severity: "warn",
        message: "Failed to resolve Telegram member link, using sender profile",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }

    try {
      await upsertProfileTelegramLink({
        ownerUserId,
        telegramId: message.from.id,
        telegramUsername: message.from.username,
        telegramFirstName: message.from.first_name,
        telegramLastName: message.from.last_name,
      });
    } catch (error) {
      logEvent({
        requestId,
        route: "/api/telegram/webhook",
        phase: "member_upsert_failed",
        severity: "warn",
        message: "Failed to upsert Telegram member link",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }

    const text = message.text?.trim() || "";
    const event =
      existing ||
      (await createIngestionEvent({
        userId: ownerUserId,
        rawText: text || "[non-text message]",
        sourceUpdateId: updateId,
      }));
    eventId = event.id;

    if (!text) {
      await sendTelegramMessage(message.chat.id, "Only text messages are supported right now.");
      await updateIngestionEvent({
        id: event.id,
        status: "failed",
        error: "Non-text message",
      });
      return NextResponse.json({ ok: true, requestId });
    }

    const expenseDate = new Date(message.date * 1000).toISOString();
    const appBaseUrl = config.appBaseUrl || new URL(request.url).origin;
    if (text.startsWith("/")) {
      await handleCommand({
        text,
        chatId: message.chat.id,
        ownerUserId,
        senderUserId: profile.user_id,
        senderTelegram: message.from,
        currency: ownerCurrency,
        appBaseUrl,
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
      userId: ownerUserId,
      expenseDate,
      currency: ownerCurrency,
      addedByTelegramId: message.from.id,
      addedByTelegramName: senderName,
    });

    if (result.messageError) {
      logEvent({
        requestId,
        route: "/api/telegram/webhook",
        phase: "telegram_send_failed",
        severity: "warn",
        message: "Expense inserted but Telegram confirmation failed",
        details: { updateId, error: result.messageError },
      });
    }

    await updateIngestionEvent({
      id: event.id,
      status: "processed",
      parsedPayload: result.parsed,
    });

    return NextResponse.json({
      ok: true,
      inserted: result.inserted?.length || 0,
      invalid: result.parsed.invalid.length,
      requestId,
    });
  } catch (error) {
    if (eventId) {
      try {
        await updateIngestionEvent({
          id: eventId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } catch {
        // Intentionally swallow secondary failure in error path.
      }
    }
    logEvent({
      requestId,
      route: "/api/telegram/webhook",
      phase: "failed",
      severity: "error",
      message: "Webhook processing failed",
      details: {
        updateId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return NextResponse.json(
      {
        error: "Webhook processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { computeExpenseStats } from "@/lib/analytics";
import { config } from "@/lib/config";
import { parseExpenseMessage } from "@/lib/expense-parser";
import { getRequestId, logEvent } from "@/lib/logger";
import { resolveProfileFromRequest } from "@/lib/request-user";
import { countExpensesByUser, insertExpenses, listExpensesByUser } from "@/lib/supabase";
import { ExpenseSource, NewExpense } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const maxLimit = 200;
  const statsLimit = 5000;
  try {
    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const includeStats = searchParams.get("includeStats") !== "false";
    const limitValue = searchParams.get("limit");
    const offsetValue = searchParams.get("offset");
    const limit = limitValue ? Number.parseInt(limitValue, 10) : 200;
    const offset = offsetValue ? Number.parseInt(offsetValue, 10) : 0;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, maxLimit) : 200;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    const expenses = await listExpensesByUser(profile.user_id, {
      from,
      to,
      limit: safeLimit,
      offset: safeOffset,
    });

    const statsSource = includeStats
      ? await listExpensesByUser(profile.user_id, {
          from,
          to,
          limit: statsLimit,
          offset: 0,
        })
      : null;
    const totalCount = await countExpensesByUser(profile.user_id, {
      from,
      to,
    });
    const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
    const page = Math.min(totalPages, Math.floor(safeOffset / safeLimit) + 1);
    const hasMore = safeOffset + expenses.length < totalCount;

    return NextResponse.json({
      expenses,
      stats: statsSource ? computeExpenseStats(statsSource) : null,
      totalCount,
      totalPages,
      page,
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      requestId,
    });
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/expenses",
      phase: "fetch_failed",
      severity: "error",
      message: "Failed to fetch expenses",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to fetch expenses",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    const body = (await request.json()) as {
      source?: ExpenseSource;
      text?: string;
      amount?: number;
      note?: string;
      category?: string;
      merchant?: string;
      expenseDate?: string;
      currency?: string;
    };

    const source = body.source || "dashboard";
    const currency = body.currency || profile.currency || config.defaultCurrency;
    const defaultExpenseDate = body.expenseDate || new Date().toISOString();

    let rows: NewExpense[] = [];
    let invalid: Array<{ line: string; reason: string }> = [];

    if (body.text?.trim()) {
      const parsed = parseExpenseMessage(body.text);
      rows = parsed.parsed.map((line) => ({
        user_id: profile.user_id,
        amount: line.amount,
        currency,
        category: line.category,
        merchant: line.merchant,
        note: line.note,
        expense_date: defaultExpenseDate,
        source,
        category_source: "rule",
        confidence: 1,
      }));
      invalid = parsed.invalid;
    } else if (typeof body.amount === "number" && body.amount > 0) {
      rows = [
        {
          user_id: profile.user_id,
          amount: Number(body.amount.toFixed(2)),
          currency,
          category: body.category || "Other",
          merchant: body.merchant || "Manual",
          note: body.note || body.merchant || "Manual expense",
          expense_date: defaultExpenseDate,
          source,
          category_source: body.category ? "manual" : "rule",
          confidence: 1,
        },
      ];
    } else {
      return badRequest("Provide either `text` or a positive `amount`");
    }

    if (!rows.length) {
      return badRequest("No valid expense lines were found");
    }

    const inserted = await insertExpenses(rows);
    return NextResponse.json(
      {
        inserted,
        invalid,
        requestId,
      },
      { status: 201 },
    );
  } catch (error) {
    logEvent({
      requestId,
      route: "/api/expenses",
      phase: "insert_failed",
      severity: "error",
      message: "Failed to insert expenses",
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to insert expenses",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId,
      },
      { status: 500 },
    );
  }
}

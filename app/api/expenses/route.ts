import { NextResponse } from "next/server";

import { computeExpenseStats } from "@/lib/analytics";
import { config } from "@/lib/config";
import { parseExpenseMessage } from "@/lib/expense-parser";
import { insertExpenses, listExpensesByUser } from "@/lib/supabase";
import { NewExpense } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return badRequest("Missing required query param: userId");
    }

    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const limitValue = searchParams.get("limit");
    const limit = limitValue ? Number.parseInt(limitValue, 10) : 200;

    const expenses = await listExpensesByUser(userId, {
      from,
      to,
      limit: Number.isFinite(limit) ? limit : 200,
    });

    return NextResponse.json({
      expenses,
      stats: computeExpenseStats(expenses),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch expenses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      source?: "telegram" | "dashboard";
      text?: string;
      amount?: number;
      note?: string;
      category?: string;
      merchant?: string;
      expenseDate?: string;
      currency?: string;
    };

    if (!body.userId) {
      return badRequest("Missing required field: userId");
    }

    const source = body.source || "dashboard";
    const currency = body.currency || config.defaultCurrency;
    const defaultExpenseDate = body.expenseDate || new Date().toISOString();

    let rows: NewExpense[] = [];
    let invalid: Array<{ line: string; reason: string }> = [];

    if (body.text?.trim()) {
      const parsed = parseExpenseMessage(body.text);
      rows = parsed.parsed.map((line) => ({
        user_id: body.userId as string,
        amount: line.amount,
        currency,
        category: line.category,
        merchant: line.merchant,
        note: line.note,
        expense_date: defaultExpenseDate,
        source,
        confidence: 1,
      }));
      invalid = parsed.invalid;
    } else if (typeof body.amount === "number" && body.amount > 0) {
      rows = [
        {
          user_id: body.userId,
          amount: Number(body.amount.toFixed(2)),
          currency,
          category: body.category || "Other",
          merchant: body.merchant || "Manual",
          note: body.note || body.merchant || "Manual expense",
          expense_date: defaultExpenseDate,
          source,
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
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to insert expenses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

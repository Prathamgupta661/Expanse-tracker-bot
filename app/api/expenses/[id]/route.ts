import { NextResponse } from "next/server";

import { deleteExpenseById, patchExpenseById } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const expenseId = params.id;

    const payload = (await request.json()) as {
      userId?: string;
      category?: string;
      merchant?: string;
      note?: string;
      expenseDate?: string;
    };

    if (!payload.userId) {
      return badRequest("Missing required field: userId");
    }

    const fields = {
      ...(payload.category ? { category: payload.category } : {}),
      ...(payload.merchant ? { merchant: payload.merchant } : {}),
      ...(payload.note ? { note: payload.note } : {}),
      ...(payload.expenseDate ? { expense_date: payload.expenseDate } : {}),
    };

    if (!Object.keys(fields).length) {
      return badRequest("No editable fields provided");
    }

    const updated = await patchExpenseById({
      expenseId,
      userId: payload.userId,
      fields,
    });

    if (!updated) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    return NextResponse.json({ expense: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to update expense",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const expenseId = params.id;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return badRequest("Missing required query param: userId");
    }

    await deleteExpenseById(expenseId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to delete expense",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

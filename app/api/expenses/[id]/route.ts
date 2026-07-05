import { NextResponse } from "next/server";

import { resolveProfileFromRequest } from "@/lib/request-user";
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
    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as {
      category?: string;
      merchant?: string;
      note?: string;
      expenseDate?: string;
    };

    const fields = {
      ...(payload.category ? { category: payload.category } : {}),
      ...(payload.category ? { category_source: "manual" as const } : {}),
      ...(payload.merchant ? { merchant: payload.merchant } : {}),
      ...(payload.note ? { note: payload.note } : {}),
      ...(payload.expenseDate ? { expense_date: payload.expenseDate } : {}),
    };

    if (!Object.keys(fields).length) {
      return badRequest("No editable fields provided");
    }

    const updated = await patchExpenseById({
      expenseId,
      userId: profile.user_id,
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
    const profile = await resolveProfileFromRequest(request);
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await deleteExpenseById(expenseId, profile.user_id);
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

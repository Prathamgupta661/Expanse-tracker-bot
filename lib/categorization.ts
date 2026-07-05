import { OpenRouterCategoryParseError, categorizeExpenseWithOpenRouter } from "@/lib/openrouter";
import {
  getExpenseById,
  listCategorizationJobs,
  patchExpenseByIdAny,
  updateCategorizationJob,
} from "@/lib/supabase";

export async function processCategorizationQueue(limit = 30): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const jobs = await listCategorizationJobs(limit);
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const now = Date.now();
    if (new Date(job.next_attempt_at).getTime() > now) {
      continue;
    }

    const attempts = (job.attempts || 0) + 1;
    await updateCategorizationJob({
      jobId: job.id,
      status: "processing",
      attempts,
    });

    try {
      const expense = await getExpenseById(job.expense_id);
      if (!expense) {
        throw new Error("Expense not found for job");
      }

      if (expense.category_source === "manual") {
        await updateCategorizationJob({
          jobId: job.id,
          status: "done",
          attempts,
          lastError: null,
        });
        succeeded += 1;
        continue;
      }

      const categorized = await categorizeExpenseWithOpenRouter({
        note: expense.note,
        merchant: expense.merchant,
        amount: expense.amount,
      });

      await patchExpenseByIdAny({
        expenseId: expense.id,
        fields: {
          category: categorized.category,
          category_source: "ai",
          category_reason: categorized.reason,
          confidence: categorized.confidence,
        },
      });

      await updateCategorizationJob({
        jobId: job.id,
        status: "done",
        attempts,
        lastError: null,
      });
      succeeded += 1;
    } catch (error) {
      const finalFailure = attempts >= 4;
      const retryMinutes = Math.min(60, 2 ** attempts);
      const nextAttempt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
      const baseError = error instanceof Error ? error.message : "Unknown categorization error";
      const parsePreview =
        error instanceof OpenRouterCategoryParseError
          ? ` | raw=${error.rawContent.replace(/\s+/g, " ").slice(0, 220)}`
          : "";

      await updateCategorizationJob({
        jobId: job.id,
        status: finalFailure ? "failed" : "pending",
        attempts,
        nextAttemptAt: nextAttempt,
        lastError: `${baseError}${parsePreview}`,
      });
      failed += 1;
    }
  }

  return {
    attempted: jobs.length,
    succeeded,
    failed,
  };
}

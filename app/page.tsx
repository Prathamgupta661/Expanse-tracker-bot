"use client";

import { useMemo, useState } from "react";

type InsightPeriod = "daily" | "weekly" | "monthly";

interface ExpenseRow {
  id: string;
  amount: number;
  currency: string;
  category: string;
  merchant: string;
  note: string;
  expense_date: string;
}

interface DashboardStats {
  totalAmount: number;
  count: number;
  categoryTotals: Array<{ category: string; total: number }>;
  dailyTotals: Array<{ date: string; total: number }>;
}

interface InsightData {
  summary: string;
  anomalies: string[];
  tips: string[];
  generated_at: string;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function Home() {
  const [userId, setUserId] = useState("");
  const [period, setPeriod] = useState<InsightPeriod>("daily");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);

  const categoryMax = useMemo(() => {
    if (!stats || !stats.categoryTotals.length) {
      return 1;
    }
    return Math.max(...stats.categoryTotals.map((item) => item.total), 1);
  }, [stats]);

  const loadDashboard = async (generateInsight = false) => {
    if (!userId.trim()) {
      setError("Enter a user id first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [expensesRes, insightRes] = await Promise.all([
        fetch(`/api/expenses?userId=${encodeURIComponent(userId.trim())}&limit=200`, {
          cache: "no-store",
        }),
        fetch(
          `/api/insights?userId=${encodeURIComponent(userId.trim())}&period=${period}&generate=${String(generateInsight)}`,
          { cache: "no-store" },
        ),
      ]);

      const expensePayload = (await expensesRes.json()) as {
        expenses?: ExpenseRow[];
        stats?: DashboardStats;
        error?: string;
      };
      const insightPayload = (await insightRes.json()) as {
        insight?: InsightData | null;
        error?: string;
      };

      if (!expensesRes.ok) {
        throw new Error(expensePayload.error || "Failed to load expenses");
      }

      if (!insightRes.ok) {
        throw new Error(insightPayload.error || "Failed to load insights");
      }

      setExpenses(expensePayload.expenses || []);
      setStats(expensePayload.stats || null);
      setInsight(insightPayload.insight || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const regenerateInsight = async () => {
    if (!userId.trim()) {
      setError("Enter a user id first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: userId.trim(),
          period,
        }),
      });

      const payload = (await res.json()) as { insight?: InsightData; error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to regenerate insight");
      }
      setInsight(payload.insight || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
          <p className="text-sm uppercase tracking-widest text-sky-300">Expense Bot Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Expense Breakdown + AI Insight</h1>
          <p className="mt-2 text-sm text-slate-300">
            Insight calls are cached daily. Regular expense inserts do not hit the LLM.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-[2fr_1fr_auto_auto]">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-sky-400 focus:ring-2"
              placeholder="User ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={period}
              onChange={(event) => setPeriod(event.target.value as InsightPeriod)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
              onClick={() => void loadDashboard(false)}
              disabled={loading}
            >
              Load
            </button>
            <button
              className="rounded-lg border border-sky-400 px-4 py-2 text-sm font-medium text-sky-300 hover:bg-sky-400/10 disabled:opacity-60"
              onClick={() => void regenerateInsight()}
              disabled={loading}
            >
              Regenerate Insight
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Total Spend</p>
            <p className="mt-2 text-2xl font-semibold">
              {stats ? formatAmount(stats.totalAmount) : "₹0.00"}
            </p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Transactions</p>
            <p className="mt-2 text-2xl font-semibold">{stats?.count || 0}</p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Last Insight</p>
            <p className="mt-2 text-sm font-medium text-slate-200">
              {insight?.generated_at
                ? new Date(insight.generated_at).toLocaleString("en-IN")
                : "Not generated"}
            </p>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="text-lg font-semibold">Category Breakdown</h2>
            <div className="mt-4 space-y-3">
              {stats?.categoryTotals.length ? (
                stats.categoryTotals.slice(0, 8).map((item) => (
                  <div key={item.category}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>{item.category}</span>
                      <span>{formatAmount(item.total)}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-800">
                      <div
                        className="h-2 rounded bg-sky-400"
                        style={{
                          width: `${Math.max((item.total / categoryMax) * 100, 4)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No category data yet.</p>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="text-lg font-semibold">AI Insights</h2>
            {insight ? (
              <div className="mt-3 space-y-4 text-sm text-slate-200">
                <p>{insight.summary}</p>
                <div>
                  <p className="font-medium text-sky-300">Anomalies</p>
                  {insight.anomalies.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                      {insight.anomalies.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400">No anomalies reported.</p>
                  )}
                </div>
                <div>
                  <p className="font-medium text-sky-300">Tips</p>
                  {insight.tips.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                      {insight.tips.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400">No tips available yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Load data to view cached insight.</p>
            )}
          </article>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-lg font-semibold">Recent Transactions</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Merchant</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Note</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length ? (
                  expenses.slice(0, 25).map((expense) => (
                    <tr key={expense.id} className="border-t border-slate-800">
                      <td className="px-2 py-2 text-slate-300">
                        {new Date(expense.expense_date).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-2 py-2">{expense.merchant}</td>
                      <td className="px-2 py-2">{expense.category}</td>
                      <td className="px-2 py-2 text-slate-400">{expense.note}</td>
                      <td className="px-2 py-2 text-right font-medium">
                        {formatAmount(expense.amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-slate-400">
                      No transactions loaded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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

interface AuthState {
  authenticated: boolean;
  linked: boolean;
  email: string | null;
  profile: { user_id: string; telegram_id: number | null } | null;
}

const CHART_COLORS = ["#38bdf8", "#22d3ee", "#34d399", "#f59e0b", "#f43f5e", "#8b5cf6", "#94a3b8"];

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatChartAmount(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "N/A";
  }
  return formatAmount(numeric);
}

export default function Home() {
  const router = useRouter();

  const [period, setPeriod] = useState<InsightPeriod>("daily");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightNotice, setInsightNotice] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);

  const pieData = useMemo(() => {
    if (!stats?.categoryTotals?.length) {
      return [];
    }

    const primary = stats.categoryTotals.slice(0, 6);
    const otherTotal = stats.categoryTotals
      .slice(6)
      .reduce((sum, item) => sum + item.total, 0);

    const items = primary.map((item) => ({
      name: item.category,
      value: item.total,
    }));

    if (otherTotal > 0) {
      items.push({ name: "Other", value: Number(otherTotal.toFixed(2)) });
    }

    return items;
  }, [stats]);

  const trendData = useMemo(() => {
    if (!stats?.dailyTotals?.length) {
      return [];
    }

    return stats.dailyTotals.map((item) => ({
      ...item,
      label: new Date(item.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
  }, [stats]);

  const fetchDashboardData = async (authToken: string, selectedPeriod: InsightPeriod) => {
    const [expensesRes, insightRes] = await Promise.all([
      fetch(`/api/expenses?limit=200`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }),
      fetch(`/api/insights?period=${selectedPeriod}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }),
    ]);

    const expensePayload = (await expensesRes.json()) as {
      expenses?: ExpenseRow[];
      stats?: DashboardStats;
      error?: string;
      details?: string;
    };
    const insightPayload = (await insightRes.json()) as {
      insight?: InsightData | null;
      error?: string;
      details?: string;
      cacheMiss?: boolean;
      requestId?: string;
    };

    if (!expensesRes.ok) {
      throw new Error(expensePayload.error || expensePayload.details || "Failed to load expenses");
    }

    setExpenses(expensePayload.expenses || []);
    setStats(expensePayload.stats || null);

    if (!insightRes.ok) {
      setInsight(null);
      setInsightNotice(
        `Insight unavailable right now${insightPayload.requestId ? ` (request: ${insightPayload.requestId})` : ""}.`,
      );
      return;
    }

    setInsight(insightPayload.insight || null);
    setInsightNotice(
      insightPayload.cacheMiss
        ? "No cached insight yet. Click Regenerate Insight."
        : null,
    );
  };

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session?.access_token) {
          router.replace("/login?next=%2F");
          return;
        }

        if (!active) {
          return;
        }

        setToken(session.access_token);

        const meRes = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const mePayload = (await meRes.json()) as AuthState & { error?: string; details?: string };
        if (!meRes.ok) {
          throw new Error(mePayload.error || mePayload.details || "Failed to load user session");
        }

        if (!active) {
          return;
        }

        setAuthState(mePayload);
        if (mePayload.linked) {
          await fetchDashboardData(session.access_token, "daily");
        }
      } catch (caught) {
        if (!active) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "Unknown error");
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router]);

  const loadDashboard = async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await fetchDashboardData(token, period);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const regenerateInsight = async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          period,
        }),
      });

      const payload = (await res.json()) as { insight?: InsightData; error?: string; details?: string };
      if (!res.ok) {
        throw new Error(payload.error || payload.details || "Failed to regenerate insight");
      }
      setInsight(payload.insight || null);
      setInsightNotice(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login?next=%2F");
  };

  if (!authState) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
          <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h1 className="text-xl font-semibold">Loading dashboard...</h1>
            {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          </section>
        </main>
      </div>
    );
  }

  if (!authState.linked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
          <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h1 className="text-xl font-semibold">Account not linked yet</h1>
            <p className="mt-3 text-sm text-slate-300">
              Send `/email {authState.email || "you@example.com"}` to your Telegram bot, then open
              the link you receive there.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/"
                className="inline-flex rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Refresh
              </Link>
              <button
                onClick={() => void signOut()}
                className="inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
              >
                Sign Out
              </button>
            </div>
            {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
          <p className="text-sm uppercase tracking-widest text-sky-300">Expense Bot Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Expense Breakdown + AI Insight</h1>
          <p className="mt-2 text-sm text-slate-300">Logged in as {authState.email || "unknown"}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
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
              onClick={() => void loadDashboard()}
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
            <button
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              onClick={() => void signOut()}
            >
              Sign Out
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Total Spend</p>
            <p className="mt-2 text-2xl font-semibold">
              {stats ? formatAmount(stats.totalAmount) : "INR 0.00"}
            </p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Transactions</p>
            <p className="mt-2 text-2xl font-semibold">{stats?.count || 0}</p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Last Insight</p>
            <p className="mt-2 text-sm font-medium text-slate-200">
              {insight?.generated_at ? new Date(insight.generated_at).toLocaleString("en-IN") : "Not generated"}
            </p>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="text-lg font-semibold">Category Breakdown</h2>
            <div className="mt-4 h-72">
              {pieData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={96}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: unknown) => formatChartAmount(value)}
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "0.75rem",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
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
              <p className="mt-3 text-sm text-slate-400">
                {insightNotice || "Load data to view cached insight."}
              </p>
            )}
          </article>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-lg font-semibold">Daily Spend Trend</h2>
          <div className="mt-4 h-72">
            {trendData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} width={72} />
                  <Tooltip
                    formatter={(value: unknown) => formatChartAmount(value)}
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: "0.75rem",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#38bdf8"
                    strokeWidth={3}
                    dot={{ r: 3, fill: "#38bdf8" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400">No daily trend data yet.</p>
            )}
          </div>
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
                      <td className="px-2 py-2 text-right font-medium">{formatAmount(expense.amount)}</td>
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

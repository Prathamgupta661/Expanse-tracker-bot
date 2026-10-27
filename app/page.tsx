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

import { getAddedByLabel } from "@/lib/expense-labels";

type InsightPeriod = "daily" | "weekly" | "monthly";

interface ExpenseRow {
  id: string;
  amount: number;
  currency: string;
  source: "telegram" | "dashboard";
  category: string;
  merchant: string;
  note: string;
  expense_date: string;
  mobile_meta?: {
    channel?: "notification" | "sms";
    location?: { latitude: number; longitude: number } | null;
  } | null;
  added_by_telegram_id: number | null;
  added_by_telegram_name: string | null;
}

interface DashboardStats {
  totalAmount: number;
  count: number;
  categoryTotals: Array<{ category: string; total: number }>;
  dailyTotals: Array<{ date: string; total: number; byPerson?: Record<string, number> }>;
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
const PAGE_SIZE_OPTIONS = [10, 50, 100] as const;

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


function getSourceLabel(expense: ExpenseRow): string {
  if (expense.mobile_meta?.channel === "notification") {
    return "Mobile (Notification)";
  }
  if (expense.mobile_meta?.channel === "sms") {
    return "Mobile (SMS)";
  }
  if (expense.source === "telegram") {
    return "Telegram";
  }
  return "Dashboard";
}

function getPeriodRange(period: InsightPeriod, now = new Date()): { from: string; to: string } {
  const end = now.toISOString();
  if (period === "daily") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: end };
  }

  if (period === "weekly") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: end };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.toISOString(), to: end };
}

export default function Home() {
  const router = useRouter();

  const [period, setPeriod] = useState<InsightPeriod>("daily");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insightNotice, setInsightNotice] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [trendPerson, setTrendPerson] = useState("all");
  const [trendDay, setTrendDay] = useState("all");

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

  const trendPeople = useMemo(() => {
    const people = new Set<string>();
    for (const item of stats?.dailyTotals || []) {
      Object.keys(item.byPerson || {}).forEach((person) => people.add(person));
    }
    return [...people].sort();
  }, [stats]);

  const trendData = useMemo(() => {
    if (!stats?.dailyTotals?.length) {
      return [];
    }

    return stats.dailyTotals.map((item) => ({
      ...item,
      // One key per person (0 on days they spent nothing), read by the per-person chart lines.
      ...Object.fromEntries(
        trendPeople.map((person) => [`person:${person}`, item.byPerson?.[person] ?? 0]),
      ),
      label: new Date(item.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
    }));
  }, [stats, trendPeople]);

  // Fall back to "all" when a reload drops the selected person or day from the data.
  const activeTrendPerson = trendPeople.includes(trendPerson) ? trendPerson : "all";
  const activeTrendDay = trendData.some((item) => item.date === trendDay) ? trendDay : "all";

  const visibleTrendData = useMemo(
    () => (activeTrendDay === "all" ? trendData : trendData.filter((item) => item.date === activeTrendDay)),
    [trendData, activeTrendDay],
  );

  const trendDayBreakdown = useMemo(() => {
    const day = trendData.find((item) => item.date === activeTrendDay);
    if (!day) {
      return [];
    }
    return Object.entries(day.byPerson || {})
      .filter(([person]) => activeTrendPerson === "all" || person === activeTrendPerson)
      .sort((a, b) => b[1] - a[1]);
  }, [trendData, activeTrendDay, activeTrendPerson]);

  const fetchDashboardData = async (
    selectedPeriod: InsightPeriod,
    page: number,
    size: (typeof PAGE_SIZE_OPTIONS)[number],
  ) => {
    const { from, to } = getPeriodRange(selectedPeriod);
    const tableParams = new URLSearchParams({
      limit: String(size),
      offset: String((page - 1) * size),
      includeStats: "false",
    });
    const statsParams = new URLSearchParams({
      limit: "1",
      offset: "0",
      from,
      to,
    });

    const [tableRes, statsRes, insightRes] = await Promise.all([
      fetch(`/api/expenses?${tableParams.toString()}`, {
        cache: "no-store",
      }),
      fetch(`/api/expenses?${statsParams.toString()}`, {
        cache: "no-store",
      }),
      fetch(`/api/insights?period=${selectedPeriod}`, {
        cache: "no-store",
      }),
    ]);

    const tablePayload = (await tableRes.json()) as {
      expenses?: ExpenseRow[];
      error?: string;
      details?: string;
      totalCount?: number;
      totalPages?: number;
      page?: number;
    };
    const statsPayload = (await statsRes.json()) as {
      stats?: DashboardStats | null;
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

    if (!tableRes.ok) {
      throw new Error(tablePayload.error || tablePayload.details || "Failed to load expenses");
    }

    if (!statsRes.ok) {
      throw new Error(statsPayload.error || statsPayload.details || "Failed to load stats");
    }

    setExpenses(tablePayload.expenses || []);
    setStats(statsPayload.stats || null);
    setTotalCount(
      Number.isFinite(tablePayload.totalCount) ? Number(tablePayload.totalCount) : 0,
    );
    const resolvedTotalPages =
      Number.isFinite(tablePayload.totalPages) && Number(tablePayload.totalPages) > 0
        ? Number(tablePayload.totalPages)
        : 1;
    setTotalPages(resolvedTotalPages);
    const resolvedPage =
      Number.isFinite(tablePayload.page) && Number(tablePayload.page) > 0
        ? Math.min(Number(tablePayload.page), resolvedTotalPages)
        : page;
    setCurrentPage(resolvedPage);

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
        const meRes = await fetch("/api/auth/me", {
          cache: "no-store",
        });
        if (meRes.status === 401) {
          router.replace("/login?next=%2F");
          return;
        }

        const mePayload = (await meRes.json()) as AuthState & { error?: string; details?: string };
        if (!meRes.ok) {
          throw new Error(mePayload.error || mePayload.details || "Failed to load user session");
        }

        if (!active) {
          return;
        }

        setAuthState(mePayload);
        if (mePayload.linked) {
          await fetchDashboardData("daily", 1, pageSize);
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
  }, [router, pageSize]);

  const loadDashboard = async () => {
    if (!authState?.linked) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await fetchDashboardData(period, currentPage, pageSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const changePage = async (nextPage: number) => {
    if (!authState?.linked || loading || nextPage < 1 || nextPage > totalPages) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await fetchDashboardData(period, nextPage, pageSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const changePageSize = async (nextSize: (typeof PAGE_SIZE_OPTIONS)[number]) => {
    if (!authState?.linked || loading) {
      setPageSize(nextSize);
      setCurrentPage(1);
      setTotalPages(1);
      return;
    }

    setPageSize(nextSize);
    setCurrentPage(1);
    setTotalPages(1);
    setLoading(true);
    setError(null);

    try {
      await fetchDashboardData(period, 1, nextSize);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const regenerateInsight = async () => {
    if (!authState?.linked) {
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
    await fetch("/api/auth/logout", {
      method: "POST",
    });
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

          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as InsightPeriod);
                setCurrentPage(1);
                setTotalPages(1);
                setTotalCount(0);
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={pageSize}
              onChange={(event) =>
                void changePageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
              }
              disabled={loading}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Daily Spend Trend</h2>
            {trendPeople.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Filter by person"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
                  value={activeTrendPerson}
                  onChange={(event) => setTrendPerson(event.target.value)}
                >
                  <option value="all">All people</option>
                  {trendPeople.map((person) => (
                    <option key={person} value={person}>
                      {person}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by day"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
                  value={activeTrendDay}
                  onChange={(event) => setTrendDay(event.target.value)}
                >
                  <option value="all">All days</option>
                  {trendData.map((item) => (
                    <option key={item.date} value={item.date}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {trendDayBreakdown.length ? (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {trendDayBreakdown.map(([person, amount]) => (
                <span
                  key={person}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200"
                >
                  {person}: <span className="font-medium">{formatAmount(amount)}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-4 h-72">
            {visibleTrendData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
                  {activeTrendPerson === "all" ? (
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total"
                      stroke="#38bdf8"
                      strokeWidth={3}
                      dot={{ r: 3, fill: "#38bdf8" }}
                      activeDot={{ r: 5 }}
                    />
                  ) : null}
                  {trendPeople.length > 1
                    ? trendPeople.map((person, index) =>
                        activeTrendPerson !== "all" && person !== activeTrendPerson ? null : (
                        <Line
                          key={person}
                          type="monotone"
                          dataKey={`person:${person}`}
                          name={person}
                          stroke={CHART_COLORS[(index + 1) % CHART_COLORS.length]}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={{ r: 2 }}
                        />
                        ),
                      )
                    : null}
                  {trendPeople.length > 1 ? <Legend /> : null}
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
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Added By</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length ? (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="border-t border-slate-800">
                      <td className="px-2 py-2 text-slate-300">
                        {new Date(expense.expense_date).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-2 py-2">{expense.merchant}</td>
                      <td className="px-2 py-2">{expense.category}</td>
                      <td className="px-2 py-2 text-slate-400">{expense.note}</td>
                      <td className="px-2 py-2 text-slate-300">
                        {getSourceLabel(expense)}
                        {expense.mobile_meta?.location ? (
                          <a
                            href={`https://www.google.com/maps?q=${expense.mobile_meta.location.latitude},${expense.mobile_meta.location.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-sky-400 hover:underline"
                          >
                            Map
                          </a>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-300">{getAddedByLabel(expense)}</td>
                      <td className="px-2 py-2 text-right font-medium">{formatAmount(expense.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-slate-400">
                      No transactions loaded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => void changePage(currentPage - 1)}
              disabled={loading || currentPage <= 1}
            >
              Previous
            </button>
            <p className="text-sm text-slate-400">
              Page {Math.min(currentPage, totalPages)} of {totalPages} ({totalCount} transactions)
            </p>
            <button
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => void changePage(currentPage + 1)}
              disabled={loading || currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

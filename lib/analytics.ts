import { getAddedByPerson } from "@/lib/expense-labels";
import { Expense, ExpenseStats } from "@/lib/types";

export function computeExpenseStats(expenses: Expense[]): ExpenseStats {
  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  const categoryMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  const dayPersonMap = new Map<string, Map<string, number>>();

  for (const expense of expenses) {
    categoryMap.set(
      expense.category,
      (categoryMap.get(expense.category) || 0) + expense.amount,
    );

    const day = expense.expense_date.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + expense.amount);

    // Same person names as the dashboard's "Added by" column.
    const person = getAddedByPerson(expense);
    const people = dayPersonMap.get(day) || new Map<string, number>();
    people.set(person, (people.get(person) || 0) + expense.amount);
    dayPersonMap.set(day, people);
  }

  const categoryTotals = [...categoryMap.entries()]
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))
    .sort((a, b) => b.total - a.total);

  const dailyTotals = [...dayMap.entries()]
    .map(([date, total]) => ({
      date,
      total: Number(total.toFixed(2)),
      byPerson: Object.fromEntries(
        [...(dayPersonMap.get(date) || new Map<string, number>()).entries()].map(([person, amount]) => [
          person,
          Number(amount.toFixed(2)),
        ]),
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    count: expenses.length,
    categoryTotals,
    dailyTotals,
  };
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

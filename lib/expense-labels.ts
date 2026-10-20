// Shared by the dashboard (client) and the server, so keep this free of server-only imports.

interface AddedByFields {
  mobile_meta?: { channel?: string } | null;
  added_by_telegram_id: number | null;
  added_by_telegram_name: string | null;
}

export function formatTelegramDisplayName(user: {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
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

/** The person who made the expense, used to group the daily spend chart. */
export function getAddedByPerson(expense: AddedByFields): string {
  if (expense.added_by_telegram_name) {
    return expense.added_by_telegram_name;
  }
  if (expense.added_by_telegram_id) {
    return `Telegram ${expense.added_by_telegram_id}`;
  }
  return expense.mobile_meta?.channel ? "Auto Capture" : "Self";
}

/** The "Added by" text shown for an expense, e.g. "Lakshay (Auto Capture)". */
export function getAddedByLabel(expense: AddedByFields): string {
  const person = getAddedByPerson(expense);
  const knownPerson = Boolean(expense.added_by_telegram_name || expense.added_by_telegram_id);
  if (expense.mobile_meta?.channel && knownPerson) {
    return `${person} (Auto Capture)`;
  }
  return person;
}

import { inferCategory } from "@/lib/expense-parser";

export interface ParsedUpiMobileExpense {
  amount: number;
  merchant: string;
  reference: string | null;
  category: string;
  note: string;
}

export type ParsedUpiMobileResult =
  | { status: "parsed"; value: ParsedUpiMobileExpense }
  | { status: "ignored"; reason: string };

const INCLUDE_PATTERNS: RegExp[] = [
  /\bpaid\b/i,
  /\bdebited\b/i,
  /\bsent\b/i,
  /\bpayment of\b/i,
  /\bpayment successful\b/i,
  /\bupi txn\b/i,
  /\bwithdrawn\b/i,
  // Credit-card UPI payments: "Rs. 100 spent on your credit card xx2056 at <merchant> on <date>".
  /\bspent\b/i,
];

// Bank debit SMS often name the payee as "debited A/c... and credited to <payee>", so these
// words describe the other side of the transfer once the message already says "debited".
const PAYEE_SIDE_PATTERNS: RegExp[] = [/\bcredited\b/i, /\breceived\b/i];

const EXCLUDE_PATTERNS: RegExp[] = [
  /\brequest\b/i,
  /\bcollect\b/i,
  /\bpending\b/i,
  /\bfailed\b/i,
  /\brefund\b/i,
  /\breversal\b/i,
  ...PAYEE_SIDE_PATTERNS,
];

const MERCHANT_PATTERNS: RegExp[] = [
  /\bspent\b.*?\bat\s+([a-z0-9&@._\-\s]{2,80}?)(?=\s+on\s+\d)/i,
  /(?:paid|sent|payment(?:\s+of)?)\s+(?:to|at)\s+([a-z0-9&@._\-\s]{2,80}?)(?=\s+(?:via|through)\s+upi|\s+upi\b|\s+(?:ref|utr|txn)\b|[.,]|$)/i,
  /(?:to|at)\s+([a-z0-9&@._\-\s]{2,80}?)(?=\s+(?:via|through)\s+upi|\s+upi\b|\s+(?:ref|utr|txn)\b|[.,]|$)/i,
];

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function sanitizeMerchant(input: string): string {
  return normalizeWhitespace(input).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function isWeakMerchant(input: string): boolean {
  if (!input || input.length < 2) {
    return true;
  }
  return /\b(a\/?c|account|bank|upi|transaction|txn)\b/i.test(input);
}

function extractAmount(message: string): number | null {
  const forward = message.match(/(?:\u20b9|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const backward = message.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:\u20b9|rs\.?|inr)\b/i);
  const raw = (forward?.[1] || backward?.[1] || "").replace(/,/g, "");
  if (!raw) {
    return null;
  }
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Number(amount.toFixed(2));
}

function extractReference(message: string): string | null {
  const patterns = [
    /(?:upi\s*(?:ref(?:erence)?(?:\s*no)?|txn(?:\s*id)?|utr)[\s:#-]*)([a-z0-9-]{6,40})/i,
    /(?:ref(?:erence)?(?:\s*no)?|utr|txn(?:\s*id)?)[\s:#-]*([a-z0-9-]{6,40})/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.toUpperCase();
    }
  }
  return null;
}

function extractMerchant(message: string, appOrSender?: string | null): string {
  for (const pattern of MERCHANT_PATTERNS) {
    const candidate = sanitizeMerchant(pattern.exec(message)?.[1] || "");
    if (!isWeakMerchant(candidate)) {
      return candidate;
    }
  }

  const fallback = sanitizeMerchant(appOrSender || "");
  if (!isWeakMerchant(fallback)) {
    return fallback;
  }

  return "UPI";
}

export function parseUpiMobileMessage(params: {
  message: string;
  appOrSender?: string | null;
}): ParsedUpiMobileResult {
  const note = normalizeWhitespace(params.message);
  if (!note) {
    return { status: "ignored", reason: "Empty message body" };
  }

  const isUpi = /\bupi\b/i.test(note);
  // Cash withdrawals ("Rs.5000 withdrawn from a/c xx1234") are real debits but never mention UPI.
  const isAccountWithdrawal = /\bwithdrawn\b/i.test(note) && /\b(?:a\/c|acct|account)\b/i.test(note);
  if (!isUpi && !isAccountWithdrawal) {
    return { status: "ignored", reason: "Message does not look like a UPI transaction" };
  }

  const isExplicitDebit = /\bdebited\b/i.test(note);
  const excludePatterns = isExplicitDebit
    ? EXCLUDE_PATTERNS.filter((pattern) => !PAYEE_SIDE_PATTERNS.includes(pattern))
    : EXCLUDE_PATTERNS;
  if (excludePatterns.some((pattern) => pattern.test(note))) {
    return { status: "ignored", reason: "Message matched ignored transaction status" };
  }

  if (!INCLUDE_PATTERNS.some((pattern) => pattern.test(note))) {
    return { status: "ignored", reason: "Message does not indicate a confirmed debit/payment" };
  }

  const amount = extractAmount(note);
  if (!amount) {
    return { status: "ignored", reason: "Amount could not be extracted" };
  }

  const merchant = isUpi ? extractMerchant(note, params.appOrSender) : "Cash Withdrawal";
  const reference = extractReference(note);
  const category = inferCategory(`${merchant} ${note}`);

  return {
    status: "parsed",
    value: {
      amount,
      merchant,
      reference,
      category,
      note,
    },
  };
}

import { ParsedExpenseLine } from "@/lib/types";

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  {
    category: "Food",
    keywords: [
      "pizza",
      "burger",
      "food",
      "dinner",
      "lunch",
      "snack",
      "chaap",
      "chai",
      "nashta",
      "khana",
      "biryani",
      "thali",
      "paneer",
    ],
  },
  {
    category: "Transport",
    keywords: [
      "uber",
      "ola",
      "taxi",
      "bus",
      "metro",
      "fuel",
      "petrol",
      "diesel",
      "auto",
      "rickshaw",
      "rikshaw",
      "gaadi",
      "gadi",
      "parking",
      "toll",
    ],
  },
  {
    category: "Groceries",
    keywords: [
      "grocery",
      "groceries",
      "supermarket",
      "vegetable",
      "milk",
      "kirana",
      "ration",
      "atta",
      "chawal",
      "rice",
      "dal",
      "daal",
      "aata",
    ],
  },
  {
    category: "Bills",
    keywords: [
      "rent",
      "electricity",
      "water",
      "internet",
      "recharge",
      "kiraya",
      "bijli",
      "pani",
      "wifi",
      "broadband",
      "gas bill",
      "bill",
    ],
  },
  {
    category: "Health",
    keywords: [
      "medicine",
      "doctor",
      "hospital",
      "pharmacy",
      "dawai",
      "dawa",
      "clinic",
      "checkup",
      "test",
      "lab",
    ],
  },
  {
    category: "Entertainment",
    keywords: ["movie", "netflix", "game", "concert", "picture", "ott", "match", "cinema"],
  },
  {
    category: "Shopping",
    keywords: ["amazon", "flipkart", "clothes", "shopping", "mall", "kapde", "joota", "chappal"],
  },
  { category: "Travel", keywords: ["flight", "hotel", "trip", "booking", "airbnb", "safar", "yatra"] },
];

const LINE_PATTERN = /^(.+?)\s+(-?\d+(?:\.\d{1,2})?)$/;

export interface ParsedExpenseBatch {
  parsed: ParsedExpenseLine[];
  invalid: Array<{ line: string; reason: string }>;
}

export function parseExpenseMessage(text: string): ParsedExpenseBatch {
  const parsed: ParsedExpenseLine[] = [];
  const invalid: Array<{ line: string; reason: string }> = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("/")) {
      continue;
    }

    const match = line.match(LINE_PATTERN);
    if (!match) {
      invalid.push({
        line,
        reason: "Expected format: `<name> <amount>`, e.g. `pizza 450`",
      });
      continue;
    }

    const note = match[1].trim();
    const amount = Number.parseFloat(match[2]);

    if (!Number.isFinite(amount) || amount <= 0) {
      invalid.push({
        line,
        reason: "Amount must be a positive number",
      });
      continue;
    }

    const merchant = extractMerchant(note);
    const category = inferCategory(note);

    parsed.push({
      amount: Number(amount.toFixed(2)),
      category,
      merchant,
      note,
    });
  }

  return { parsed, invalid };
}

function extractMerchant(note: string): string {
  const cleaned = note.replace(/[^\w\s&.-]/g, " ").trim();
  if (!cleaned) {
    return "Unknown";
  }

  const [first, second] = cleaned.split(/\s+/, 2);
  return [first, second].filter(Boolean).join(" ");
}

export function inferCategory(note: string): string {
  const lowered = note.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword))) {
      return rule.category;
    }
  }
  return "Other";
}

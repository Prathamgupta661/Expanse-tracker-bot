const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL?.trim(),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY?.trim(),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET?.trim(),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY?.trim(),
  OPENROUTER_INSIGHT_MODEL:
    process.env.OPENROUTER_INSIGHT_MODEL?.trim() ||
    "meta-llama/llama-3.1-8b-instruct:free",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim(),
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI?.trim(),
  APP_AUTH_SECRET: process.env.APP_AUTH_SECRET?.trim(),
  CRON_SECRET: process.env.CRON_SECRET?.trim(),
  DEV_AUTH_ENABLED: process.env.DEV_AUTH_ENABLED?.trim(),
  DEV_AUTH_ALLOWED_EMAILS: process.env.DEV_AUTH_ALLOWED_EMAILS?.trim(),
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE?.trim() || "Asia/Kolkata",
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY?.trim() || "INR",
  APP_BASE_URL: process.env.APP_BASE_URL?.trim(),
} as const;

function assertEnvValue(value: string | undefined, key: keyof typeof ENV): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  appBaseUrl: ENV.APP_BASE_URL,
  defaultTimezone: ENV.DEFAULT_TIMEZONE,
  defaultCurrency: ENV.DEFAULT_CURRENCY,
  openRouterInsightModel: ENV.OPENROUTER_INSIGHT_MODEL,
  telegramWebhookSecret: ENV.TELEGRAM_WEBHOOK_SECRET,
  cronSecret: ENV.CRON_SECRET,
  isDevAuthEnabled() {
    return process.env.NODE_ENV !== "production" && ENV.DEV_AUTH_ENABLED === "true";
  },
  getDevAuthAllowedEmails() {
    const raw = ENV.DEV_AUTH_ALLOWED_EMAILS;
    if (!raw) {
      return [];
    }
    return raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  },
  getTelegramToken() {
    return assertEnvValue(ENV.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  },
  getSupabaseUrl() {
    return assertEnvValue(ENV.SUPABASE_URL, "SUPABASE_URL");
  },
  getSupabaseAnonKey() {
    return assertEnvValue(ENV.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY");
  },
  getSupabaseServiceRoleKey() {
    return assertEnvValue(ENV.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  },
  getOpenRouterKey() {
    return assertEnvValue(ENV.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
  },
  getGoogleClientId() {
    return assertEnvValue(ENV.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  },
  getGoogleClientSecret() {
    return assertEnvValue(ENV.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  },
  getGoogleRedirectUri(fallbackBaseUrl: string) {
    return ENV.GOOGLE_REDIRECT_URI || `${fallbackBaseUrl}/api/auth/google/callback`;
  },
  getAppAuthSecret() {
    return assertEnvValue(ENV.APP_AUTH_SECRET, "APP_AUTH_SECRET");
  },
} as const;

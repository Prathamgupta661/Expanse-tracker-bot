# Expense Tracker Telegram Bot + Dashboard

This app includes:
- Telegram webhook ingestion (`pizza 450`, `uber 220` style multi-line input)
- Supabase-backed expense storage
- Google OAuth login for dashboard (app-managed session cookie)
- Dashboard breakdown UI (totals, categories, recent transactions)
- AI insights via OpenRouter free model with DB caching
- Async AI category refinement queue for new expenses
- Daily cron endpoint for scheduled insight generation

## Setup

1. Copy `.env.example` to `.env.local` and fill values.
   - Set server Supabase vars:
     - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - Set Google OAuth vars:
     - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_AUTH_SECRET`
     - Optional: `GOOGLE_REDIRECT_URI` (defaults to `{APP_BASE_URL}/api/auth/google/callback`)
   - For ngrok development, set:
     - `APP_BASE_URL` to your ngrok URL
2. Run `supabase/schema.sql` in your Supabase SQL editor.
3. Run new migrations from `supabase/migrations/*` if your DB already exists.
4. Start app:

```bash
npm run dev
```

## Telegram Behavior

- Send lines like:

```text
pizza 450
uber 220
```

- One line = one expense row.
- If date/time is not provided, default `expense_date` uses Telegram message timestamp.

Commands:
- `/start` or `/help`
- `/today`
- `/month`
- `/insight` (returns latest cached)
- `/insight refresh` (forces regeneration)
- `/email you@example.com` (stores email + sends account-link URL)

## Dashboard Auth

- Open `/login` and continue with Google.
- After login, dashboard auto-loads your own expenses (no manual user id input).
- If account not linked yet, run `/email ...` in Telegram and open the link from bot.

## API Endpoints

- `POST /api/telegram/webhook`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/link`
- `GET /api/expenses`
- `POST /api/expenses`
- `PATCH /api/expenses/:id`
- `DELETE /api/expenses/:id`
- `GET /api/insights?period=daily|weekly|monthly&generate=false`
- `POST /api/insights/regenerate`
- `POST /api/cron/insights-daily` (header `x-cron-secret`)
- `POST /api/cron/categorize-expenses` (header `x-cron-secret`)

## Cron Insight Strategy

- Expense insert path does **not** call LLM.
- Daily cron generates cached daily insights.
- User request reads cached insight by default.
- Regeneration happens only when explicitly requested.

## AI Category Strategy

- Expense insert uses deterministic rule category first.
- A background categorization job is queued for each new expense.
- Cron endpoint processes jobs and updates category/confidence from AI.

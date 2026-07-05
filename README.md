# Expense Tracker Telegram Bot + Dashboard

This app includes:
- Telegram webhook ingestion (`pizza 450`, `uber 220` style multi-line input)
- Supabase-backed expense storage
- Supabase Auth magic-link login for dashboard
- Dashboard breakdown UI (totals, categories, recent transactions)
- AI insights via OpenRouter free model with DB caching
- Async AI category refinement queue for new expenses
- Daily cron endpoint for scheduled insight generation

## Setup

1. Copy `.env.example` to `.env.local` and fill values.
   - Set both server and public Supabase vars:
     - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Run `supabase/schema.sql` in your Supabase SQL editor.
3. Start app:

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

- Open `/login` and request a magic link.
- After login, dashboard auto-loads your own expenses (no manual user id input).
- If account not linked yet, run `/email ...` in Telegram and open the link from bot.

## API Endpoints

- `POST /api/telegram/webhook`
- `POST /api/auth/magic-link`
- `GET /api/auth/me`
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

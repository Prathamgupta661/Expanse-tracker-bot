# Expense Tracker Telegram Bot + Dashboard

This app includes:
- Telegram webhook ingestion (`pizza 450`, `uber 220` style multi-line input)
- Supabase-backed expense storage
- Dashboard breakdown UI (totals, categories, recent transactions)
- AI insights via OpenRouter free model with DB caching
- Daily cron endpoint for scheduled insight generation

## Setup

1. Copy `.env.example` to `.env.local` and fill values.
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

## API Endpoints

- `POST /api/telegram/webhook`
- `GET /api/expenses?userId=...`
- `POST /api/expenses`
- `PATCH /api/expenses/:id`
- `DELETE /api/expenses/:id?userId=...`
- `GET /api/insights?userId=...&period=daily|weekly|monthly&generate=false`
- `POST /api/insights/regenerate`
- `POST /api/cron/insights-daily` (header `x-cron-secret`)

## Cron Insight Strategy

- Expense insert path does **not** call LLM.
- Daily cron generates cached daily insights.
- User request reads cached insight by default.
- Regeneration happens only when explicitly requested.
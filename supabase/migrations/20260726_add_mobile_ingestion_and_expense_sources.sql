alter table public.expenses
  add column if not exists mobile_meta jsonb;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key,
  telegram_id bigint unique,
  auth_user_id uuid unique,
  google_sub text unique,
  email text unique,
  email_collected_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists google_sub text;

create table if not exists public.profile_telegram_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (user_id) on delete cascade,
  telegram_id bigint not null unique,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, telegram_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  category text not null,
  merchant text not null default 'Unknown',
  note text not null default '',
  expense_date timestamptz not null,
  source text not null check (source in ('telegram', 'dashboard')),
  category_source text not null default 'rule' check (category_source in ('rule', 'ai', 'manual')),
  category_reason text,
  confidence numeric(4,3) not null default 1,
  added_by_telegram_id bigint,
  added_by_telegram_name text,
  created_at timestamptz not null default now()
);

alter table public.expenses
  add column if not exists added_by_telegram_id bigint,
  add column if not exists added_by_telegram_name text;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  category text not null,
  period text not null check (period in ('weekly', 'monthly')),
  limit_amount numeric(12,2) not null check (limit_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  period text not null check (period in ('daily', 'weekly', 'monthly')),
  bucket_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary text not null,
  anomalies jsonb not null default '[]'::jsonb,
  tips jsonb not null default '[]'::jsonb,
  model text not null default '',
  generated_at timestamptz not null default now(),
  unique (user_id, period, bucket_key)
);

create table if not exists public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  source_update_id text unique,
  raw_text text not null,
  parsed_payload jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  email text not null,
  code text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_categorization_jobs (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id)
);

create index if not exists idx_expenses_user_date on public.expenses (user_id, expense_date desc);
create index if not exists idx_expenses_user_category on public.expenses (user_id, category);
create index if not exists idx_expenses_added_by_telegram on public.expenses (added_by_telegram_id);
create index if not exists idx_insights_user_generated on public.ai_insights (user_id, generated_at desc);
create index if not exists idx_profiles_email on public.profiles (email);
create index if not exists idx_profile_telegram_links_owner on public.profile_telegram_links (owner_user_id);
create unique index if not exists idx_profile_telegram_links_telegram_unique
  on public.profile_telegram_links (telegram_id);
create unique index if not exists idx_profiles_google_sub_unique
  on public.profiles (google_sub)
  where google_sub is not null;
create index if not exists idx_auth_link_requests_code on public.auth_link_requests (code);
create index if not exists idx_auth_link_requests_user on public.auth_link_requests (user_id, created_at desc);
create index if not exists idx_categorization_jobs_status on public.expense_categorization_jobs (status, next_attempt_at asc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_budgets_updated_at on public.budgets;
create trigger set_budgets_updated_at
before update on public.budgets
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_ingestion_events_updated_at on public.ingestion_events;
create trigger set_ingestion_events_updated_at
before update on public.ingestion_events
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_expense_categorization_jobs_updated_at on public.expense_categorization_jobs;
create trigger set_expense_categorization_jobs_updated_at
before update on public.expense_categorization_jobs
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_profile_telegram_links_updated_at on public.profile_telegram_links;
create trigger set_profile_telegram_links_updated_at
before update on public.profile_telegram_links
for each row
execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profile_telegram_links enable row level security;
alter table public.expenses enable row level security;
alter table public.budgets enable row level security;
alter table public.ai_insights enable row level security;
alter table public.ingestion_events enable row level security;
alter table public.auth_link_requests enable row level security;
alter table public.expense_categorization_jobs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth_user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "expenses_select_own" on public.expenses;
create policy "expenses_select_own"
on public.expenses
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = expenses.user_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "profile_telegram_links_all_own" on public.profile_telegram_links;
create policy "profile_telegram_links_all_own"
on public.profile_telegram_links
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = profile_telegram_links.owner_user_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = profile_telegram_links.owner_user_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "expenses_write_own" on public.expenses;
create policy "expenses_write_own"
on public.expenses
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = expenses.user_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = expenses.user_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "budgets_all_own" on public.budgets;
create policy "budgets_all_own"
on public.budgets
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = budgets.user_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = budgets.user_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "insights_all_own" on public.ai_insights;
create policy "insights_all_own"
on public.ai_insights
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = ai_insights.user_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = ai_insights.user_id
      and p.auth_user_id = auth.uid()
  )
);

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

alter table public.expenses
  add column if not exists added_by_telegram_id bigint,
  add column if not exists added_by_telegram_name text;

create index if not exists idx_profile_telegram_links_owner on public.profile_telegram_links (owner_user_id);
create unique index if not exists idx_profile_telegram_links_telegram_unique
  on public.profile_telegram_links (telegram_id);
create index if not exists idx_expenses_added_by_telegram on public.expenses (added_by_telegram_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profile_telegram_links_updated_at on public.profile_telegram_links;
create trigger set_profile_telegram_links_updated_at
before update on public.profile_telegram_links
for each row
execute procedure public.set_updated_at();

alter table public.profile_telegram_links enable row level security;

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

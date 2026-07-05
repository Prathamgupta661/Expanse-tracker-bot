alter table public.expenses
  add column if not exists category_source text not null default 'rule'
  check (category_source in ('rule', 'ai', 'manual'));

alter table public.expenses
  add column if not exists category_reason text;

alter table public.expenses
  add column if not exists confidence numeric(4,3) not null default 1;

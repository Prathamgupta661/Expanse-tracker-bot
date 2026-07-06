alter table public.profiles
  add column if not exists google_sub text;

create unique index if not exists idx_profiles_google_sub_unique
  on public.profiles (google_sub)
  where google_sub is not null;

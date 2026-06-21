-- ============================================================
-- WC-26 Predictions schema
-- Run in Supabase SQL Editor. Safe to re-run (idempotent-ish).
-- ============================================================

-- Profiles: one row per anonymous user, holds chosen nickname.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text unique not null,
  created_at  timestamptz not null default now()
);

-- Predictions: one row per (user, match).
create table if not exists public.predictions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  match_num   int  not null,                 -- openfootball match.num (stable 1..104)
  score1      int  not null check (score1 >= 0),
  score2      int  not null check (score2 >= 0),
  pens1       int  check (pens1 >= 0),        -- knockout shootout, nullable
  pens2       int  check (pens2 >= 0),
  published   boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (user_id, match_num)
);

create index if not exists predictions_published_idx
  on public.predictions (published, match_num);

-- ---------- Row Level Security ----------
alter table public.profiles    enable row level security;
alter table public.predictions enable row level security;

-- profiles: anyone (incl. anon) may read nicknames; user manages own row.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- predictions: read published rows OR your own; write only your own.
drop policy if exists predictions_select_visible on public.predictions;
create policy predictions_select_visible on public.predictions
  for select using (published or auth.uid() = user_id);

drop policy if exists predictions_insert_own on public.predictions;
create policy predictions_insert_own on public.predictions
  for insert with check (auth.uid() = user_id);

drop policy if exists predictions_update_own on public.predictions;
create policy predictions_update_own on public.predictions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists predictions_delete_own on public.predictions;
create policy predictions_delete_own on public.predictions
  for delete using (auth.uid() = user_id);

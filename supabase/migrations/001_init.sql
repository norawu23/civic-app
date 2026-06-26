-- Run this in the Supabase SQL editor before using the app.
-- Supabase dashboard → SQL Editor → paste → Run

-- ── profiles ─────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null,
  avatar     text not null default '🦅',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "profiles_update" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- ── progress ──────────────────────────────────────────────────────────────────

create table if not exists public.progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique not null references auth.users on delete cascade,
  progress_data jsonb not null,
  updated_at    timestamptz not null default now()
);

alter table public.progress enable row level security;

create policy "progress_select" on public.progress
  for select to authenticated using (auth.uid() = user_id);

create policy "progress_insert" on public.progress
  for insert to authenticated with check (auth.uid() = user_id);

create policy "progress_update" on public.progress
  for update to authenticated using (auth.uid() = user_id);

-- ── auto-upsert progress on first login (optional convenience trigger) ────────
-- Uncomment if you want rows created automatically even if the client insert fails.
--
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   insert into public.profiles (id, username) values (new.id, split_part(new.email,'@',1))
--   on conflict (id) do nothing;
--   return new;
-- end;
-- $$;
--
-- create trigger on_auth_user_created
--   after insert on auth.users
--   for each row execute procedure public.handle_new_user();

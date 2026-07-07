-- repair_prod.sql — one-time, hand-reviewed reconciliation of LIVE PROD to 0001_schema.sql
-- =============================================================================
-- Authored by the operator 2026-07-07 from a real schema-only pg_dump of prod
-- (Postgres 17.6) + read-only data inspection. This SUPERSEDES the builder's
-- A1 skeleton, which was written against the stale repo migration 001_init.sql
-- and assumed transforms (`avatar` text emoji, `progress_data` jsonb blob) that
-- DO NOT EXIST in real prod.
--
-- ACTUAL prod state at authoring time (public schema only):
--   profiles       — 5 rows (internal/test accounts). Columns: id, username,
--                    avatar_id int default 1, created_at, is_admin. NULLABLE
--                    username/avatar_id/is_admin/created_at; no length/range
--                    checks; no birth_year; no needs_profile_completion.
--   progress       — 0 rows. Already id=auth.users PK (no surrogate key, no
--                    progress_data blob). last_login_date is TEXT. Missing:
--                    streak_freezes, streak_freeze_awarded_at, tz_offset_minutes,
--                    imported_from_guest, schema_version, updated_at.
--   evolved_takes  — 0 rows. id is UUID (target: bigint identity); missing
--                    is_custom, is_imported; no unique(user_id,opinion_builder_id).
--   + 9 legacy direct-write RLS policies (target 0001 = ZERO policies).
--   MISSING entirely: nuance_sessions, xp_awards, quiz_answer_keys,
--                     topics_catalog, events.
--
-- STRATEGY: profiles has data → ALTER in place. progress + evolved_takes are
-- empty → drop & recreate exactly per 0001 (guarantees id-type/column match).
-- Create the 5 missing tables + indexes. Drop all legacy policies to reach
-- 0001's default-deny (zero-policy) state — this is the D-002 legacy-client
-- write break, by design.
--
-- ⚠ OPERATOR-RATIFY BEFORE RUNNING (flagged decision, see §1 below):
--   One of the 5 existing accounts has a 21-char username (an email address)
--   that violates 0001's 3–20 check. This script rewrites any such username to
--   the email local-part where that fits (identity-preserving), else a
--   deterministic placeholder, and sets needs_profile_completion=true so the
--   user is re-prompted. Confirm this is acceptable, or supply an alternative,
--   before execution. (The specific account is recorded in decisions.md D-006,
--   not here, to keep user PII out of version control.)
--
-- ⚠ This script is NOT auto-run. Per BUILD_PLAN §3a it runs against prod ONCE,
--   by the operator, in week 2, AFTER: (1) a full pg_dump backup stored
--   off-platform, (2) A1/0001 merged + CI-green. On any failure: restore.
--   Rehearsed locally against the real prod dump → empty diff vs 0001 shadow.
-- =============================================================================

-- NOTE: all three legacy tables are dropped & recreated (profiles' 5 rows are
-- preserved via a backup + reinsert). Dropping the tables also removes their 11
-- legacy direct-write policies, reaching 0001's zero-policy default-deny state —
-- so no explicit DROP POLICY is needed. Recreating profiles (rather than ALTER)
-- is what makes the post-repair column ORDER match 0001 exactly (Postgres cannot
-- reorder columns in place), yielding a byte-empty schema diff.

begin;

-- ── 1. profiles: preserve 5 rows → drop → recreate per 0001 → reinsert ──────────
-- Backup applies the flagged username repair inline (see header §ratify): the one
-- overlength/invalid username is rewritten to the email local-part where that fits
-- (else a deterministic placeholder), and that row is flagged needs_profile_completion.
create temp table _profiles_backup on commit drop as
  select id,
         case when username is null or char_length(username) not between 3 and 20 then
                case when char_length(split_part(username, '@', 1)) between 3 and 20
                     then split_part(username, '@', 1)
                     else 'user_' || left(replace(id::text, '-', ''), 12) end
              else username end                                                as username,
         coalesce(avatar_id, 1)                                               as avatar_id,
         coalesce(is_admin, false)                                            as is_admin,
         coalesce(created_at, now())                                          as created_at,
         (username is null or char_length(username) not between 3 and 20)     as needs_profile_completion
    from public.profiles;

drop table public.profiles cascade;
create table public.profiles (
  id                        uuid primary key references auth.users on delete cascade,
  username                  text not null unique check (char_length(username) between 3 and 20),
  avatar_id                 int not null default 1 check (avatar_id between 1 and 6),
  is_admin                  boolean not null default false,
  birth_year                int check (birth_year between 1900 and 2100),
  needs_profile_completion  boolean not null default false,
  created_at                timestamptz not null default now()
);
alter table public.profiles enable row level security;
insert into public.profiles (id, username, avatar_id, is_admin, birth_year, needs_profile_completion, created_at)
  select id, username, avatar_id, is_admin, null, needs_profile_completion, created_at
    from _profiles_backup;

-- ── 2. progress: empty → drop & recreate exactly per 0001 ───────────────────────
drop table public.progress cascade;
create table public.progress (
  id                        uuid primary key references auth.users on delete cascade,
  total_xp                  int not null default 0 check (total_xp >= 0),
  streak                    int not null default 1 check (streak >= 0),
  last_login_date           date,
  streak_freezes            int not null default 0 check (streak_freezes between 0 and 1),
  streak_freeze_awarded_at  date,
  tz_offset_minutes         int not null default 0 check (tz_offset_minutes between -840 and 840),
  imported_from_guest       boolean not null default false,
  topics                    jsonb not null default '{}',
  opinion_builders          jsonb not null default '{}',
  schema_version            int not null default 2,
  updated_at                timestamptz not null default now()
);
alter table public.progress enable row level security;

-- ── 3. evolved_takes: empty → drop & recreate exactly per 0001 ──────────────────
drop table public.evolved_takes cascade;
create table public.evolved_takes (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users on delete cascade,
  topic_id            text not null,
  opinion_builder_id  text not null,
  cold_take           text not null check (cold_take in ('yes','no')),
  evolved_take        text not null,
  is_custom           boolean not null default false,
  is_imported         boolean not null default false,
  xp_earned           int not null,
  created_at          timestamptz not null default now(),
  unique (user_id, opinion_builder_id)
);
alter table public.evolved_takes enable row level security;

-- ── 4. Missing tables (create exactly per 0001) ─────────────────────────────────
create table public.nuance_sessions (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users on delete cascade,
  anon_id       text,
  kind          text not null check (kind in ('baseline','day30')),
  answers       jsonb not null,
  score         int not null,
  elapsed_days  int,
  excluded      boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint nuance_sessions_identity_check check (user_id is not null or anon_id is not null),
  unique nulls not distinct (user_id, anon_id, kind)
);
alter table public.nuance_sessions enable row level security;

create table public.xp_awards (
  action  text primary key,
  xp      int not null
);
alter table public.xp_awards enable row level security;
insert into public.xp_awards (action, xp) values
  ('flashcards',            50),
  ('quiz',                  50),
  ('quiz_perfect_bonus',    25),
  ('opinion_builder',      100),
  ('opinion_builder_bonus', 200);

create table public.quiz_answer_keys (
  topic_id  text not null,
  level     int not null,
  answers   int[] not null,
  primary key (topic_id, level)
);
alter table public.quiz_answer_keys enable row level security;

create table public.topics_catalog (
  topic_id     text primary key,
  position     int not null,
  level_count  int not null
);
alter table public.topics_catalog enable row level security;

create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  anon_id     text,
  name        text not null,
  props       jsonb,
  created_at  timestamptz not null default now()
);
alter table public.events enable row level security;

-- ── 5. Indexes (match 0001) ─────────────────────────────────────────────────────
create index events_user_id_idx on public.events (user_id) where user_id is not null;
create index events_anon_id_idx on public.events (anon_id) where anon_id is not null;
create index nuance_sessions_anon_id_idx on public.nuance_sessions (anon_id) where anon_id is not null;

commit;

-- After this runs green against prod, mark prod at migration 0001:
--   supabase migration repair --status applied 0001
-- then run scripts/schema-diff.sh <prod-conn> <ci-shadow-conn> → must be empty.

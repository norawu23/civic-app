-- 0001_schema.sql
-- CIVIC — P0 database schema, built from empty.
--
-- Ownership (D-005 §1, ratified 2026-07-06): this migration is owned
-- exclusively by chunk A1. It contains all P0 tables, constraints, indexes,
-- and RLS enablement — with ZERO policies (default-deny from the first
-- migration: a schema-only deploy can never leak a row).
--
-- Explicitly OUT of this file (owned by later chunks — do not add here):
--   * triggers / functions / RPCs                    (A2, A3, B*)
--   * RLS policies                                    (A3)
--   * seeding quiz_answer_keys / topics_catalog rows   (H1, from content JSON)
--   * P1 tables: level3_content, level3_quiz,
--     push_subscriptions                               (ship with their P1 features)
--   * P2 tables: classes, class_members, daily_digest   (P2 only)
--
-- Source of truth: docs/ARCHITECTURE.md §2.2 (DDL text, transcribed verbatim
-- except for the two amendments below, both already reflected in §2.2's
-- prose / decisions.md and restated in docs/specs/A1-migration-squash.md):
--   * profiles.needs_profile_completion boolean NOT NULL DEFAULT false  [r3]
--   * progress.tz_offset_minutes int NOT NULL DEFAULT 0                (D-001)
--
-- This migration must apply cleanly to an empty database (`supabase db
-- reset` / a fresh shadow DB in CI). It supersedes and replaces the deleted
-- supabase/migrations/001_init.sql, which built the wrong (legacy) shape.

begin;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- One row per auth.users row (created by A2's on_auth_user_created trigger;
-- no client INSERT — see ARCHITECTURE §2.2 comment block).

create table public.profiles (
  id                        uuid primary key references auth.users on delete cascade,
  username                  text not null unique check (char_length(username) between 3 and 20),
  avatar_id                 int not null default 1 check (avatar_id between 1 and 6),
  is_admin                  boolean not null default false,
  birth_year                int check (birth_year between 1900 and 2100),  -- nullable: NULL = legacy row / re-prompt (ARCHITECTURE §2.1.5)
  needs_profile_completion  boolean not null default false,                -- [r3]: trigger-fallback signup never strands an auth.users row
  created_at                timestamptz not null default now()
);

alter table public.profiles enable row level security;
-- Zero policies: default-deny. Policies land in 0003 (A3).

-- ── progress ──────────────────────────────────────────────────────────────────
-- One row per auth.users row, id doubles as the FK (no separate surrogate key
-- and no user_id column — this is the shape the legacy prod DB is repaired to;
-- see repair_prod.sql).

create table public.progress (
  id                        uuid primary key references auth.users on delete cascade,
  total_xp                  int not null default 0 check (total_xp >= 0),
  streak                    int not null default 1 check (streak >= 0),
  last_login_date           date,
  streak_freezes            int not null default 0 check (streak_freezes between 0 and 1),
  streak_freeze_awarded_at  date,                                          -- enforces 1/month award cap
  tz_offset_minutes         int not null default 0 check (tz_offset_minutes between -840 and 840),  -- D-001
  imported_from_guest       boolean not null default false,                -- analytics honesty (§4.6)
  topics                    jsonb not null default '{}',
  opinion_builders          jsonb not null default '{}',
  schema_version            int not null default 2,
  updated_at                timestamptz not null default now()
);

alter table public.progress enable row level security;
-- Zero policies: default-deny. No direct writes even after 0003 — RPC only.

-- ── evolved_takes ─────────────────────────────────────────────────────────────

create table public.evolved_takes (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users on delete cascade,
  topic_id            text not null,
  opinion_builder_id  text not null,
  cold_take           text not null check (cold_take in ('yes','no')),
  evolved_take        text not null,
  is_custom           boolean not null default false,
  is_imported         boolean not null default false,   -- came via guest import
  xp_earned           int not null,
  created_at          timestamptz not null default now(),
  unique (user_id, opinion_builder_id)
);

alter table public.evolved_takes enable row level security;
-- Zero policies: default-deny. SELECT own / INSERT via RPC land in 0003.

-- ── nuance_sessions ────────────────────────────────────────────────────────────

create table public.nuance_sessions (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users on delete cascade,  -- NULLABLE (fixes B1: anon baseline)
  anon_id       text,                                          -- guest identity
  kind          text not null check (kind in ('baseline','day30')),
  answers       jsonb not null,   -- [{question_id, response_type, position?, other_side?}]
  score         int not null,     -- computed server-side (§5.1.3 rubric)
  elapsed_days  int,              -- day30 rows: actual days since baseline
  excluded      boolean not null default false,  -- admin flag: omit from cited aggregates (N8)
  created_at    timestamptz not null default now(),
  constraint nuance_sessions_identity_check check (user_id is not null or anon_id is not null),
  unique nulls not distinct (user_id, anon_id, kind)
);

alter table public.nuance_sessions enable row level security;
-- Zero policies: default-deny. INSERT via RPC only; SELECT own lands in 0003.

-- ── xp_awards ─────────────────────────────────────────────────────────────────
-- Single source of truth for XP values. Seeded here (D-005 §2) as reference
-- data — this table has real rows in 0001, unlike quiz_answer_keys /
-- topics_catalog below, which are seeded from content JSON by H1's CI job.

create table public.xp_awards (
  action  text primary key,
  xp      int not null
);

alter table public.xp_awards enable row level security;
-- Zero policies: default-deny. Reference data is read via RPC / service role,
-- not direct client SELECT, until 0003 decides otherwise.

insert into public.xp_awards (action, xp) values
  ('flashcards',            50),
  ('quiz',                  50),
  ('quiz_perfect_bonus',    25),
  ('opinion_builder',      100),
  ('opinion_builder_bonus', 200);

-- ── quiz_answer_keys ───────────────────────────────────────────────────────────
-- Empty in 0001 — seeded by CI from content JSON (H1's chunk, not A1's).

create table public.quiz_answer_keys (
  topic_id  text not null,
  level     int not null,
  answers   int[] not null,
  primary key (topic_id, level)
);

alter table public.quiz_answer_keys enable row level security;
-- Zero policies: default-deny.

-- ── topics_catalog ─────────────────────────────────────────────────────────────
-- Empty in 0001 — seeded by CI from content JSON (H1's chunk, not A1's).

create table public.topics_catalog (
  topic_id     text primary key,
  position     int not null,
  level_count  int not null
);

alter table public.topics_catalog enable row level security;
-- Zero policies: default-deny.

-- ── events ────────────────────────────────────────────────────────────────────
-- Anonymous writes ONLY via rpc.log_event (SECURITY DEFINER, A2/A3+), which
-- enforces a per-identity daily quota and a name allowlist. No direct table
-- INSERT grant for anon — transcribed verbatim from ARCHITECTURE §2.2,
-- including its lack of FK on user_id/anon_id (event rows must survive
-- account deletion for aggregate analytics).

create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  anon_id     text,
  name        text not null,
  props       jsonb,
  created_at  timestamptz not null default now()
);

alter table public.events enable row level security;
-- Zero policies: default-deny. rpc.log_event (SECURITY DEFINER) lands later.

-- ── indexes ───────────────────────────────────────────────────────────────────
-- Additive, non-schema-altering: FK/identity lookup columns not already
-- covered as a leading column of a PK/UNIQUE index above. Not present in
-- ARCHITECTURE §2.2's DDL text (which is silent on indexes beyond
-- PK/UNIQUE); added per D-005 §1's "tables + constraints + indexes" charter.

create index events_user_id_idx on public.events (user_id) where user_id is not null;
create index events_anon_id_idx on public.events (anon_id) where anon_id is not null;
create index nuance_sessions_anon_id_idx on public.nuance_sessions (anon_id) where anon_id is not null;

commit;

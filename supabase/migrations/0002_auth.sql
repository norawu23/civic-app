-- 0002_auth.sql
-- CIVIC — signup trigger + username_available RPC (A2)
--
-- Ownership (D-005 §1): this migration is owned exclusively by chunk A2. It
-- adds the SECURITY DEFINER trigger that populates profiles/progress from
-- auth.users signup metadata, and the username_available pre-flight RPC.
--
-- Explicitly OUT of this file (owned by later chunks — do not add here):
--   * RLS policies, the column-restriction trigger, is_admin()   (A3, 0003)
--   * any complete_* / nuance / import / log_event / delete_account RPC (WS-B)
--
-- Source of truth: docs/specs/A2-auth-trigger-username.md (frozen contract);
-- ARCHITECTURE.md v3.2 §2.2 / §3 / §8.1; D-008 (2026-07-07, batch 1b).

begin;

-- ── public.username_available ────────────────────────────────────────────────
-- Pre-flight check called before login, so it must be reachable by anon.
-- SECURITY DEFINER + STABLE. Uses the identical comparison the UNIQUE index
-- on profiles.username uses (plain btree text equality — case-sensitive
-- exact match). citext / case-folding is an explicit non-goal (D-008 §1,
-- freeze ruling): a "yes" here must never then collide in the trigger.

create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    name is not null
    and char_length(name) between 3 and 20
    and not exists (
      select 1 from public.profiles p where p.username = name
    );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ── public.handle_new_user / on_auth_user_created ────────────────────────────
-- Fires once per new auth.users row (real signup, or a future admin-created
-- user). SECURITY DEFINER so it can write profiles/progress, both RLS-
-- enabled with zero policies (0001) — this trigger is the one sanctioned
-- path around that default-deny, by design.
--
-- Reads new.raw_user_meta_data->>'username' and ->>'birth_year' (the
-- signup metadata contract: supabase.auth.signUp({ options: { data: {
-- username, birth_year } } })). birth_year arrives as a JSON string. It is
-- FAIL-CLOSED: a genuinely absent/empty birth_year proceeds as NULL, but a
-- birth_year that is PRESENT yet does not parse to an integer aborts the
-- signup (RAISE) rather than degrading to NULL — otherwise a non-integer
-- like "2013.5" would silently skip the under-13 gate (review F1, D-009).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw_birth_year text;
  v_birth_year      int;
  v_username        text;
  v_placeholder     text;
begin
  -- ── under-13 gate: FIRST, OUTSIDE any exception handler ──────────────────
  -- Must propagate uncaught so it aborts the whole GoTrue signup transaction
  -- (ARCHITECTURE §8.1: the attempt itself is not stored — no auth.users row
  -- persists). Threshold is current_year - birth_year < 14 (D-008 §2 — the
  -- 14-target rule, NOT < 13: birth-year-only data can't resolve exact age,
  -- so < 13 would admit some actual 12-year-olds born in the boundary year;
  -- < 14 guarantees zero under-13 storage). F1's client gate mirrors this
  -- exact expression so a client-passed signup is never server-rejected.
  v_raw_birth_year := new.raw_user_meta_data->>'birth_year';

  -- FAIL CLOSED (review F1 / D-009): a present-but-unparseable birth_year
  -- (e.g. "2013.5", "2013abc", "0x7DD", "2_013", a JSON boolean) must NOT be
  -- swallowed to NULL — that would skip the under-13 gate below and admit the
  -- account. Only a genuinely absent/empty birth_year proceeds as NULL. The
  -- RAISE here is outside the username-collision handler further down, so it
  -- propagates and aborts the whole signup (nothing persists).
  if v_raw_birth_year is not null and length(trim(v_raw_birth_year)) > 0 then
    begin
      v_birth_year := v_raw_birth_year::int;
    exception when others then
      raise exception 'signup rejected: birth_year present but not a valid integer (%)', v_raw_birth_year;
    end;
  else
    v_birth_year := null;
  end if;

  if v_birth_year is not null and (extract(year from now())::int - v_birth_year) < 14 then
    raise exception 'signup rejected: under-13 (year-only age gate, D-008 §2)';
  end if;

  -- Sanitize birth_year against profiles' own CHECK (1900-2100, 0001) so a
  -- malformed-but-numeric value (e.g. "31") can never make either insert
  -- below fail; it degrades to NULL, same as "no birth year supplied". Any
  -- birth_year that survives this point already cleared the under-13 gate
  -- above, so it is either NULL or a valid (>=13, in fact >=14) year — the
  -- "keep a valid >=13 birth_year else NULL" fallback-path requirement.
  if v_birth_year is not null and (v_birth_year < 1900 or v_birth_year > 2100) then
    v_birth_year := null;
  end if;

  -- ── happy path ────────────────────────────────────────────────────────────
  v_username := new.raw_user_meta_data->>'username';
  -- null / whitespace-only / out-of-length -> fallback path. A whitespace-only
  -- name (e.g. "   ") is effectively blank and must NOT be stored as a real
  -- username (review F3 / D-009). Non-empty usernames are NOT trimmed or
  -- normalized otherwise — the freeze is case-sensitive EXACT match (D-008 §1),
  -- so " alice " stays distinct from "alice" and username_available stays byte-exact.
  if v_username is null
     or length(trim(v_username)) = 0
     or char_length(v_username) < 3
     or char_length(v_username) > 20 then
    v_username := null;
  end if;

  if v_username is not null then
    begin
      insert into public.profiles (id, username, birth_year)
      values (new.id, v_username, v_birth_year)
      on conflict (id) do nothing;
    exception when unique_violation then
      v_username := null;  -- taken -> fall through to the placeholder path
    end;
  end if;

  -- ── fallback path ─────────────────────────────────────────────────────────
  -- Reached on a NULL/blank/invalid-length username, or a unique_violation
  -- on insert (collision). Never strand the auth row ([r3]/[N7]): always
  -- insert a profiles row, with a placeholder username guaranteed to fit
  -- the 3-20 CHECK (id uniqueness makes it effectively unique), and flag
  -- needs_profile_completion so the client prompts for a real one. A2 only
  -- ever SETS this true; clearing it is A3's column-restriction trigger.
  if v_username is null then
    begin
      v_placeholder := left('user_' || replace(new.id::text, '-', ''), 20);
      insert into public.profiles (id, username, birth_year, needs_profile_completion)
      values (new.id, v_placeholder, v_birth_year, true)
      on conflict (id) do nothing;
    exception when unique_violation then
      -- The placeholder derives from only the first 15 hex of new.id (60 bits),
      -- so a pre-squatted matching placeholder could collide on the username
      -- UNIQUE index (astronomically unlikely, but review F2: it must not strand
      -- the auth row). Retry once with fresh, independent entropy.
      v_placeholder := left('user_' || replace(gen_random_uuid()::text, '-', ''), 20);
      insert into public.profiles (id, username, birth_year, needs_profile_completion)
      values (new.id, v_placeholder, v_birth_year, true)
      on conflict (id) do nothing;
    end;
  end if;

  -- ── progress row: always, regardless of which path above ran ────────────
  insert into public.progress (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;

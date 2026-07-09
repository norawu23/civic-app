-- 0003_policies.sql
-- CIVIC — RLS policy suite + profiles column-restriction trigger (A3).
--
-- Ownership (D-005 §1): this migration is owned exclusively by chunk A3. It
-- converts 0001's default-deny (RLS enabled, zero policies) tables into the
-- ARCHITECTURE §2.3 access matrix, and adds the BEFORE UPDATE trigger on
-- profiles that restricts which columns a client can write ([N9]).
--
-- Depends on: 0001_schema.sql (the eight tables + RLS-enabled/zero-policy
-- state). Does NOT depend on 0002 (A2's auth trigger / username_available) —
-- nothing here references anything A2 owns, so this applies cleanly on top
-- of 0001 alone (rehearsed that way; see tests/rls/).
--
-- Explicitly OUT of this file (owned by other chunks — do not add here):
--   * the auth trigger / username_available                     (A2, 0002)
--   * any RPC (complete_*, nuance, import, log_event,
--     delete_account, submit_nuance_session, ...)                (WS-B)
--   * P1/P2 table policies                                       (ship with features)
--   * client screens / admin SQL views
--
-- Source of truth: docs/specs/A3-rls-column-restriction.md (frozen contract)
-- and ARCHITECTURE.md §2.3 (RLS matrix), §3.1 (grading threat model), §8.2
-- (admin visibility); D-008 §4/§5 (ratified 2026-07-07, incorporated into
-- the Jul 10 freeze).

begin;

-- ── public.is_admin() ───────────────────────────────────────────────────────
-- SECURITY DEFINER is load-bearing: it reads profiles past RLS so the
-- admin-SELECT policies below don't recurse (a non-SECURITY-DEFINER version
-- would re-invoke the profiles SELECT policies, which call is_admin() again,
-- infinitely). STABLE because it only reads within the current statement's
-- snapshot. search_path is pinned for defense-in-depth on a SECURITY DEFINER
-- function (not part of the frozen signature, does not change behavior).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where id = auth.uid() and is_admin
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- authenticated SELECT own; authenticated UPDATE own (column limits enforced
-- by the trigger below, not this policy); admin SELECT all. No INSERT policy
-- (row creation is trigger-only, A2's on_auth_user_created). No anon.

create policy profiles_select_own on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select
  to authenticated
  using (public.is_admin());

-- ── progress ─────────────────────────────────────────────────────────────────
-- authenticated SELECT own; admin SELECT all. No INSERT/UPDATE/DELETE policy
-- at all — RPC-only writes (SECURITY DEFINER RPCs bypass RLS). No anon.

create policy progress_select_own on public.progress
  for select
  to authenticated
  using (id = auth.uid());

create policy progress_select_admin on public.progress
  for select
  to authenticated
  using (public.is_admin());

-- ── evolved_takes ────────────────────────────────────────────────────────────
-- authenticated SELECT own; admin SELECT all. No INSERT policy → RPC-only.
-- No anon.

create policy evolved_takes_select_own on public.evolved_takes
  for select
  to authenticated
  using (user_id = auth.uid());

create policy evolved_takes_select_admin on public.evolved_takes
  for select
  to authenticated
  using (public.is_admin());

-- ── nuance_sessions ──────────────────────────────────────────────────────────
-- authenticated SELECT own; admin SELECT all. No INSERT policy → RPC-only
-- (anon baseline enters via the SECURITY DEFINER RPC, not a client INSERT).
-- No anon.

create policy nuance_sessions_select_own on public.nuance_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy nuance_sessions_select_admin on public.nuance_sessions
  for select
  to authenticated
  using (public.is_admin());

-- ── events ───────────────────────────────────────────────────────────────────
-- admin SELECT all (funnel views, G1). No client SELECT/INSERT — log_event
-- RPC only.

create policy events_select_admin on public.events
  for select
  to authenticated
  using (public.is_admin());

-- ── xp_awards, quiz_answer_keys, topics_catalog: intentional default-deny ────
-- No policies are created for these three tables. This is a DELIBERATE
-- decision (ARCHITECTURE §2.3 freeze ruling; D-008 §4), not an omission —
-- do NOT "fix" this by adding SELECT policies:
--   * xp_awards         — read by RPCs via SECURITY DEFINER; the client gets
--                          XP values back in RPC return payloads, never by
--                          direct SELECT.
--   * quiz_answer_keys  — grading secret (§3.1); server-only, never
--                          client-readable under any circumstance.
--   * topics_catalog    — the client uses src/data/registry.js (D-005 §3)
--                          for unlock order; RPCs read the catalog
--                          server-side.
-- RLS is already enabled on all three from 0001, with zero policies, so this
-- default-deny holds for both anon and authenticated.

-- ── base table privileges for `authenticated` ────────────────────────────────
-- The RLS policies above filter WHICH rows the authenticated role may see or
-- update, but a policy grants nothing on its own: Postgres first requires the
-- base table privilege to exist, then RLS narrows it. Without these GRANTs the
-- select-own / update-own policies are dead letters — every client read of its
-- own profile fails "permission denied for table profiles" (the real Supabase
-- stack does NOT auto-grant migration-created tables; D-018).
--
-- SELECT for every table that has a `to authenticated` SELECT policy above
-- (own-row and admin policies both run as the authenticated role); UPDATE only
-- on profiles (the sole client-writable table — the column-restriction trigger
-- below further limits which columns). All other writes go through
-- SECURITY DEFINER RPCs, which run as owner and need no caller grant, so no
-- INSERT/DELETE is granted to authenticated anywhere.
--
-- `anon` receives NOTHING (all anonymous interaction is via SECURITY DEFINER
-- RPCs). The three reference tables (xp_awards, quiz_answer_keys,
-- topics_catalog) are deliberately excluded — they stay default-deny (D-008 §4).
-- nuance_sessions is granted full SELECT here; B4's masking migration (0007)
-- replaces it with a column-scoped grant excluding score/elapsed_days
-- (D-011 §2 / D-012 §9) — until B4 lands, no score is displayed anywhere.
grant select on
  public.profiles,
  public.progress,
  public.evolved_takes,
  public.nuance_sessions,
  public.events
  to authenticated;
grant update on public.profiles to authenticated;

-- ── profiles column-restriction trigger ([N9]) ────────────────────────────────
-- BEFORE UPDATE ON public.profiles: restricts which columns a client update
-- can actually change, independent of (and in addition to) the RLS UPDATE
-- policy above, which only gates *which row* — not which columns.
--   * username, avatar_id            — writable (pass through unchanged)
--   * birth_year                     — settable only while currently NULL;
--                                       once set it is immutable via client
--                                       update (age can't be falsified later)
--   * is_admin, id, created_at       — forced to OLD; never client-writable.
--                                       The is_admin pin is the
--                                       privilege-escalation guard — the
--                                       single most important assertion in
--                                       the adversarial review.
--   * needs_profile_completion       — derived, never directly
--                                       client-writable (D-008 §5): the
--                                       first username change on a flagged
--                                       account clears it; otherwise pinned
--                                       to OLD. Deliberately does NOT
--                                       pattern-match the `user_%`
--                                       placeholder — a user who legitimately
--                                       picks a user_-prefixed name must
--                                       still get un-flagged. This is the
--                                       only place the flag is cleared; no
--                                       complete_profile RPC exists.
create function public.restrict_profile_update()
returns trigger
language plpgsql
-- search_path pinned for consistency with is_admin() and defense-in-depth
-- (review nit). The body does only NEW/OLD field assignment with no schema-
-- qualified lookups, so this is belt-and-suspenders, not a live vector.
set search_path = ''
as $$
begin
  -- Never client-writable, no exceptions.
  new.id := old.id;
  new.created_at := old.created_at;
  new.is_admin := old.is_admin;

  -- birth_year: settable only while currently NULL.
  if old.birth_year is not null then
    new.birth_year := old.birth_year;
  end if;

  -- needs_profile_completion: derived from the username change, not
  -- directly settable in either direction.
  if old.needs_profile_completion and new.username <> old.username then
    new.needs_profile_completion := false;
  else
    new.needs_profile_completion := old.needs_profile_completion;
  end if;

  return new;
end;
$$;

create trigger profiles_restrict_update
  before update on public.profiles
  for each row
  execute function public.restrict_profile_update();

commit;

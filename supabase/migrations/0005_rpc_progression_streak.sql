-- 0005_rpc_progression_streak.sql
-- CIVIC — Progression + streak RPCs (B2).
--
-- Ownership (D-005 §1, D-012 §8): this migration is owned exclusively by
-- chunk B2. No other chunk may touch it; B2 may not touch 0001–0004 or
-- 0006–0008, RLS policies, xp_awards content, or B1's unlock logic.
--
-- Contents:
--   * complete_level2(topic_id text)        → S1 {snapshot, xp_awarded}
--   * complete_level3_cards(topic_id text)  → S1 {snapshot, xp_awarded}
--   * check_streak(tz_offset_minutes int)   → S1 {snapshot, xp_awarded: 0,
--                                                  streak_event, freeze_awarded}
--
-- Consumes B1's 0004 frozen helpers (progress_snapshot / topic_unlocked /
-- xp_for) as-is — never redefined or vendored here.
--
-- Source of truth: docs/specs/B2-progression-streak.md (frozen chunk spec,
-- normative transition table); docs/specs/WS-B-signatures.md (FROZEN
-- contract, D-010/D-011); D-001 (server-time streak, stored tz offset);
-- D-012 §2 (zero XP for L2/L3-cards), §3 (offset sign convention + date-math
-- formula).
--
-- Error convention (contract §6): raise exception using
-- message = '<snake_case_code>' — exactly one code token, no interpolated
-- values in message; detail carries context, never user content.
--
-- Grant-wall convention: revoke PUBLIC (+ anon, authenticated explicitly)
-- execute on every function here, then grant exactly the contract-listed
-- audience (authenticated for all three RPCs in this file).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.complete_level2 — flag-only, zero XP (D-012 §2)
-- ═══════════════════════════════════════════════════════════════════════════
-- S1 { snapshot, xp_awarded: 0 always }. Check order mirrors B1's
-- complete_flashcards: auth guard → param types → unknown_topic → lock row
-- → locked_topic → replay check → write. Sets
-- topics.<topic_id>.levels.'2'.flashcardsComplete = true (sparse write,
-- creating keys as needed — D-012 §1: flashcardsComplete = "card/reading
-- portion done" on every level). currentLevel is NOT touched (legacy parity
-- — only quiz completions move it, B1). No xp_awards row exists for this
-- action and none is added; xp_awarded is constantly 0, first completion
-- included. Idempotent: flag already true → snapshot + xp_awarded 0, NO
-- writes (lost-ack retries never error, contract §1.4).

create function public.complete_level2(topic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid;
  v_topics    jsonb;
  v_topic     jsonb;
  v_levels    jsonb;
  v_level_obj jsonb;
begin
  -- 1. auth guard (defensive-only, D-011: the grant wall normally fires first)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 2. param types / domains
  if topic_id is null or length(topic_id) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'topic_id must be non-empty text';
  end if;

  -- 3. unknown_topic
  if not exists (select 1
                   from public.topics_catalog tc
                  where tc.topic_id = complete_level2.topic_id) then
    raise exception using
      message = 'unknown_topic',
      detail  = 'topic_id is not present in topics_catalog';
  end if;

  -- Lock the caller's progress row for the rest of the transaction (a
  -- concurrent duplicate call serializes here and lands on the replay path).
  select p.topics
    into strict v_topics
    from public.progress p
   where p.id = v_user
     for update;

  -- 4. locked_topic
  if not public.topic_unlocked(v_topics, topic_id) then
    raise exception using
      message = 'locked_topic',
      detail  = 'topic is not yet unlocked for this user';
  end if;

  -- 5. replay: already complete → success, xp_awarded 0, NO writes
  if coalesce(v_topics -> topic_id -> 'levels' -> '2' ->> 'flashcardsComplete', 'false') = 'true' then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0
    );
  end if;

  -- 6. first completion: set the flag (sparse write); XP always 0 (D-012 §2)
  v_topic     := coalesce(v_topics -> topic_id, '{}'::jsonb);
  v_levels    := coalesce(v_topic -> 'levels', '{}'::jsonb);
  v_level_obj := coalesce(v_levels -> '2', '{}'::jsonb)
                 || jsonb_build_object('flashcardsComplete', true);
  v_levels    := v_levels || jsonb_build_object('2', v_level_obj);
  v_topic     := v_topic  || jsonb_build_object('levels', v_levels);
  v_topics    := v_topics || jsonb_build_object(topic_id, v_topic);

  update public.progress p
     set topics     = v_topics,
         updated_at = now()
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', 0
  );
end;
$$;

revoke execute on function public.complete_level2(text) from public, anon, authenticated;
grant execute on function public.complete_level2(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.complete_level3_cards — flag-only, zero XP (D-012 §2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Identical shape to complete_level2, targeting levels.'3'.flashcardsComplete
-- (the L3 card/reading portion — distinct from L3's quiz, which is graded by
-- B1's complete_quiz and lives under the same levels.'3' object; this
-- function only ever touches the flashcardsComplete key, never quizComplete/
-- quizScore/currentLevel, so it cannot clobber B1's writes on the same
-- level — jsonb `||` merge at the level-object layer preserves sibling keys).

create function public.complete_level3_cards(topic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid;
  v_topics    jsonb;
  v_topic     jsonb;
  v_levels    jsonb;
  v_level_obj jsonb;
begin
  -- 1. auth guard (defensive-only, D-011)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 2. param types / domains
  if topic_id is null or length(topic_id) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'topic_id must be non-empty text';
  end if;

  -- 3. unknown_topic
  if not exists (select 1
                   from public.topics_catalog tc
                  where tc.topic_id = complete_level3_cards.topic_id) then
    raise exception using
      message = 'unknown_topic',
      detail  = 'topic_id is not present in topics_catalog';
  end if;

  select p.topics
    into strict v_topics
    from public.progress p
   where p.id = v_user
     for update;

  -- 4. locked_topic
  if not public.topic_unlocked(v_topics, topic_id) then
    raise exception using
      message = 'locked_topic',
      detail  = 'topic is not yet unlocked for this user';
  end if;

  -- 5. replay: already complete → success, xp_awarded 0, NO writes
  if coalesce(v_topics -> topic_id -> 'levels' -> '3' ->> 'flashcardsComplete', 'false') = 'true' then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0
    );
  end if;

  -- 6. first completion: set the flag (sparse write); XP always 0 (D-012 §2)
  v_topic     := coalesce(v_topics -> topic_id, '{}'::jsonb);
  v_levels    := coalesce(v_topic -> 'levels', '{}'::jsonb);
  v_level_obj := coalesce(v_levels -> '3', '{}'::jsonb)
                 || jsonb_build_object('flashcardsComplete', true);
  v_levels    := v_levels || jsonb_build_object('3', v_level_obj);
  v_topic     := v_topic  || jsonb_build_object('levels', v_levels);
  v_topics    := v_topics || jsonb_build_object(topic_id, v_topic);

  update public.progress p
     set topics     = v_topics,
         updated_at = now()
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', 0
  );
end;
$$;

revoke execute on function public.complete_level3_cards(text) from public, anon, authenticated;
grant execute on function public.complete_level3_cards(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.check_streak — the integrity-critical RPC (D-001)
-- ═══════════════════════════════════════════════════════════════════════════
-- S1 { snapshot, xp_awarded: 0, streak_event, freeze_awarded }. Server-time-
-- only day boundary: the device clock is NEVER an input. On every call:
--   1. auth guard.
--   2. tz_offset_minutes must be non-null (invalid_params otherwise — a null
--      offset cannot be clamped and the column is NOT NULL; this mirrors
--      B1's explicit null-param convention, not a spec-cited requirement —
--      see the builder's escalation note on this point).
--   3. clamp to [-840, 840] — out-of-range is NEVER an error (contract §6
--      "Not errors").
--   4. lock the caller's progress row.
--   5. compute user-local "today" EXPLICITLY in UTC (D-012 §3):
--       ((now() at time zone 'utc') + make_interval(mins => v_offset))::date
--     — the session TimeZone GUC can never affect this.
--   6. apply the transition table (spec's normative table, rows 1–5 +
--      milestone rule) to decide streak/last_login_date/streak_freezes/
--      streak_freeze_awarded_at/streak_event/freeze_awarded.
--   7. ALWAYS persist tz_offset_minutes + updated_at (even on a same_day
--      no-op — DoD: "offset is clamped and persisted on every call").
--
-- Row 2 (gap <= 0 → same_day, no-op) is the security-load-bearing line: it
-- never decrements streak and never moves last_login_date backwards, so no
-- single offset choice on a single call can resurrect a lapsed day measured
-- against that call's own vantage point. See the builder's escalation note
-- (final report) on a related multi-call offset-switching property this
-- spec's transition table does not itself guard against — implemented here
-- exactly as written, per instructions not to silently patch the frozen
-- table.

create function public.check_streak(tz_offset_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user            uuid;
  v_offset          int;
  v_today           date;
  v_last            date;
  v_streak          int;
  v_freezes         int;
  v_awarded_at      date;
  v_new_streak      int;
  v_new_last        date;
  v_new_freezes     int;
  v_new_awarded_at  date;
  v_gap             int;
  v_event           text;
  v_freeze_awarded  boolean := false;
begin
  -- 1. auth guard (defensive-only, D-011)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 2. offset must be present to clamp/persist into a NOT NULL column.
  if tz_offset_minutes is null then
    raise exception using
      message = 'invalid_params',
      detail  = 'tz_offset_minutes must be a non-null int';
  end if;

  -- 3. clamp to ±840 — out-of-range is never an error (contract §6).
  v_offset := greatest(-840, least(840, tz_offset_minutes));

  -- Lock the caller's progress row for the rest of the transaction.
  select p.last_login_date, p.streak, p.streak_freezes, p.streak_freeze_awarded_at
    into strict v_last, v_streak, v_freezes, v_awarded_at
    from public.progress p
   where p.id = v_user
     for update;

  -- 5. user-local "today", computed explicitly in UTC (D-012 §3) — the
  --    session TimeZone GUC can never matter.
  v_today := ((now() at time zone 'utc') + make_interval(mins => v_offset))::date;

  -- Defaults: no-op unless a row below changes them.
  v_new_streak     := v_streak;
  v_new_last       := v_last;
  v_new_freezes    := v_freezes;
  v_new_awarded_at := v_awarded_at;

  -- 6. transition table (spec's normative table — rows 1–5 + milestone rule)
  if v_last is null then
    -- Row 1: fresh user.
    v_new_streak := 1;
    v_new_last   := v_today;
    v_event      := 'started';
  else
    v_gap := v_today - v_last;

    if v_gap <= 0 then
      -- Row 2: same local day, or an offset shift moved today backwards.
      -- Never decrement, never move last_login_date backwards. No-op.
      v_event := 'same_day';

    elsif v_gap = 1 then
      -- Row 3: consecutive day.
      v_new_streak := v_streak + 1;
      v_new_last   := v_today;
      v_event      := 'extended';

      -- Milestone rule (evaluated after the increment).
      if v_new_streak % 7 = 0
         and v_new_freezes = 0
         and (v_awarded_at is null or v_awarded_at <= v_today - 28) then
        v_new_freezes    := 1;
        v_new_awarded_at := v_today;
        v_freeze_awarded := true;
      end if;

    elsif v_gap = 2 and v_freezes = 1 then
      -- Row 4: one missed day, covered by exactly one freeze.
      v_new_freezes := 0;
      v_new_streak  := v_streak + 1;
      v_new_last    := v_today;
      v_event       := 'freeze_spent';

      -- Milestone rule (evaluated after the increment, post-spend).
      if v_new_streak % 7 = 0
         and v_new_freezes = 0
         and (v_awarded_at is null or v_awarded_at <= v_today - 28) then
        v_new_freezes    := 1;
        v_new_awarded_at := v_today;
        v_freeze_awarded := true;
      end if;

    else
      -- Row 5: anything else (gap >= 2, uncovered). An unspent freeze is
      -- kept, not consumed — it can't cover >= 2 missed days.
      v_new_streak := 1;
      v_new_last   := v_today;
      v_event      := 'reset';
    end if;
  end if;

  -- 7. persist — offset + updated_at ALWAYS, even on a same_day no-op.
  update public.progress p
     set tz_offset_minutes        = v_offset,
         updated_at               = now(),
         streak                   = v_new_streak,
         last_login_date          = v_new_last,
         streak_freezes           = v_new_freezes,
         streak_freeze_awarded_at = v_new_awarded_at
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',       public.progress_snapshot(v_user),
    'xp_awarded',     0,
    'streak_event',   v_event,
    'freeze_awarded', v_freeze_awarded
  );
end;
$$;

revoke execute on function public.check_streak(int) from public, anon, authenticated;
grant execute on function public.check_streak(int) to authenticated;

commit;

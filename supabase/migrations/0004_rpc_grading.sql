-- 0004_rpc_grading.sql
-- CIVIC — L1 grading RPCs + the shared WS-B internal helpers (B1).
--
-- Ownership (D-005 §1): this migration is owned exclusively by chunk B1.
-- No other chunk may touch it; B1 may not touch 0001–0003 or 0005–0008.
--
-- Contents:
--   * three shared internal helpers, frozen by the B1 spec (D-012 §8):
--       progress_snapshot(uuid) / topic_unlocked(jsonb, text) / xp_for(text)
--     B2/B3/B5 call these and must not redefine them. Execute is revoked
--     from public/anon/authenticated — they are server-internal; RPC bodies
--     run as owner (SECURITY DEFINER) and are unaffected by the revoke.
--   * complete_flashcards(topic_id text, level int)        → S1
--   * complete_quiz(topic_id text, level int, answers int[]) → S1 + n_correct
--
-- Explicitly OUT of this file (owned by other chunks — do not add here):
--   * complete_level2 / complete_level3_cards / check_streak   (B2, 0005)
--   * OB, nuance, import, events, deletion RPCs                (B3–B5)
--   * any RLS policy / 0001–0003 change
--   * quiz_answer_keys / topics_catalog CONTENT                (H1 seeds it)
--
-- Source of truth: docs/specs/B1-l1-grading.md (frozen chunk spec);
-- docs/specs/WS-B-signatures.md (FROZEN contract, D-010/D-011); D-012 §1
-- (sparse flag-map semantics, unlocked predicate, unlock-on-L3-quiz,
-- currentLevel parity) and §8 (helper trio lives here).
--
-- Error convention (contract §6): raise exception using
-- message = '<snake_case_code>' — exactly one code token, no interpolated
-- values in message; detail carries context, never user content.
--
-- Grant-wall convention (spec "Interfaces exposed"): revoke PUBLIC execute
-- on every function here, then grant exactly the contract-listed audience.
-- The revokes also name anon/authenticated explicitly: on the real Supabase
-- stack, ALTER DEFAULT PRIVILEGES grants execute on new functions to the
-- client roles at creation time, so revoking only PUBLIC would leave those
-- direct grants standing. Naming the roles is a no-op on plain Postgres and
-- closes the gap on Supabase — strictly tightening, no audience change.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- Shared internal helpers (frozen signatures — D-012 §8)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── public.xp_for ────────────────────────────────────────────────────────────
-- XP lookup against the xp_awards reference table (single source of truth,
-- D-005 §2). RAISES on a missing action — a missing action is an integrity
-- bug, never a silent 0. The raised token is NOT a contract §6 registry code
-- (registry additions are decisions.md events): it is an unexpected internal
-- that bubbles raw and maps to `internal` client-side, per §6.

create function public.xp_for(p_action text)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_xp int;
begin
  select xp into v_xp from public.xp_awards where action = p_action;
  if not found then
    raise exception using
      message = 'missing_xp_award_action',
      detail  = format('xp_awards has no row for action %L — reference-data integrity bug (D-005 §2)', p_action);
  end if;
  return v_xp;
end;
$$;

revoke execute on function public.xp_for(text) from public, anon, authenticated;

-- ── public.topic_unlocked ────────────────────────────────────────────────────
-- The D-012 §1 unlock predicate: a topic is unlocked iff its
-- topics_catalog.position = 0 (first registry topic — always unlocked) OR
-- topics -> topic_id ->> 'unlocked' = 'true'. Assumes the topic exists in
-- topics_catalog (callers raise unknown_topic first).

create function public.topic_unlocked(p_topics jsonb, p_topic_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select tc.position = 0
              from public.topics_catalog tc
             where tc.topic_id = p_topic_id),
           false)
      or coalesce(p_topics -> p_topic_id ->> 'unlocked', 'false') = 'true';
$$;

revoke execute on function public.topic_unlocked(jsonb, text) from public, anon, authenticated;

-- ── public.progress_snapshot ─────────────────────────────────────────────────
-- The contract §2 shape, exactly: total_xp, streak, streak_freezes,
-- last_login_date ('YYYY-MM-DD' or null), tz_offset_minutes, topics,
-- opinion_builders, schema_version, updated_at (ISO 8601). Built from the
-- caller's progress row; never includes id / streak_freeze_awarded_at /
-- imported_from_guest. STRICT select: a missing progress row is an
-- integrity bug (A2's trigger creates one per user) and bubbles raw.
--
-- jsonb encoding does the §2 string formats for free: a `date` renders as
-- "YYYY-MM-DD" (or JSON null), a `timestamptz` as ISO 8601 with offset.

create function public.progress_snapshot(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  select jsonb_build_object(
           'total_xp',          p.total_xp,
           'streak',            p.streak,
           'streak_freezes',    p.streak_freezes,
           'last_login_date',   p.last_login_date,
           'tz_offset_minutes', p.tz_offset_minutes,
           'topics',            p.topics,
           'opinion_builders',  p.opinion_builders,
           'schema_version',    p.schema_version,
           'updated_at',        p.updated_at
         )
    into strict v_snapshot
    from public.progress p
   where p.id = p_user;
  return v_snapshot;
end;
$$;

revoke execute on function public.progress_snapshot(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs (frozen signatures — WS-B-signatures.md §4/B1, §5)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── public.complete_flashcards ───────────────────────────────────────────────
-- S1 { snapshot, xp_awarded }. Check order per the B1 spec behavior pins:
-- auth guard → param types → unknown_topic → locked_topic → replay check →
-- write (flag + XP + updated_at), one transaction. `level` must be a
-- flashcard-bearing level per the content catalog — P0: 1 only.
-- Replay (flashcardsComplete already true) is a success with xp_awarded: 0
-- and NO writes (contract §1.4 — lost-ack retries must not error).
-- Writes are sparse (D-012 §1): only the keys being set are created.

create function public.complete_flashcards(topic_id text, level int)
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
  v_xp        int;
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
  if level is distinct from 1 then
    raise exception using
      message = 'invalid_params',
      detail  = 'level must be a flashcard-bearing level per the content catalog (P0: 1 only)';
  end if;

  -- 3. unknown_topic
  if not exists (select 1
                   from public.topics_catalog tc
                  where tc.topic_id = complete_flashcards.topic_id) then
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
  if coalesce(v_topics -> topic_id -> 'levels' -> '1' ->> 'flashcardsComplete', 'false') = 'true' then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0
    );
  end if;

  -- 6. first completion: set the flag (sparse write), award XP, touch updated_at
  v_xp        := public.xp_for('flashcards');
  v_topic     := coalesce(v_topics -> topic_id, '{}'::jsonb);
  v_levels    := coalesce(v_topic -> 'levels', '{}'::jsonb);
  v_level_obj := coalesce(v_levels -> '1', '{}'::jsonb)
                 || jsonb_build_object('flashcardsComplete', true);
  v_levels    := v_levels || jsonb_build_object('1', v_level_obj);
  v_topic     := v_topic  || jsonb_build_object('levels', v_levels);
  v_topics    := v_topics || jsonb_build_object(topic_id, v_topic);

  update public.progress p
     set topics     = v_topics,
         total_xp   = p.total_xp + v_xp,
         updated_at = now()
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', v_xp
  );
end;
$$;

revoke execute on function public.complete_flashcards(text, int) from public, anon;
grant execute on function public.complete_flashcards(text, int) to authenticated;

-- ── public.complete_quiz ─────────────────────────────────────────────────────
-- S1 { snapshot, xp_awarded, n_correct }. Grades ALL quiz levels (P0: 1 and
-- 3; D-001 — there is no complete_level3_quiz). Check order per the B1 spec
-- behavior pins: auth guard → answers is a non-null, non-empty int[]
-- (invalid_params) → unknown_topic → locked_topic → key lookup (no row →
-- invalid_params: level outside the frozen domain for this topic) → length
-- mismatch → invalid_answers → element outside 0..3 → invalid_answers →
-- grade.
--
-- Replay (quizComplete already true): re-grade the submitted vector, return
-- fresh n_correct with xp_awarded 0, write NOTHING — stored quizScore is
-- never overwritten, no unlock re-fires.
--
-- First completion, one transaction: quizComplete = true, quizScore =
-- n_correct; XP = xp_for('quiz') + xp_for('quiz_perfect_bonus') iff
-- n_correct = key length. Level-transition parity with the legacy client
-- (D-012 §1): level 1 → currentLevel := 2; level 3 → currentLevel := 3 AND
-- unlock the next topic in topics_catalog.position order (unlocked: true,
-- currentLevel: 1 merged into that topic's entry; no-op if already unlocked
-- or this is the last topic).
--
-- No per-question correctness vector is ever returned (contract §4/B1).

create function public.complete_quiz(topic_id text, level int, answers int[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid;
  v_key       int[];
  v_topics    jsonb;
  v_topic     jsonb;
  v_levels    jsonb;
  v_level_obj jsonb;
  v_level_key text;
  v_n_correct int;
  v_xp        int;
  v_position  int;
  v_next      text;
begin
  -- 1. auth guard (defensive-only, D-011)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 2. answers must be a non-null, non-empty int[]
  if answers is null or coalesce(cardinality(answers), 0) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'answers must be a non-null, non-empty int[]';
  end if;
  if topic_id is null or length(topic_id) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'topic_id must be non-empty text';
  end if;

  -- 3. unknown_topic
  if not exists (select 1
                   from public.topics_catalog tc
                  where tc.topic_id = complete_quiz.topic_id) then
    raise exception using
      message = 'unknown_topic',
      detail  = 'topic_id is not present in topics_catalog';
  end if;

  -- Lock the caller's progress row for the rest of the transaction.
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

  -- 5. key lookup: no row → level outside the frozen domain for this topic
  select k.answers
    into v_key
    from public.quiz_answer_keys k
   where k.topic_id = complete_quiz.topic_id
     and k.level    = complete_quiz.level;
  if v_key is null then
    raise exception using
      message = 'invalid_params',
      detail  = 'no answer key exists for this (topic, level) — level outside the frozen quiz domain for this topic';
  end if;

  -- 6. content/length validation of a well-formed vector → invalid_answers
  if cardinality(answers) <> cardinality(v_key) then
    raise exception using
      message = 'invalid_answers',
      detail  = 'answers length does not match the answer-key length';
  end if;
  if exists (select 1 from unnest(answers) a where a is null or a < 0 or a > 3) then
    raise exception using
      message = 'invalid_answers',
      detail  = 'every answers element must be an int in 0..3';
  end if;

  -- 7. grade
  select count(*)::int
    into v_n_correct
    from unnest(answers, v_key) as t(a, k)
   where t.a = t.k;

  v_level_key := level::text;

  -- 8. replay: quizComplete already true → fresh n_correct, xp 0, NO writes
  --    (stored quizScore never overwritten, no unlock re-fires)
  if coalesce(v_topics -> topic_id -> 'levels' -> v_level_key ->> 'quizComplete', 'false') = 'true' then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0,
      'n_correct',  v_n_correct
    );
  end if;

  -- 9. first completion: flags + XP (+ perfect bonus at exactly key length)
  v_xp := public.xp_for('quiz');
  if v_n_correct = cardinality(v_key) then
    v_xp := v_xp + public.xp_for('quiz_perfect_bonus');
  end if;

  v_topic     := coalesce(v_topics -> topic_id, '{}'::jsonb);
  v_levels    := coalesce(v_topic -> 'levels', '{}'::jsonb);
  v_level_obj := coalesce(v_levels -> v_level_key, '{}'::jsonb)
                 || jsonb_build_object('quizComplete', true, 'quizScore', v_n_correct);
  v_levels    := v_levels || jsonb_build_object(v_level_key, v_level_obj);
  v_topic     := v_topic  || jsonb_build_object('levels', v_levels);

  -- Level-transition parity with the legacy client (D-012 §1).
  if level = 1 then
    v_topic := v_topic || jsonb_build_object('currentLevel', 2);
  elsif level = 3 then
    v_topic := v_topic || jsonb_build_object('currentLevel', 3);
  end if;

  v_topics := v_topics || jsonb_build_object(topic_id, v_topic);

  -- 10. L3-quiz completion unlocks the next topic in position order
  --     (no-op if already unlocked or this is the last topic).
  if level = 3 then
    select tc.position
      into v_position
      from public.topics_catalog tc
     where tc.topic_id = complete_quiz.topic_id;

    select tc.topic_id
      into v_next
      from public.topics_catalog tc
     where tc.position > v_position
     order by tc.position asc
     limit 1;

    if v_next is not null and not public.topic_unlocked(v_topics, v_next) then
      v_topics := v_topics || jsonb_build_object(
        v_next,
        coalesce(v_topics -> v_next, '{}'::jsonb)
          || jsonb_build_object('unlocked', true, 'currentLevel', 1)
      );
    end if;
  end if;

  update public.progress p
     set topics     = v_topics,
         total_xp   = p.total_xp + v_xp,
         updated_at = now()
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', v_xp,
    'n_correct',  v_n_correct
  );
end;
$$;

revoke execute on function public.complete_quiz(text, int, int[]) from public, anon;
grant execute on function public.complete_quiz(text, int, int[]) to authenticated;

commit;

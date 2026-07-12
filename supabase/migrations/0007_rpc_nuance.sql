-- 0007_rpc_nuance.sql
-- CIVIC — nuance RPCs + server-side rubric scoring + rate limits + the
-- nuance_sessions column-grant masking migration (B4).
--
-- Ownership (D-005 §1, D-012 §8): this migration is owned exclusively by
-- chunk B4. Contents, in the order pinned by docs/specs/B4-nuance-rpcs.md:
--   1. pg_trgm install (extensions schema, D-012 §9)
--   2. internal scoring function nuance_score(jsonb) (execute revoked)
--   3. parameter-slot functions nuance_trgm_threshold() /
--      nuance_rate_limit_per_hour() (D-012 §9)
--   4. nuance_rate_limits table (RLS on, zero policies, server-internal)
--   5. the three RPCs: submit_nuance_session [authenticated],
--      submit_nuance_baseline_anon / submit_nuance_day30_anon [anon ONLY]
--   6. the column-grant masking migration on nuance_sessions (D-011 ruling 2)
-- Plus two internal helpers (validation + rate-limit consumption) shared by
-- the three RPCs so the frozen check order lives in one place each —
-- execute revoked from all client roles, same as nuance_score (D-012 §8).
--
-- Explicitly OUT of this file (owned by other chunks — do not add here):
--   * 0001–0006, 0008; A3 policy edits (the §6 change below is grants-only)
--   * G2's admin views / the excluded toggle
--   * import_guest_snapshot's anon-row linking (B5 writes user_id onto
--     B4's rows; B4 only reads the result)
--
-- Source of truth: docs/specs/B4-nuance-rpcs.md (chunk spec, normative);
-- docs/specs/WS-B-signatures.md (FROZEN contract, D-010/D-011);
-- docs/NUANCE_RUBRIC.md (RATIFIED — scoring rules, transcribed not
-- reinterpreted); D-012 §9 (mechanics), D-013 (threshold 0.55, strict >),
-- D-015 (untrimmed, code points, no Unicode normalization).
--
-- B4 consumes NONE of B1's 0004 helpers (S2 acks carry no snapshot), so this
-- file applies cleanly on the 0001→0002→0003 chain even before 0004–0006
-- exist (verified from empty; the numbering slot is reserved per D-012 §8).

begin;

-- ── 1. pg_trgm (extensions schema) ───────────────────────────────────────────
-- D-012 §9: pg_trgm installs into the `extensions` schema and every call is
-- schema-qualified (`extensions.similarity(...)`) because the contract pins
-- `search_path = public, pg_temp`, which does not include `extensions`.
--
-- The `create schema if not exists` line is a no-op on real Supabase (the
-- extensions schema always exists there); it exists so this migration also
-- applies on a plain local Postgres prepared with tests/lib/pg-local-stub.sql
-- (D-017 no-Docker test path), which has no extensions schema.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── 2. scoring function (internal — execute revoked) ─────────────────────────
-- Implements docs/NUANCE_RUBRIC.md exactly (RATIFIED; do not reinterpret):
--   tap = 1 · complicated = 2 · structured with BOTH fields >= 40 chars AND
--   not near-duplicates = 3 · a failed structured attempt = 2, never 1.
--
-- D-015 measurement pins (both RATIFIED — do not "improve"):
--   * UNTRIMMED: char_length() on the field exactly as stored. No trim()/
--     btrim()/normalization anywhere in the scoring path — JS and Postgres
--     disagree on what whitespace even is, so trimming would itself cause
--     reference-vs-SQL divergence.
--   * CODE POINTS are the length unit: char_length() in a UTF-8 database
--     counts code points, identical to the reference scorer's
--     Array.from(str).length. Grapheme clusters are expressly NOT the unit.
--
-- Near-duplicate ⇔ extensions.similarity(position, other_side) STRICTLY
-- GREATER THAN nuance_trgm_threshold() (D-013: 0.55, strict >; a pair
-- measuring exactly the threshold is NOT a duplicate).
--
-- The 40 below is the rubric's MIN_STRUCTURED_FIELD_CHARS
-- (tests/nuance/reference-scorer.mjs). Only the trigram threshold and the
-- rate limit get parameter-slot functions (D-012 §9); this constant is
-- rubric-frozen (a change is a decisions.md event + fixture re-cut, D-014 §3).
--
-- An unrecognized response_type raises a non-registry exception (bubbles to
-- the client as `internal`) — it mirrors the reference scorer's throw and is
-- unreachable through the RPCs, which validate content first.

create function public.nuance_score(answers jsonb)
returns int
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_answer   jsonb;
  v_type     text;
  v_position text;
  v_other    text;
  v_total    int := 0;
begin
  for v_answer in select jsonb_array_elements(answers) loop
    v_type := v_answer->>'response_type';
    if v_type = 'tap' then
      v_total := v_total + 1;
    elsif v_type = 'complicated' then
      v_total := v_total + 2;
    elsif v_type = 'structured' then
      -- Missing field -> '' (0 chars), same as the reference scorer's
      -- `answer.position ?? ''`. Measured AS STORED: untrimmed (D-015 §1),
      -- code points (D-015 §2).
      v_position := coalesce(v_answer->>'position', '');
      v_other    := coalesce(v_answer->>'other_side', '');
      if char_length(v_position) >= 40
         and char_length(v_other) >= 40
         and not (extensions.similarity(v_position, v_other) > public.nuance_trgm_threshold())
      then
        v_total := v_total + 3;
      else
        -- Failed structured attempt (short/missing field or near-duplicate
        -- pair): falls to the "It's complicated" tier, never to 1.
        v_total := v_total + 2;
      end if;
    else
      raise exception 'nuance_score: unrecognized response_type (validate before scoring)';
    end if;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.nuance_score(jsonb) from public;
revoke execute on function public.nuance_score(jsonb) from anon, authenticated;

-- ── 3. parameter-slot functions (D-012 §9) ───────────────────────────────────
-- Single-definition slots so the ratified/tuned values change in exactly one
-- place, mirroring the reference scorer's named constants (D-005 §4).
-- Changing either value post-ratification is a decisions.md event.

-- RATIFIED at 0.55, strict `>` (D-013 2026-07-08). Must always agree with
-- TRIGRAM_NEAR_DUPLICATE_THRESHOLD in tests/nuance/reference-scorer.mjs.
create function public.nuance_trgm_threshold()
returns real
language sql
immutable
set search_path = public, pg_temp
as $$ select 0.55::real $$;

-- 60/hour/IP — classroom-burst sized (BUILD_PLAN [r5]): 30 students on one
-- school NAT within 10 minutes must all pass.
create function public.nuance_rate_limit_per_hour()
returns int
language sql
immutable
set search_path = public, pg_temp
as $$ select 60 $$;

revoke execute on function public.nuance_trgm_threshold() from public;
revoke execute on function public.nuance_trgm_threshold() from anon, authenticated;
revoke execute on function public.nuance_rate_limit_per_hour() from public;
revoke execute on function public.nuance_rate_limit_per_hour() from anon, authenticated;

-- ── internal helper: answers validation (frozen check-order steps 1b + 2) ────
-- One definition shared by all three RPCs so the invalid_params /
-- invalid_answers boundary (D-011) cannot drift between them:
--   * `answers` not a jsonb ARRAY at all              -> invalid_params
--   * well-formed array whose CONTENT violates the
--     D-008 shape                                     -> invalid_answers
-- Content rules (D-011, spec §"Interfaces consumed"): array length 1–12;
-- serialized size <= 8 KB; every element an object with a non-empty string
-- question_id, response_type in the frozen trio, tap entries carrying a
-- literal 'yes'/'no' position, structured position/other_side (when present)
-- JSON strings; no duplicate question_id.
-- Error convention (contract §6): message = bare snake_case code, no
-- interpolated values; detail static only, never user content.

create function public.nuance_validate_answers(answers jsonb)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_answer jsonb;
  v_type   text;
  v_qid    jsonb;
  v_len    int;
begin
  -- Step 1 (type/arity): not a jsonb array at all.
  if answers is null or jsonb_typeof(answers) <> 'array' then
    raise exception using message = 'invalid_params',
      detail = 'answers must be a jsonb array';
  end if;

  -- Step 2 (content): everything below is invalid_answers.
  v_len := jsonb_array_length(answers);
  if v_len < 1 or v_len > 12 then
    raise exception using message = 'invalid_answers',
      detail = 'answers array length must be between 1 and 12';
  end if;

  -- Serialized size cap: octet_length of the canonical jsonb text rendering.
  if octet_length(answers::text) > 8192 then
    raise exception using message = 'invalid_answers',
      detail = 'answers serialized size exceeds 8 KB';
  end if;

  for v_answer in select jsonb_array_elements(answers) loop
    if jsonb_typeof(v_answer) <> 'object' then
      raise exception using message = 'invalid_answers',
        detail = 'each answers entry must be an object';
    end if;

    v_qid := v_answer->'question_id';
    if v_qid is null or jsonb_typeof(v_qid) <> 'string' or v_answer->>'question_id' = '' then
      raise exception using message = 'invalid_answers',
        detail = 'each answers entry must carry a non-empty string question_id';
    end if;

    v_type := v_answer->>'response_type';
    if v_type is null or v_type not in ('tap', 'complicated', 'structured') then
      raise exception using message = 'invalid_answers',
        detail = 'response_type must be tap, complicated, or structured';
    end if;

    -- D-008: on 'tap', position holds the literal 'yes'/'no'.
    if v_type = 'tap' then
      if jsonb_typeof(v_answer->'position') is distinct from 'string'
         or v_answer->>'position' not in ('yes', 'no') then
        raise exception using message = 'invalid_answers',
          detail = 'tap entries must carry a literal yes/no position';
      end if;
    end if;

    -- Structured fields are optional (their absence scores 2, not an error),
    -- but when present they must be JSON strings — any other JSON type is a
    -- shape violation, not something to coerce and score.
    if v_type = 'structured' then
      if v_answer ? 'position' and jsonb_typeof(v_answer->'position') <> 'string' then
        raise exception using message = 'invalid_answers',
          detail = 'structured position must be a string when present';
      end if;
      if v_answer ? 'other_side' and jsonb_typeof(v_answer->'other_side') <> 'string' then
        raise exception using message = 'invalid_answers',
          detail = 'structured other_side must be a string when present';
      end if;
    end if;
  end loop;

  -- Duplicate question_id.
  if (select count(distinct a->>'question_id') from jsonb_array_elements(answers) a) <> v_len then
    raise exception using message = 'invalid_answers',
      detail = 'duplicate question_id in answers';
  end if;
end;
$$;

revoke execute on function public.nuance_validate_answers(jsonb) from public;
revoke execute on function public.nuance_validate_answers(jsonb) from anon, authenticated;

-- ── 4. nuance_rate_limits (D-012 §9) ─────────────────────────────────────────
-- Hourly fixed windows keyed by requester IP. Server-internal: RLS enabled
-- with ZERO policies and no client grants — only the SECURITY DEFINER RPC
-- path (as table owner) ever touches it.

create table public.nuance_rate_limits (
  ip            text not null,
  window_start  timestamptz not null,
  count         int not null,
  primary key (ip, window_start)
);

alter table public.nuance_rate_limits enable row level security;
-- Zero policies, zero grants: default-deny for every client role.

-- ── internal helper: rate-limit consumption (frozen check-order step 5) ──────
-- Counting rides the two ANON RPCs only (contract: rate_limited is anon-only;
-- the authed RPC has identity + the 0001 unique constraint). One definition
-- so the IP-extraction and increment-and-check logic cannot drift between
-- the two anon RPCs.
--
-- IP source (D-012 §9): first hop of x-forwarded-for from the
-- request.headers GUC PostgREST sets per request. A missing/blank header
-- falls into a shared 'unknown' bucket — fail-closed-ish (unknown callers
-- share one 60/hour budget), never fail-open. First hop = the leftmost
-- comma-separated entry, btrim'd (header formatting only — this is NOT the
-- scoring path, where D-015 bars trimming).
--
-- Increment-and-check: the counter row is upserted, then compared against
-- nuance_rate_limit_per_hour(). When the check raises, the whole RPC
-- transaction (including the increment) rolls back, so a saturated window
-- holds at exactly the limit rather than growing unboundedly.

create function public.nuance_consume_rate_limit()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_headers text;
  v_ip      text;
  v_window  timestamptz := date_trunc('hour', now());
  v_count   int;
begin
  v_headers := nullif(current_setting('request.headers', true), '');
  if v_headers is not null then
    v_ip := nullif(btrim(split_part(coalesce(v_headers::json->>'x-forwarded-for', ''), ',', 1)), '');
  end if;
  v_ip := coalesce(v_ip, 'unknown');

  insert into public.nuance_rate_limits as rl (ip, window_start, count)
  values (v_ip, v_window, 1)
  on conflict (ip, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;

  if v_count > public.nuance_rate_limit_per_hour() then
    raise exception using message = 'rate_limited',
      detail = 'hourly per-IP submission limit reached';
  end if;
end;
$$;

revoke execute on function public.nuance_consume_rate_limit() from public;
revoke execute on function public.nuance_consume_rate_limit() from anon, authenticated;

-- ── 5. the three RPCs ────────────────────────────────────────────────────────
-- Frozen signatures (WS-B-signatures.md §4/B4 — names, params, returns,
-- grants may not be altered). All three return the IDENTICAL information-free
-- ack {accepted: true} — no score, ever, on any path (D-010, ratified by
-- owner 2026-07-08). Check order is normative (spec): param types ->
-- answers content -> anon_id_linked -> duplicate-idempotency -> rate limit ->
-- day-30 preconditions -> score + insert + ack. Duplicate-before-rate-limit
-- is deliberate (D-012 §9): a lost-ack retry must never be rate-limited into
-- a failure.
--
-- Every insert carries ON CONFLICT DO NOTHING as a race backstop: the
-- duplicate PRE-CHECK is the designed idempotency path (D-011 ruling 4), but
-- two concurrent first submissions could both pass it, and no raw 23505 may
-- ever surface through an RPC — the loser of the race still acks.

-- ── submit_nuance_session(kind, answers) — authenticated ─────────────────────

create function public.submit_nuance_session(kind text, answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid              uuid := auth.uid();
  v_baseline_created timestamptz;
  v_elapsed          int;
begin
  -- Defensive-only guard (contract §6): the grant wall stops anon first.
  if v_uid is null then
    raise exception using message = 'not_authenticated';
  end if;

  -- 1. Param type checks: kind in the frozen pair (D-010 — two values).
  if kind is null or kind not in ('baseline', 'day30') then
    raise exception using message = 'invalid_params',
      detail = 'kind must be baseline or day30';
  end if;

  -- 1b/2. answers array check (invalid_params) + content (invalid_answers).
  perform public.nuance_validate_answers(answers);

  -- 3. anon_id_linked: n/a (authed identity).

  -- 4. Duplicate pre-check -> idempotent success. Authed identity is
  -- (uid, NULL, kind) — exactly the 0001 unique tuple this call would write.
  -- No write, no scoring, no error (D-011 ruling 4).
  if exists (
    select 1 from public.nuance_sessions ns
    where ns.user_id = v_uid and ns.anon_id is null
      and ns.kind = submit_nuance_session.kind
  ) then
    return jsonb_build_object('accepted', true);
  end if;

  -- 5. Rate limit: n/a (rate_limited is anon-only per the contract).

  -- 6. Day-30 preconditions. Baseline = the identity's EARLIEST
  -- kind='baseline' row with user_id = uid — a linked-anon baseline from
  -- B5's import counts (that is the point of §4.6 linking: it preserves the
  -- guest's 30-day clock).
  if kind = 'day30' then
    select ns.created_at into v_baseline_created
    from public.nuance_sessions ns
    where ns.user_id = v_uid and ns.kind = 'baseline'
    order by ns.created_at asc
    limit 1;

    if v_baseline_created is null then
      raise exception using message = 'baseline_missing';
    end if;

    v_elapsed := floor(extract(epoch from (now() - v_baseline_created)) / 86400)::int;
    if v_elapsed < 28 then
      raise exception using message = 'baseline_too_recent';
    end if;
  end if;

  -- 7. Score + insert + information-free ack.
  insert into public.nuance_sessions (user_id, anon_id, kind, answers, score, elapsed_days)
  values (v_uid, null, kind, answers, public.nuance_score(answers), v_elapsed)
  on conflict do nothing;

  return jsonb_build_object('accepted', true);
end;
$$;

revoke execute on function public.submit_nuance_session(text, jsonb) from public;
revoke execute on function public.submit_nuance_session(text, jsonb) from anon;
grant execute on function public.submit_nuance_session(text, jsonb) to authenticated;

-- ── submit_nuance_baseline_anon(anon_id, answers) — anon ONLY ────────────────
-- Grant tightened to anon only (D-011): an authed user has the
-- submit_nuance_session path; the narrower grant removes a pointless
-- unlinked-row minting surface in a minors' app. An authed caller must hit
-- the grant wall (no authenticated grant — deliberate, do not add).

create function public.submit_nuance_baseline_anon(anon_id text, answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1. Param type checks: anon_id non-empty, UUID-format (C1 envelope v2
  -- mints it via crypto.randomUUID(); the format check blocks free-text
  -- identities from entering a minors-adjacent table).
  if anon_id is null
     or anon_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
    raise exception using message = 'invalid_params',
      detail = 'anon_id must be a UUID-format string';
  end if;

  -- 1b/2. answers array check (invalid_params) + content (invalid_answers).
  perform public.nuance_validate_answers(answers);

  -- 3. anon_id_linked [r2]: an anon_id already linked to an account (any
  -- row with this anon_id and a non-null user_id, i.e. B5's import ran) may
  -- no longer submit anonymously.
  if exists (
    select 1 from public.nuance_sessions ns
    where ns.anon_id = submit_nuance_baseline_anon.anon_id
      and ns.user_id is not null
  ) then
    raise exception using message = 'anon_id_linked';
  end if;

  -- 4. Duplicate pre-check -> idempotent success, BEFORE the rate limit
  -- (D-012 §9): a lost-ack retry must never be rate-limited into a failure.
  -- No write, no scoring, no rate-limit consumption.
  if exists (
    select 1 from public.nuance_sessions ns
    where ns.user_id is null
      and ns.anon_id = submit_nuance_baseline_anon.anon_id
      and ns.kind = 'baseline'
  ) then
    return jsonb_build_object('accepted', true);
  end if;

  -- 5. Rate limit (increment-and-check the IP hourly window).
  perform public.nuance_consume_rate_limit();

  -- 6. Day-30 preconditions: n/a (baseline).

  -- 7. Score + insert + information-free ack.
  insert into public.nuance_sessions (user_id, anon_id, kind, answers, score)
  values (null, anon_id, 'baseline', answers, public.nuance_score(answers))
  on conflict do nothing;

  return jsonb_build_object('accepted', true);
end;
$$;

revoke execute on function public.submit_nuance_baseline_anon(text, jsonb) from public;
revoke execute on function public.submit_nuance_baseline_anon(text, jsonb) from authenticated;
grant execute on function public.submit_nuance_baseline_anon(text, jsonb) to anon;

-- ── submit_nuance_day30_anon(anon_id, answers) — anon ONLY ───────────────────

create function public.submit_nuance_day30_anon(anon_id text, answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_baseline_created timestamptz;
  v_elapsed          int;
begin
  -- 1. Param type checks (same as the baseline anon RPC).
  if anon_id is null
     or anon_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
    raise exception using message = 'invalid_params',
      detail = 'anon_id must be a UUID-format string';
  end if;

  -- 1b/2. answers array check (invalid_params) + content (invalid_answers).
  perform public.nuance_validate_answers(answers);

  -- 3. anon_id_linked [r2].
  if exists (
    select 1 from public.nuance_sessions ns
    where ns.anon_id = submit_nuance_day30_anon.anon_id
      and ns.user_id is not null
  ) then
    raise exception using message = 'anon_id_linked';
  end if;

  -- 4. Duplicate pre-check -> idempotent success, before the rate limit.
  if exists (
    select 1 from public.nuance_sessions ns
    where ns.user_id is null
      and ns.anon_id = submit_nuance_day30_anon.anon_id
      and ns.kind = 'day30'
  ) then
    return jsonb_build_object('accepted', true);
  end if;

  -- 5. Rate limit (increment-and-check the IP hourly window).
  perform public.nuance_consume_rate_limit();

  -- 6. Day-30 preconditions: anon identity's baseline is exactly
  -- (NULL, anon_id, 'baseline') — unique per the 0001 constraint.
  select ns.created_at into v_baseline_created
  from public.nuance_sessions ns
  where ns.user_id is null
    and ns.anon_id = submit_nuance_day30_anon.anon_id
    and ns.kind = 'baseline';

  if v_baseline_created is null then
    raise exception using message = 'baseline_missing';
  end if;

  v_elapsed := floor(extract(epoch from (now() - v_baseline_created)) / 86400)::int;
  if v_elapsed < 28 then
    raise exception using message = 'baseline_too_recent';
  end if;

  -- 7. Score + insert (elapsed_days on day-30 rows) + information-free ack.
  insert into public.nuance_sessions (user_id, anon_id, kind, answers, score, elapsed_days)
  values (null, anon_id, 'day30', answers, public.nuance_score(answers), v_elapsed)
  on conflict do nothing;

  return jsonb_build_object('accepted', true);
end;
$$;

revoke execute on function public.submit_nuance_day30_anon(text, jsonb) from public;
revoke execute on function public.submit_nuance_day30_anon(text, jsonb) from authenticated;
grant execute on function public.submit_nuance_day30_anon(text, jsonb) to anon;

-- ── 6. column-grant masking migration (D-011 ruling 2) ───────────────────────
-- Makes the ratified no-score-shown stance STRUCTURAL on the own-row SELECT
-- path (the RPC path is already ack-only above): replace 0003's table-wide
-- SELECT grant on nuance_sessions with the exact D-011 column list —
-- excluding score and elapsed_days. Own-row answers/kind/created_at stay
-- readable (§5.1.5 "then vs now" needs them).
--
-- This is a GRANT change layered on 0003, not a policy edit — A3's policies
-- are untouched. Consequence (D-012 §9, made explicit): the grant is
-- role-level, so ADMINS also lose direct score SELECT — G2's admin views
-- must be SECURITY DEFINER, which D-011 already designates as the sole
-- score read path. Client-side: any `select *` on this table now errors —
-- C2 must select explicit columns.

revoke select on public.nuance_sessions from authenticated;
grant select (id, user_id, anon_id, kind, answers, excluded, created_at)
  on public.nuance_sessions to authenticated;

commit;

-- 0008_rpc_import_events_deletion.sql
-- CIVIC — Import + events + deletion RPCs (B5).
--
-- Ownership (D-005 §1): this migration is owned exclusively by chunk B5. No
-- other chunk may touch it; B5 may not touch 0001–0007.
--
-- Contents:
--   * import_guest_snapshot(snapshot jsonb)   → S1 {snapshot, xp_awarded}.
--     Grant: authenticated. The §4.6 bounded-trust exception: flags in,
--     server-derived XP out (catalog-capped), one-shot, anon_id-linked
--     nuance baselines, idempotent on replay.
--   * event_daily_quota() (internal parameter-slot function, D-012 §6,
--     execute revoked) + log_event(name text, props jsonb) → S2 {accepted}.
--     Grant: anon, authenticated. Frozen 25-name allowlist + per-identity
--     daily quota.
--   * delete_account() → S2 {deleted: true}. Grant: authenticated. Full
--     cascade the privacy page promises; anonymizes events first.
--
-- Explicitly OUT of this file (owned by other chunks — do not add here):
--   * 0001–0007; RLS policies
--   * the C3 import flow/UX, guest.js (C1, merged), events.js transport (C2)
--   * G2 dedup/views; funnel SQL views (G1); F1's delete_account call site
--   * B1's 0004 helpers (progress_snapshot / topic_unlocked / xp_for),
--     B3's ob_catalog (0006), B4's nuance RPCs/rate limits (0007) — all
--     consumed here as frozen, never redefined.
--
-- Source of truth: docs/specs/B5-import-events-deletion.md (frozen chunk
-- spec, normative check order + the frozen 25-name events allowlist);
-- docs/specs/WS-B-signatures.md (FROZEN contract, D-010/D-011 — ruling 1:
-- import input = the ENTIRE C1 envelope; ruling 4: replay idempotency);
-- docs/specs/C1-guest-envelope-v2.md + merged src/data-layer/guest.js (the
-- envelope shape parsed here); D-012 §6 (events allowlist + anon_id-via-
-- props + 500/day quota + delete-anonymizes-events), §7 (default-state
-- definition excluding streak columns; anon_id UUID check; skip-other-
-- account linking; OB-XP-from-takes-only; perfect-bonus derivation;
-- preset-downgrade on import).
--
-- Error convention (contract §6): raise exception using
-- message = '<snake_case_code>' — exactly one code token, no interpolated
-- values in message; detail carries static context only, never user
-- content (evolved-take / cold-take text is never echoed in any detail).
--
-- Grant-wall convention (0004/0006/0007 precedent): revoke execute on every
-- function here from the roles NOT in its contract-listed audience, naming
-- anon/authenticated explicitly (not just PUBLIC) — ALTER DEFAULT
-- PRIVILEGES on the real Supabase stack grants execute to anon/authenticated
-- at creation time, so a PUBLIC-only revoke would leave those standing.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.import_guest_snapshot — S1 { snapshot, xp_awarded }
-- ═══════════════════════════════════════════════════════════════════════════
-- Normative check order (B5 spec):
--   1. auth guard; snapshot is a jsonb object → else invalid_params.
--   2. Lock the caller's progress row; already imported
--      (imported_from_guest = true) → S1 + xp_awarded 0, NO writes — BEFORE
--      any other check (D-011 ruling 4, the lost-ack replay case).
--   3. Structural validation → invalid_snapshot: v = 2; anon_id present and
--      UUID-format; state an object; every state.topics key ∈
--      topics_catalog with D-012 §1-shaped flags/quizScore; every
--      state.opinion_builders key ∈ ob_catalog with {completed: bool};
--      every evolved_takes entry well-formed, validly paired, at most one
--      per ob_id. NO unlock-chain/ordering validation — forged flags are
--      the accepted, XP-bounded residual risk (§4.6).
--   4. progress_not_empty (D-012 §7 default-state definition — streak
--      columns deliberately excluded) — refused iff never imported AND the
--      row is not at default state.
--   5. One transaction: server-derived XP via xp_for(), absolute total_xp
--      write, imported_from_guest := true, take rows is_imported = true,
--      baseline linking. state.total_xp is NEVER read.
--   6. Return S1.
--
-- Hard structural ceiling (derivation, not validation): 5 topics × 200
-- (50 flashcards L1 + 50+25 quiz L1 perfect + 50+25 quiz L3 perfect) +
-- 10 obs × 300 (100 base + 200 custom-bonus) = 1000 + 3000 = 4,000 XP.

create function public.import_guest_snapshot(snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user               uuid;
  v_imported           boolean;
  v_cur_total_xp       int;
  v_cur_topics         jsonb;
  v_cur_obs            jsonb;
  v_evolved_count      int;
  v_anon_id            text;
  v_state              jsonb;
  v_topics             jsonb;
  v_obs                jsonb;
  v_takes              jsonb;
  v_topic_key          text;
  v_topic_val          jsonb;
  v_level_val          jsonb;
  v_ob_key             text;
  v_ob_val             jsonb;
  v_take               jsonb;
  v_take_ob_id         text;
  v_take_topic_id      text;
  v_take_cold          text;
  v_take_evolved       text;
  v_seen_obs           text[] := '{}';
  v_ob_topic_id        text;
  v_ob_std_options     text[];
  v_xp_total           int := 0;
  v_key_len            int;
  v_effective_custom   boolean;
  v_row_xp             int;
begin
  -- 1. auth guard (defensive-only, D-011: the grant wall normally fires first)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 1b. snapshot must be a jsonb object (the entire C1 envelope, not state alone).
  if snapshot is null or jsonb_typeof(snapshot) is distinct from 'object' then
    raise exception using
      message = 'invalid_params',
      detail  = 'snapshot must be a jsonb object (the entire C1 envelope v2)';
  end if;

  -- Lock the caller's progress row for the rest of the transaction (a
  -- concurrent duplicate import serializes here and lands on the replay
  -- path — same convention as B1/B3).
  select p.imported_from_guest, p.total_xp, p.topics, p.opinion_builders
    into strict v_imported, v_cur_total_xp, v_cur_topics, v_cur_obs
    from public.progress p
   where p.id = v_user
     for update;

  -- 2. already imported → idempotent success, NO writes, BEFORE any other
  -- check (D-011 ruling 4 — the lost-ack retry case C3's clear-on-success
  -- loop depends on). A malformed replay snapshot is never validated.
  if v_imported then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0
    );
  end if;

  -- 3. structural validation → invalid_snapshot ───────────────────────────

  -- v = 2 (exact, and must genuinely be a JSON number — a stringly-typed
  -- "2" is a shape violation, not a silently-accepted coercion).
  if jsonb_typeof(snapshot->'v') is distinct from 'number' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'v must be the JSON number 2';
  end if;
  if (snapshot->>'v')::numeric is distinct from 2 then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'v must equal 2';
  end if;

  -- anon_id present, UUID-format (D-012 §7 — it links political-opinion
  -- rows; an arbitrary string must not ride in; matches B4's regex).
  if jsonb_typeof(snapshot->'anon_id') is distinct from 'string' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'anon_id must be a string';
  end if;
  v_anon_id := snapshot->>'anon_id';
  if v_anon_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'anon_id must be UUID-format';
  end if;

  -- state an object.
  if jsonb_typeof(snapshot->'state') is distinct from 'object' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'state must be an object';
  end if;
  v_state := snapshot->'state';

  -- state.topics: object; every key ∈ topics_catalog; D-012 §1 shape.
  -- state.total_xp and state.baseline_done are NEVER read (§4.6) — not
  -- referenced anywhere in this function.
  if jsonb_typeof(v_state->'topics') is distinct from 'object' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'state.topics must be an object';
  end if;
  v_topics := v_state->'topics';

  for v_topic_key, v_topic_val in select key, value from jsonb_each(v_topics) loop
    if not exists (select 1 from public.topics_catalog tc where tc.topic_id = v_topic_key) then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'state.topics key is not present in topics_catalog';
    end if;
    if jsonb_typeof(v_topic_val) is distinct from 'object' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'state.topics entry must be an object';
    end if;
    if v_topic_val ? 'unlocked' and jsonb_typeof(v_topic_val->'unlocked') is distinct from 'boolean' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'topics.<id>.unlocked must be a boolean when present';
    end if;
    if v_topic_val ? 'currentLevel' then
      if jsonb_typeof(v_topic_val->'currentLevel') is distinct from 'null'
         and jsonb_typeof(v_topic_val->'currentLevel') is distinct from 'number' then
        raise exception using
          message = 'invalid_snapshot',
          detail  = 'topics.<id>.currentLevel must be an int or null when present';
      end if;
      if jsonb_typeof(v_topic_val->'currentLevel') = 'number'
         and (v_topic_val->>'currentLevel') !~ '^-?[0-9]+$' then
        raise exception using
          message = 'invalid_snapshot',
          detail  = 'topics.<id>.currentLevel must be an integer when numeric';
      end if;
    end if;
    if v_topic_val ? 'levels' then
      if jsonb_typeof(v_topic_val->'levels') is distinct from 'object' then
        raise exception using
          message = 'invalid_snapshot',
          detail  = 'topics.<id>.levels must be an object when present';
      end if;
      for v_level_val in select value from jsonb_each(v_topic_val->'levels') loop
        if jsonb_typeof(v_level_val) is distinct from 'object' then
          raise exception using
            message = 'invalid_snapshot',
            detail  = 'topics.<id>.levels.<key> must be an object';
        end if;
        if v_level_val ? 'flashcardsComplete'
           and jsonb_typeof(v_level_val->'flashcardsComplete') is distinct from 'boolean' then
          raise exception using
            message = 'invalid_snapshot',
            detail  = 'levels.<key>.flashcardsComplete must be a boolean when present';
        end if;
        if v_level_val ? 'quizComplete'
           and jsonb_typeof(v_level_val->'quizComplete') is distinct from 'boolean' then
          raise exception using
            message = 'invalid_snapshot',
            detail  = 'levels.<key>.quizComplete must be a boolean when present';
        end if;
        if v_level_val ? 'quizScore' then
          if jsonb_typeof(v_level_val->'quizScore') is distinct from 'null'
             and jsonb_typeof(v_level_val->'quizScore') is distinct from 'number' then
            raise exception using
              message = 'invalid_snapshot',
              detail  = 'levels.<key>.quizScore must be an int or null when present';
          end if;
          if jsonb_typeof(v_level_val->'quizScore') = 'number'
             and (v_level_val->>'quizScore') !~ '^-?[0-9]+$' then
            raise exception using
              message = 'invalid_snapshot',
              detail  = 'levels.<key>.quizScore must be an integer when numeric';
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- state.opinion_builders: object; every key ∈ ob_catalog; {completed: bool}.
  if jsonb_typeof(v_state->'opinion_builders') is distinct from 'object' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'state.opinion_builders must be an object';
  end if;
  v_obs := v_state->'opinion_builders';

  for v_ob_key, v_ob_val in select key, value from jsonb_each(v_obs) loop
    if not exists (select 1 from public.ob_catalog oc where oc.ob_id = v_ob_key) then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'state.opinion_builders key is not present in ob_catalog';
    end if;
    if jsonb_typeof(v_ob_val) is distinct from 'object' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'state.opinion_builders entry must be an object';
    end if;
    if v_ob_val ? 'completed' and jsonb_typeof(v_ob_val->'completed') is distinct from 'boolean' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'opinion_builders.<id>.completed must be a boolean when present';
    end if;
  end loop;

  -- state.evolved_takes: array; every entry well-formed + validly paired;
  -- at most one take per ob_id.
  if jsonb_typeof(v_state->'evolved_takes') is distinct from 'array' then
    raise exception using
      message = 'invalid_snapshot',
      detail  = 'state.evolved_takes must be an array';
  end if;
  v_takes := v_state->'evolved_takes';

  for v_take in select * from jsonb_array_elements(v_takes) loop
    if jsonb_typeof(v_take) is distinct from 'object' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry must be an object';
    end if;

    if jsonb_typeof(v_take->'opinion_builder_id') is distinct from 'string' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry must carry a string opinion_builder_id';
    end if;
    if jsonb_typeof(v_take->'topic_id') is distinct from 'string' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry must carry a string topic_id';
    end if;
    if jsonb_typeof(v_take->'is_custom') is distinct from 'boolean' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry must carry a boolean is_custom';
    end if;
    if jsonb_typeof(v_take->'evolved_take') is distinct from 'string' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry must carry a string evolved_take';
    end if;

    v_take_ob_id    := v_take->>'opinion_builder_id';
    v_take_topic_id := v_take->>'topic_id';
    v_take_cold     := v_take->>'cold_take';
    v_take_evolved  := v_take->>'evolved_take';

    if v_take_cold is distinct from 'yes' and v_take_cold is distinct from 'no' then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes.cold_take must be exactly ''yes'' or ''no''';
    end if;
    if char_length(v_take_evolved) = 0 or char_length(v_take_evolved) > 2000 then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes.evolved_take must be non-empty text of at most 2000 characters';
    end if;

    -- valid ob_catalog pairing (unknown ob, or ob paired with a different topic).
    select oc.topic_id into v_ob_topic_id
      from public.ob_catalog oc
     where oc.ob_id = v_take_ob_id;
    if v_ob_topic_id is null or v_ob_topic_id is distinct from v_take_topic_id then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes entry references an unknown or mispaired opinion_builder_id/topic_id';
    end if;

    -- at most one take per ob_id.
    if v_take_ob_id = any(v_seen_obs) then
      raise exception using
        message = 'invalid_snapshot',
        detail  = 'evolved_takes has more than one entry for the same opinion_builder_id';
    end if;
    v_seen_obs := array_append(v_seen_obs, v_take_ob_id);
  end loop;

  -- 4. progress_not_empty (D-012 §7 default-state definition — streak
  -- columns deliberately excluded; C2's login bootstrap touches them before
  -- C3 imports).
  select count(*) into v_evolved_count
    from public.evolved_takes et
   where et.user_id = v_user;

  if v_cur_total_xp is distinct from 0
     or v_cur_topics is distinct from '{}'::jsonb
     or v_cur_obs is distinct from '{}'::jsonb
     or v_evolved_count <> 0 then
    raise exception using
      message = 'progress_not_empty',
      detail  = 'progress row is not at the default state and this account has not imported before (§4.6 one-shot condition)';
  end if;

  -- 5. one transaction: server-derived XP, absolute writes, baseline linking.

  -- ── topics XP: flashcardsComplete@L1 → 50; quizComplete@{1,3} → 50 each,
  -- + 25 perfect bonus iff quizScore = that (topic,level)'s real answer-key
  -- length (validated against the DB, never trusted from the envelope).
  -- L2/L3 flashcardsComplete → 0 (D-012 §2) — not read at all. Only levels
  -- '1' and '3' are ever inspected for XP purposes, by fixed literal key —
  -- an envelope with fictitious extra level keys (e.g. "9") mints nothing
  -- for them, which is what keeps the derivation ceiling structural.
  for v_topic_key, v_topic_val in select key, value from jsonb_each(v_topics) loop
    if v_topic_val ? 'levels' then
      v_level_val := v_topic_val->'levels'->'1';
      if v_level_val is not null then
        if coalesce((v_level_val->>'flashcardsComplete')::boolean, false) then
          v_xp_total := v_xp_total + public.xp_for('flashcards');
        end if;
        if coalesce((v_level_val->>'quizComplete')::boolean, false) then
          v_xp_total := v_xp_total + public.xp_for('quiz');
          select array_length(k.answers, 1) into v_key_len
            from public.quiz_answer_keys k
           where k.topic_id = v_topic_key and k.level = 1;
          if v_key_len is not null and (v_level_val->>'quizScore')::int = v_key_len then
            v_xp_total := v_xp_total + public.xp_for('quiz_perfect_bonus');
          end if;
        end if;
      end if;

      v_level_val := v_topic_val->'levels'->'3';
      if v_level_val is not null then
        if coalesce((v_level_val->>'quizComplete')::boolean, false) then
          v_xp_total := v_xp_total + public.xp_for('quiz');
          select array_length(k.answers, 1) into v_key_len
            from public.quiz_answer_keys k
           where k.topic_id = v_topic_key and k.level = 3;
          if v_key_len is not null and (v_level_val->>'quizScore')::int = v_key_len then
            v_xp_total := v_xp_total + public.xp_for('quiz_perfect_bonus');
          end if;
        end if;
      end if;
    end if;
  end loop;

  -- ── OB XP: derives ONLY from valid take entries (a bare `completed` flag
  -- with no take mints nothing). Preset-downgrade (D-012 §7): is_custom =
  -- false whose text matches none of the ob's standard_options is imported
  -- as is_custom = true (custom XP rule) rather than refused — import
  -- tolerates envelope drift; the comparison aggregate never leaks
  -- non-registry text because it is stored as custom.
  for v_take in select * from jsonb_array_elements(v_takes) loop
    v_take_ob_id    := v_take->>'opinion_builder_id';
    v_take_topic_id := v_take->>'topic_id';
    v_take_cold     := v_take->>'cold_take';
    v_take_evolved  := v_take->>'evolved_take';

    select oc.standard_options into v_ob_std_options
      from public.ob_catalog oc
     where oc.ob_id = v_take_ob_id;

    v_effective_custom := (v_take->>'is_custom')::boolean;
    if not v_effective_custom
       and not (v_take_evolved = any(coalesce(v_ob_std_options, array[]::text[]))) then
      v_effective_custom := true;
    end if;

    v_row_xp := public.xp_for('opinion_builder');
    if v_effective_custom and char_length(v_take_evolved) >= 50 then
      v_row_xp := v_row_xp + public.xp_for('opinion_builder_bonus');
    end if;
    v_xp_total := v_xp_total + v_row_xp;

    insert into public.evolved_takes (
      user_id, topic_id, opinion_builder_id, cold_take, evolved_take,
      is_custom, is_imported, xp_earned
    ) values (
      v_user, v_take_topic_id, v_take_ob_id, v_take_cold, v_take_evolved,
      v_effective_custom, true, v_row_xp
    );
  end loop;

  -- ── progress writes: absolute, not incremented.
  update public.progress p
     set topics              = v_topics,
         opinion_builders     = v_obs,
         total_xp             = v_xp_total,
         imported_from_guest  = true,
         updated_at           = now()
   where p.id = v_user;

  -- ── baseline linking (§4.6): rows already linked to another account are
  -- silently skipped by the `user_id is null` guard — a shared/stolen
  -- device must not fail the whole import.
  update public.nuance_sessions
     set user_id = v_user
   where anon_id = v_anon_id
     and user_id is null;

  -- 6. return S1.
  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', v_xp_total
  );
end;
$$;

revoke execute on function public.import_guest_snapshot(jsonb) from public, anon;
grant execute on function public.import_guest_snapshot(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- event_daily_quota() (internal parameter-slot function, D-012 §6)
-- ═══════════════════════════════════════════════════════════════════════════
-- Single-definition slot so the ratified quota changes in exactly one place
-- (mirrors B4's nuance_trgm_threshold()/nuance_rate_limit_per_hour()
-- pattern, D-012 §9). Changing the value post-ratification is a
-- decisions.md event.

create function public.event_daily_quota()
returns int
language sql
immutable
set search_path = public, pg_temp
as $$ select 500 $$;

revoke execute on function public.event_daily_quota() from public;
revoke execute on function public.event_daily_quota() from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.log_event — S2 { accepted: true }
-- ═══════════════════════════════════════════════════════════════════════════
-- Identity: authed → user_id = auth.uid(), any props.anon_id ignored for
-- identity purposes (and still stripped from stored props, along with the
-- anon path's); anon → props MUST carry anon_id (UUID-format), lifted into
-- events.anon_id and stripped from stored props (the frozen signature has
-- no anon_id param, so it rides props by D-012 §6).
--
-- Check order (spec): types (name non-empty text; props object-or-null;
-- serialized props <= 1 KB; values scalar) → identity resolution (anon_id
-- extraction/format) → allowlist (event_not_allowed) → per-identity daily
-- quota, UTC day, event_daily_quota() = 500 (event_quota_exceeded) →
-- insert → ack.
--
-- Allowlist frozen with the B5 spec (25 names, [P-8] deliverable) — a SQL
-- constant array inside the function body. Additions are decisions.md
-- events; not this builder's call.

create function public.log_event(name text, props jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_anon_id   text;
  v_val       jsonb;
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_count     int;
  v_props     jsonb;
  c_allowlist constant text[] := array[
    'app_open', 'welcome_seen', 'age_gate_passed', 'age_gate_blocked',
    'baseline_offered', 'baseline_started', 'baseline_completed', 'baseline_skipped',
    'flashcards_completed', 'quiz_completed', 'level2_completed', 'level3_cards_completed',
    'ob_started', 'ob_completed', 'comparison_viewed',
    'signup_started', 'account_created', 'import_completed', 'import_failed',
    'day30_banner_shown', 'day30_started', 'day30_completed',
    'install_prompt_shown', 'install_prompt_accepted', 'install_prompt_dismissed'
  ];
begin
  -- types: name non-empty text.
  if name is null or length(name) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'name must be non-empty text';
  end if;

  -- types: props object-or-null.
  if props is not null and jsonb_typeof(props) is distinct from 'object' then
    raise exception using
      message = 'invalid_params',
      detail  = 'props must be a jsonb object or null';
  end if;

  if props is not null then
    -- serialized size <= 1 KB.
    if octet_length(props::text) > 1024 then
      raise exception using
        message = 'invalid_params',
        detail  = 'props serialized size exceeds 1 KB';
    end if;

    -- every value scalar (string/number/boolean/null) — never nested.
    for v_val in select value from jsonb_each(props) loop
      if jsonb_typeof(v_val) not in ('string', 'number', 'boolean', 'null') then
        raise exception using
          message = 'invalid_params',
          detail  = 'props values must be scalar (ids/enums/numbers only)';
      end if;
    end loop;
  end if;

  -- identity resolution.
  if v_user is not null then
    v_anon_id := null;  -- authed: any props.anon_id is ignored for identity.
  else
    if props is null or jsonb_typeof(props->'anon_id') is distinct from 'string' then
      raise exception using
        message = 'invalid_params',
        detail  = 'anon caller must supply a string anon_id in props';
    end if;
    v_anon_id := props->>'anon_id';
    if v_anon_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using
        message = 'invalid_params',
        detail  = 'anon_id must be UUID-format';
    end if;
  end if;

  -- allowlist.
  if not (name = any(c_allowlist)) then
    raise exception using
      message = 'event_not_allowed',
      detail  = 'event name is not on the frozen allowlist';
  end if;

  -- anon_id never rides in stored props — it has its own column.
  v_props := props;
  if v_props is not null then
    v_props := v_props - 'anon_id';
  end if;

  -- per-identity daily quota, UTC day.
  v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_day_end   := v_day_start + interval '1 day';

  if v_user is not null then
    select count(*) into v_count
      from public.events e
     where e.user_id = v_user
       and e.created_at >= v_day_start
       and e.created_at <  v_day_end;
  else
    select count(*) into v_count
      from public.events e
     where e.anon_id = v_anon_id
       and e.created_at >= v_day_start
       and e.created_at <  v_day_end;
  end if;

  if v_count >= public.event_daily_quota() then
    raise exception using
      message = 'event_quota_exceeded',
      detail  = 'per-identity daily event quota reached';
  end if;

  insert into public.events (user_id, anon_id, name, props)
  values (v_user, v_anon_id, name, v_props);

  return jsonb_build_object('accepted', true);
end;
$$;

revoke execute on function public.log_event(text, jsonb) from public;
grant execute on function public.log_event(text, jsonb) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.delete_account — S2 { deleted: true }
-- ═══════════════════════════════════════════════════════════════════════════
-- Full cascade the privacy page promises (D-012 §6). Anonymize events
-- FIRST (rows survive for aggregate funnel honesty per 0001's comment
-- block, but carry no identity afterward), THEN delete the auth.users row
-- so FK cascades remove profiles / progress / evolved_takes /
-- nuance_sessions — including linked-anon rows (they carry user_id after
-- import_guest_snapshot's baseline linking; measurement loss on deletion is
-- the privacy-correct outcome). Deliberately no snapshot returned.

create function public.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- anonymize events BEFORE the cascade-triggering delete.
  update public.events
     set user_id = null
   where user_id = v_user;

  -- FK cascades (0001: profiles/progress/evolved_takes/nuance_sessions all
  -- reference auth.users on delete cascade) remove every remaining row.
  delete from auth.users where id = v_user;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

commit;

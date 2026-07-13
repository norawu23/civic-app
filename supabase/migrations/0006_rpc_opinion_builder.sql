-- 0006_rpc_opinion_builder.sql
-- CIVIC — Opinion builder + comparison RPCs, OB registry (B3).
--
-- Ownership (D-005 §1): this migration is owned exclusively by chunk B3. No
-- other chunk may touch it; B3 may not touch 0001–0005 or 0007–0008.
--
-- Contents:
--   * ob_catalog (new table, D-012 §4) — server-side OB registry closing the
--     D-011 ruling-3 gap (a forged ob_id would otherwise mint unbounded XP;
--     the per-ob_id UNIQUE on evolved_takes is no cap on invented ids) and
--     the D-012 §4 preset-text-leak hole (standard_options lets the RPC
--     verify a "preset" submission actually IS one of the registry's preset
--     texts, so user-written text can never surface through the comparison
--     aggregate's evolved buckets).
--   * evolved_takes.excluded boolean not null default false (D-012 §5) —
--     aligns evolved_takes with ARCHITECTURE §3/N8's "every cited aggregate
--     filters excluded" (nuance_sessions already had this in 0001; the
--     comparison bars were the missing case).
--   * complete_opinion_builder(topic_id text, ob_id text, cold_take text,
--     evolved_take text, is_custom boolean) → S1. Grant: authenticated.
--   * get_ob_comparison(ob_id text) → S3. Grant: anon, authenticated.
--
-- Explicitly OUT of this file (owned by other chunks — do not add here):
--   * complete_level2 / complete_level3_cards / check_streak     (B2, 0005)
--   * nuance, import, events, deletion RPCs                       (B4/B5)
--   * any RLS policy / 0001–0003 change
--   * content JSON / import-path take validation                 (H*, B5)
--
-- Source of truth: docs/specs/B3-opinion-builder.md (frozen chunk spec);
-- docs/specs/WS-B-signatures.md (FROZEN contract, D-010/D-011 ruling 3);
-- D-012 §4 (ob_catalog shape, preset-integrity check, required-before-
-- optional → locked_topic) and §5 (evolved_takes.excluded + P0 filtering).
-- Consumes B1's 0004 helpers (progress_snapshot / topic_unlocked / xp_for)
-- as frozen — not redefined here.
--
-- Error convention (contract §6): raise exception using
-- message = '<snake_case_code>' — exactly one code token, no interpolated
-- values in message; detail carries static context only, never user
-- content (the submitted take text is never echoed in an error detail, nor
-- in any success return outside its own evolved_takes insert).
--
-- Grant-wall convention (0004's precedent): revoke execute on every
-- function here from the roles NOT in its contract-listed audience
-- (naming anon/authenticated explicitly, not just PUBLIC — ALTER DEFAULT
-- PRIVILEGES on the real Supabase stack grants execute to anon/authenticated
-- at creation time, so a PUBLIC-only revoke would leave those standing).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ob_catalog (D-012 §4) — server-side OB registry
-- ═══════════════════════════════════════════════════════════════════════════

create table public.ob_catalog (
  ob_id            text primary key,
  topic_id         text not null references public.topics_catalog,
  required         boolean not null,
  position         int not null,            -- index within the topic (0 = required OB)
  standard_options text[] not null          -- the preset evolved-take texts, verbatim from content JSON
);

alter table public.ob_catalog enable row level security;
-- Zero policies: default-deny, same stance as topics_catalog / quiz_answer_keys
-- (D-008 §4). The client reads content JSON directly; only RPCs (running as
-- table owner via SECURITY DEFINER, which bypasses RLS and needs no explicit
-- GRANT — same as 0004's RPCs reading topics_catalog/quiz_answer_keys with
-- zero grants) read this registry server-side. Seeded by content:seed (H1's
-- extension, this chunk) — topics_catalog rows land before ob_catalog rows
-- in the generated SQL (FK).

-- ═══════════════════════════════════════════════════════════════════════════
-- evolved_takes.excluded (D-012 §5)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.evolved_takes add column excluded boolean not null default false;
-- Admin exclusion flag (G2/P1 toggle UI — not this chunk). get_ob_comparison
-- below filters excluded = false out of both n and every bucket, matching
-- the stance nuance_sessions already carried in 0001.

-- ═══════════════════════════════════════════════════════════════════════════
-- public.complete_opinion_builder — S1 { snapshot, xp_awarded }
-- ═══════════════════════════════════════════════════════════════════════════
-- Check order (B3 spec, verbatim):
--   1. auth guard; param types (cold_take, evolved_take, is_custom)
--   2. unknown_topic → locked_topic (topic-level, via topic_unlocked)
--   3. unknown_ob: ob_id ∉ ob_catalog OR ob_catalog.topic_id ≠ topic_id
--      (the pair check — D-011 ruling 3)
--   4. preset-integrity (D-012 §4): is_custom=false ⇒ evolved_take must be
--      one of the OB's standard_options exactly, else invalid_params
--   5. required-before-optional (D-012 §4): this OB optional, the topic's
--      required OB not yet completed → locked_topic (detail-annotated; the
--      frozen 14-code registry has no OB-ordering code — this is the ruled
--      "not yet unlocked for this user, state-transition check" reading)
--   6. replay pre-check (flag already completed, OR an evolved_takes row
--      already exists for (user, ob)) → success, xp_awarded 0, NO writes —
--      the original take is kept even if the replay carries different text;
--      a raw 23505 must never surface
--   7. first completion, one transaction: insert evolved_takes + set the
--      opinion_builders flag (sparse write) + award XP + touch updated_at
--
-- XP: xp_for('opinion_builder') always, + xp_for('opinion_builder_bonus')
-- iff is_custom AND char_length(evolved_take) >= 50 — one number (100 / 300
-- / 0 on replay). The bonus threshold is server-side only (contract §4/B3).

create function public.complete_opinion_builder(
  topic_id      text,
  ob_id         text,
  cold_take     text,
  evolved_take  text,
  is_custom     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user              uuid;
  v_topics            jsonb;
  v_opinion_builders  jsonb;
  v_ob_topic_id       text;
  v_ob_required       boolean;
  v_standard_options  text[];
  v_required_ob_id    text;
  v_xp                int;
begin
  -- 1a. auth guard (defensive-only, D-011: the grant wall normally fires first)
  v_user := auth.uid();
  if v_user is null then
    raise exception using
      message = 'not_authenticated',
      detail  = 'auth.uid() is null inside an authenticated-only RPC';
  end if;

  -- 1b. param types
  if cold_take is null or cold_take not in ('yes', 'no') then
    raise exception using
      message = 'invalid_params',
      detail  = 'cold_take must be exactly ''yes'' or ''no''';
  end if;
  if evolved_take is null or char_length(evolved_take) = 0 or char_length(evolved_take) > 2000 then
    raise exception using
      message = 'invalid_params',
      detail  = 'evolved_take must be non-empty text of at most 2000 characters';
  end if;
  if is_custom is null then
    raise exception using
      message = 'invalid_params',
      detail  = 'is_custom must be a non-null boolean';
  end if;
  if topic_id is null or length(topic_id) = 0 then
    raise exception using
      message = 'invalid_params',
      detail  = 'topic_id must be non-empty text';
  end if;

  -- 2a. unknown_topic
  if not exists (select 1
                   from public.topics_catalog tc
                  where tc.topic_id = complete_opinion_builder.topic_id) then
    raise exception using
      message = 'unknown_topic',
      detail  = 'topic_id is not present in topics_catalog';
  end if;

  -- Lock the caller's progress row for the rest of the transaction (a
  -- concurrent duplicate call serializes here and lands on the replay path
  -- — no raw 23505 can surface).
  select p.topics, p.opinion_builders
    into strict v_topics, v_opinion_builders
    from public.progress p
   where p.id = v_user
     for update;

  -- 2b. locked_topic (topic-level)
  if not public.topic_unlocked(v_topics, topic_id) then
    raise exception using
      message = 'locked_topic',
      detail  = 'topic is not yet unlocked for this user';
  end if;

  -- 3. unknown_ob: ob_id unknown, or paired with a different topic
  --    (D-011 ruling 3 — the pair check).
  select oc.topic_id, oc.required, oc.standard_options
    into v_ob_topic_id, v_ob_required, v_standard_options
    from public.ob_catalog oc
   where oc.ob_id = complete_opinion_builder.ob_id;

  if v_ob_topic_id is null or v_ob_topic_id <> topic_id then
    raise exception using
      message = 'unknown_ob',
      detail  = 'ob_id is not present in ob_catalog, or is not paired with topic_id';
  end if;

  -- 4. preset-integrity check (D-012 §4).
  if not is_custom and not (evolved_take = any (v_standard_options)) then
    raise exception using
      message = 'invalid_params',
      detail  = 'is_custom=false requires evolved_take to exactly match one of the OB''s registered standard_options';
  end if;

  -- 5. required-before-optional (D-012 §4) → locked_topic, not a new code.
  if not v_ob_required then
    select oc.ob_id
      into v_required_ob_id
      from public.ob_catalog oc
     where oc.topic_id = complete_opinion_builder.topic_id
       and oc.required
     limit 1;

    if v_required_ob_id is not null
       and coalesce(v_opinion_builders -> v_required_ob_id ->> 'completed', 'false') <> 'true' then
      raise exception using
        message = 'locked_topic',
        detail  = 'required opinion builder not yet completed';
    end if;
  end if;

  -- 6. replay pre-check: flag already completed, or an evolved_takes row
  --    already exists for (user, ob) → success, xp_awarded 0, NO writes.
  --    The original take is kept even if the replay carries different text.
  if coalesce(v_opinion_builders -> ob_id ->> 'completed', 'false') = 'true'
     or exists (select 1
                  from public.evolved_takes et
                 where et.user_id = v_user
                   and et.opinion_builder_id = complete_opinion_builder.ob_id) then
    return jsonb_build_object(
      'snapshot',   public.progress_snapshot(v_user),
      'xp_awarded', 0
    );
  end if;

  -- 7. first completion, one transaction.
  v_xp := public.xp_for('opinion_builder');
  if is_custom and char_length(evolved_take) >= 50 then
    v_xp := v_xp + public.xp_for('opinion_builder_bonus');
  end if;

  insert into public.evolved_takes (
    user_id, topic_id, opinion_builder_id, cold_take, evolved_take,
    is_custom, is_imported, xp_earned
  ) values (
    v_user, topic_id, ob_id, cold_take, evolved_take,
    is_custom, false, v_xp
  );

  v_opinion_builders := v_opinion_builders
                         || jsonb_build_object(ob_id, jsonb_build_object('completed', true));

  update public.progress p
     set opinion_builders = v_opinion_builders,
         total_xp         = p.total_xp + v_xp,
         updated_at       = now()
   where p.id = v_user;

  return jsonb_build_object(
    'snapshot',   public.progress_snapshot(v_user),
    'xp_awarded', v_xp
  );
end;
$$;

revoke execute on function public.complete_opinion_builder(text, text, text, text, boolean) from public, anon;
grant execute on function public.complete_opinion_builder(text, text, text, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- public.get_ob_comparison — S3 gated aggregate
-- ═══════════════════════════════════════════════════════════════════════════
-- Read-only, anon + authenticated. n = count of evolved_takes rows for
-- ob_id where excluded = false (imported rows count — genuine user takes).
-- n < 10, INCLUDING an unknown ob_id (which naturally computes n = 0 — no
-- ob_catalog lookup happens here at all, so this can never become a
-- catalog-enumeration oracle, D-011) → { n, gated: true }. Else the open
-- shape: cold yes/no counts, evolved takes grouped by exact text (custom
-- text is NEVER selected, let alone returned), custom_count. One CTE-based
-- statement so n / cold / evolved / custom_count all read the identical row
-- set (one query's snapshot), rather than risking drift from a concurrent
-- write landing between separate SELECTs.

create function public.get_ob_comparison(ob_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with rows as (
    select et.cold_take, et.is_custom, et.evolved_take
      from public.evolved_takes et
     where et.opinion_builder_id = ob_id
       and et.excluded = false
  ),
  agg as (
    select count(*)                                   as n,
           count(*) filter (where cold_take = 'yes')   as yes,
           count(*) filter (where cold_take = 'no')    as no,
           count(*) filter (where is_custom)           as custom_count
      from rows
  ),
  buckets as (
    select evolved_take, count(*) as cnt
      from rows
     where not is_custom
     group by evolved_take
  )
  select case
           when agg.n < 10 then
             jsonb_build_object('n', agg.n, 'gated', true)
           else
             jsonb_build_object(
               'n',            agg.n,
               'gated',        false,
               'cold',         jsonb_build_object('yes', agg.yes, 'no', agg.no),
               'evolved',      coalesce(
                                  (select jsonb_agg(jsonb_build_object('take', b.evolved_take, 'count', b.cnt)
                                                     order by b.cnt desc, b.evolved_take asc)
                                     from buckets b),
                                  '[]'::jsonb
                                ),
               'custom_count', agg.custom_count
             )
         end
    from agg;
$$;

revoke execute on function public.get_ob_comparison(text) from public;
grant execute on function public.get_ob_comparison(text) to anon, authenticated;

commit;

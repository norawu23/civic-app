#!/usr/bin/env node
// tests/rpc/b5-import-events-deletion.test.mjs
//
// Required tests (docs/specs/B5-import-events-deletion.md): integration
// suite for 0008_rpc_import_events_deletion.sql — import_guest_snapshot /
// log_event / delete_account:
//
//   * Import happy paths: empty fresh-guest envelope (just anon_id +
//     baseline) -> xp 0, baseline linked, replay-idempotent thereafter;
//     mid-progress envelope -> correct derived XP, flags landed,
//     is_imported/imported_from_guest true
//   * Perfect-bonus derivation: quizScore = key length -> +25; length-1 ->
//     no bonus; quizScore=99 -> no bonus
//   * Preset-downgrade: is_custom:false + non-registry text -> imported as
//     custom, correct XP, text never surfaces through B3's
//     get_ob_comparison (cross-test)
//   * Forged-XP clamp: maximal forged envelope -> exactly 4000;
//     state.total_xp ignored; OB flag without take mints 0
//   * Replay-before-refusal: import -> replay -> S1 xp:0, no duplicate
//     takes; real play (complete_flashcards) then import -> progress_not_empty;
//     streak-only (check_streak) then import -> succeeds
//   * Baseline linking: anon baseline gains user_id; day-30 clock survives
//     (cross-test with B4's submit_nuance_session); rows linked to another
//     account untouched, import still succeeds
//   * invalid_snapshot battery: wrong v, missing/malformed anon_id, unknown
//     topic, unknown/mispaired ob, cold_take='maybe', non-boolean flag,
//     duplicate takes, 2001-char take — each refused with zero partial
//     writes (row-count proof)
//   * log_event: allowlisted insert w/ correct identity column;
//     off-allowlist -> event_not_allowed; 501st event of the UTC day ->
//     event_quota_exceeded; anon without anon_id -> invalid_params; stored
//     props carry no anon_id key; quota identity separation
//   * delete_account: fully-populated user -> zero rows in
//     profiles/progress/evolved_takes/nuance_sessions, auth.users row gone,
//     events survive with user_id null
//   * Grant wall: anon calling import_guest_snapshot/delete_account ->
//     permission denied; signature conformance vs the frozen contract
//
// Requires Docker (supabase CLI local stack) + psql, OR an externally
// provisioned database via CIVIC_TEST_DB_URL (tests/lib/pg-local-stub.sql +
// migrations 0001->0008, per CLAUDE.md D-017). SKIPs (exit 0), not fails,
// when neither is available.
//
// Content seeding: applies H1/B3's content:seed output itself (idempotent),
// so it runs against a bare post-migration stack with no extra setup step.
// topic/ob ids + answer-key lengths are read back from the seeded DB.
//
// Run: node tests/rpc/b5-import-events-deletion.test.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  hasDocker, hasExternalDb, acquireDb, psql,
} from '../lib/supabase-stack.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function hasPsql() {
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

if (!hasExternalDb() && !hasDocker()) {
  console.log('SKIP rpc/b5-import-events-deletion: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rpc/b5-import-events-deletion: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

// ── fixture identities (fixed, readable; decimal-only suffixes so every
// character is a valid hex digit — same convention as b1/b3/b4) ────────────
const U_EMPTY        = 'b5000000-0000-0000-0000-000000000001' // empty envelope happy path + replay
const U_MID          = 'b5000000-0000-0000-0000-000000000002' // mid-progress envelope
const U_PERFECT      = 'b5000000-0000-0000-0000-000000000003' // perfect-bonus derivation battery
const U_DOWNGRADE    = 'b5000000-0000-0000-0000-000000000004' // preset-downgrade cross-test
const U_MAXFORGE     = 'b5000000-0000-0000-0000-000000000005' // forged-XP clamp (exactly 4000)
const U_NOFLAGTAKE   = 'b5000000-0000-0000-0000-000000000006' // OB flag without take mints 0
const U_REALPLAY     = 'b5000000-0000-0000-0000-000000000007' // real play -> progress_not_empty
const U_STREAKONLY   = 'b5000000-0000-0000-0000-000000000008' // streak-only -> import succeeds
const U_BASELINK     = 'b5000000-0000-0000-0000-000000000009' // baseline linking + day-30 cross-test
const U_OTHERACCT_A  = 'b5000000-0000-0000-0000-000000000010' // owns a linked anon baseline
const U_OTHERACCT_B  = 'b5000000-0000-0000-0000-000000000011' // imports with the SAME anon_id (must be skipped)
const U_ERR          = 'b5000000-0000-0000-0000-000000000012' // invalid_snapshot battery, zero-write proof
const U_EVT_AUTHED   = 'b5000000-0000-0000-0000-000000000013' // log_event authed identity + quota
const U_DELETE       = 'b5000000-0000-0000-0000-000000000014' // delete_account full cascade

const ANON_EMPTY      = 'a5000000-0000-4000-8000-000000000001'
const ANON_MID        = 'a5000000-0000-4000-8000-000000000002'
const ANON_MAXFORGE    = 'a5000000-0000-4000-8000-000000000005'
const ANON_BASELINK   = 'a5000000-0000-4000-8000-000000000009'
const ANON_OTHERACCT  = 'a5000000-0000-4000-8000-000000000010'
const ANON_LOGEVT     = 'a5000000-0000-4000-8000-000000000013'
const ANON_QUOTASEP   = 'a5000000-0000-4000-8000-000000000099'

let failed = false
const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} rpc/b5-import-events-deletion: ${name}${ok ? '' : ` — ${String(detail ?? '').slice(0, 500)}`}`)
}

// Minimal service-role auth.users insert (same recipe as tests/rpc/b1/b3/b4
// and tests/auth/*, kept duplicated per this repo's self-contained-test-file
// convention). The A2 on_auth_user_created trigger auto-creates the
// profiles + progress rows.
function authUserInsert(id, username) {
  return `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${username}@b5-test.local', '', now(), '{"provider":"email","providers":["email"]}',
      '{"username":"${username}","birth_year":"1990"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  `
}

function asRole(dbUrl, role, jwtSub, sql) {
  const preamble = jwtSub
    ? `set role ${role}; set request.jwt.claims = '{"sub":"${jwtSub}","role":"${role}"}';`
    : `set role ${role};`
  return spawnSync('psql', [dbUrl, '-t', '-A', '-c', `${preamble} ${sql}`], { encoding: 'utf8' })
}

function su(dbUrl, sql) {
  return spawnSync('psql', [dbUrl, '-t', '-A', '-c', sql], { encoding: 'utf8' })
}

const esc = (s) => s.replace(/'/g, "''")

// Calls an RPC as a given role (+ optional jwt sub) and parses the jsonb
// return. Returns { json } on success or { errorCode, stderr } on failure.
function rpc(dbUrl, role, jwtSub, call) {
  const r = asRole(dbUrl, role, jwtSub, `select ${call};`)
  if (r.status !== 0) {
    const m = r.stderr.match(/ERROR: {1,2}([^\n]*)/)
    return { errorCode: m ? m[1].trim() : null, stderr: r.stderr }
  }
  const lines = r.stdout.trim().split('\n')
  try {
    return { json: JSON.parse(lines[lines.length - 1]) }
  } catch (e) {
    return { errorCode: null, stderr: `unparseable RPC output: ${r.stdout}` }
  }
}

function importCall(dbUrl, userId, envelope) {
  const json = esc(JSON.stringify(envelope))
  return rpc(dbUrl, 'authenticated', userId, `public.import_guest_snapshot('${json}'::jsonb)`)
}

function progressRow(dbUrl, userId) {
  const r = su(dbUrl, `select to_jsonb(p) from public.progress p where p.id = '${userId}';`)
  if (r.status !== 0) throw new Error(`progressRow read failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim())
}

function evolvedTakesForUser(dbUrl, userId) {
  const r = su(dbUrl, `select coalesce(jsonb_agg(to_jsonb(et) order by et.id), '[]'::jsonb) from public.evolved_takes et where et.user_id = '${userId}';`)
  if (r.status !== 0) throw new Error(`evolved_takes read failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim())
}

function count(dbUrl, sql) {
  const r = su(dbUrl, sql)
  if (r.status !== 0) throw new Error(`count query failed: ${r.stderr}`)
  return Number(r.stdout.trim())
}

// ── envelope builders ───────────────────────────────────────────────────────

function envelope({ anonId, topics = {}, opinionBuilders = {}, evolvedTakes = [] }) {
  return {
    v: 2,
    anon_id: anonId,
    created_at: '2026-01-01T00:00:00.000Z',
    state: {
      total_xp: 999999, // must always be ignored
      topics,
      opinion_builders: opinionBuilders,
      evolved_takes: evolvedTakes,
      baseline_done: true,
    },
  }
}

function topicEntry({
  unlocked = false, currentLevel = null,
  l1Flash = false, l1Quiz = false, l1Score = null,
  l2Flash = false,
  l3Flash = false, l3Quiz = false, l3Score = null,
} = {}) {
  return {
    unlocked,
    currentLevel,
    levels: {
      1: { flashcardsComplete: l1Flash, quizComplete: l1Quiz, quizScore: l1Score },
      2: { flashcardsComplete: l2Flash },
      3: { flashcardsComplete: l3Flash, quizComplete: l3Quiz, quizScore: l3Score },
    },
  }
}

function take({ obId, topicId, coldTake = 'yes', evolvedTake, isCustom }) {
  return {
    opinion_builder_id: obId,
    topic_id: topicId,
    cold_take: coldTake,
    evolved_take: evolvedTake,
    is_custom: isCustom,
  }
}

function mkText(n, marker = '') {
  let s = marker
  while (s.length < n) s += 'the argument on the other side deserves real engagement '
  return s.slice(0, n)
}

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // ── seed content (H1/B3's generator, idempotent) ─────────────────────────
  const seedGen = spawnSync('node', [join(REPO_ROOT, 'scripts', 'content', 'seed.mjs')], { encoding: 'utf8' })
  if (seedGen.status !== 0) throw new Error(`content:seed generation failed:\n${seedGen.stderr}`)
  const seedApply = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: seedGen.stdout, encoding: 'utf8' })
  if (seedApply.status !== 0) throw new Error(`content:seed apply failed:\n${seedApply.stderr}`)

  // ── registry order + answer keys + ob_catalog, read back from the seeded DB
  const topicOrderR = su(dbUrl, `select jsonb_agg(topic_id order by position) from public.topics_catalog;`)
  const TOPIC_ORDER = JSON.parse(topicOrderR.stdout.trim())
  if (!Array.isArray(TOPIC_ORDER) || TOPIC_ORDER.length < 5) {
    throw new Error(`expected >= 5 seeded topics, got ${JSON.stringify(TOPIC_ORDER)}`)
  }

  function keyLen(topicId, level) {
    const r = su(dbUrl, `select array_length(answers, 1) from public.quiz_answer_keys where topic_id = '${topicId}' and level = ${level};`)
    return Number(r.stdout.trim())
  }
  function obsForTopic(topicId) {
    const r = su(dbUrl, `select jsonb_agg(jsonb_build_object('obId', ob_id, 'required', required, 'standardOptions', standard_options) order by position) from public.ob_catalog where topic_id = '${topicId}';`)
    return JSON.parse(r.stdout.trim())
  }

  const ALL_OBS = [] // flat list of { obId, topicId, standardOptions }
  for (const t of TOPIC_ORDER) {
    for (const o of obsForTopic(t)) {
      ALL_OBS.push({ obId: o.obId, topicId: t, standardOptions: o.standardOptions })
    }
  }
  record('seeder: 10 ob_catalog rows present (2 per topic x 5 topics)', ALL_OBS.length === 10, ALL_OBS.length)

  // ── seed fixture users ────────────────────────────────────────────────────
  const allUserIds = [
    U_EMPTY, U_MID, U_PERFECT, U_DOWNGRADE, U_MAXFORGE, U_NOFLAGTAKE,
    U_REALPLAY, U_STREAKONLY, U_BASELINK, U_OTHERACCT_A, U_OTHERACCT_B,
    U_ERR, U_EVT_AUTHED, U_DELETE,
  ]
  const seedUsersSql = allUserIds.map((id, i) => authUserInsert(id, `b5_u${i}`)).join('\n')
  const seed = psql(dbUrl, seedUsersSql)
  if (seed.status !== 0) throw new Error(`fixture seed failed:\n${seed.stdout}\n${seed.stderr}`)

  // ═══ signature conformance ═════════════════════════════════════════════════
  {
    const sig = su(dbUrl, `
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' secdef=' || p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('import_guest_snapshot','log_event','delete_account')
      order by p.proname;`)
    const got = sig.stdout.trim().split('\n').map((l) => l.trim()).sort()
    const want = [
      'delete_account() -> jsonb secdef=true',
      'import_guest_snapshot(snapshot jsonb) -> jsonb secdef=true',
      'log_event(name text, props jsonb) -> jsonb secdef=true',
    ]
    record('signatures: names, param names/types, returns jsonb, SECURITY DEFINER — verbatim vs frozen contract',
      JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
  }

  // ═══ grant wall + PUBLIC revoke ═════════════════════════════════════════════
  {
    const grants = [
      ['import_guest_snapshot(jsonb)', 'authenticated', 't'],
      ['import_guest_snapshot(jsonb)', 'anon', 'f'],
      ['log_event(text, jsonb)', 'anon', 't'],
      ['log_event(text, jsonb)', 'authenticated', 't'],
      ['delete_account()', 'authenticated', 't'],
      ['delete_account()', 'anon', 'f'],
      ['event_daily_quota()', 'anon', 'f'],
      ['event_daily_quota()', 'authenticated', 'f'],
    ]
    for (const [fn, role, expected] of grants) {
      const r = su(dbUrl, `select has_function_privilege('${role}', 'public.${fn}', 'execute');`)
      record(`grants: ${role} EXECUTE on ${fn} = ${expected === 't' ? 'granted' : 'DENIED'}`,
        r.status === 0 && r.stdout.trim() === expected, `got ${r.stdout.trim()} ${r.stderr}`)
    }
    const pub = su(dbUrl, `
      select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'public'
        and p.proname in ('import_guest_snapshot','log_event','delete_account','event_daily_quota')
        and a.grantee = 0;`)
    record('grants: PUBLIC has EXECUTE on none of the four B5 functions', pub.status === 0 && pub.stdout.trim() === '0', pub.stdout + pub.stderr)
  }
  {
    const r = asRole(dbUrl, 'anon', null, `select public.import_guest_snapshot('{}'::jsonb);`)
    const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
    record('grant wall: anon import_guest_snapshot → permission denied', denied, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'anon', null, `select public.delete_account();`)
    const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
    record('grant wall: anon delete_account → permission denied', denied, r.stdout + r.stderr)
  }
  {
    // Defensive in-body guard: authenticated role but no JWT sub → not_authenticated.
    const r = asRole(dbUrl, 'authenticated', null, `select public.import_guest_snapshot('{}'::jsonb);`)
    const ok = r.status !== 0 && /ERROR: {1,2}not_authenticated/.test(r.stderr)
    record('auth guard: authenticated role with null auth.uid() → not_authenticated (import)', ok, r.stdout + r.stderr)
  }

  // ═══ import happy path: empty fresh-guest envelope ═════════════════════════
  {
    // Seed an anon baseline row for the linking assertion.
    const s = su(dbUrl, `insert into public.nuance_sessions (anon_id, kind, answers, score) values ('${ANON_EMPTY}', 'baseline', '[]'::jsonb, 1);`)
    if (s.status !== 0) throw new Error(`baseline seed failed: ${s.stderr}`)

    const env = envelope({ anonId: ANON_EMPTY })
    const r = importCall(dbUrl, U_EMPTY, env)
    record('empty envelope: succeeds', Boolean(r.json), r.stderr)
    record('empty envelope: xp_awarded = 0', r.json?.xp_awarded === 0, JSON.stringify(r.json))
    record('empty envelope: envelope is exactly {snapshot, xp_awarded}',
      r.json && JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['snapshot', 'xp_awarded']), JSON.stringify(r.json))

    const row = progressRow(dbUrl, U_EMPTY)
    record('empty envelope: imported_from_guest = true, total_xp = 0', row.imported_from_guest === true && row.total_xp === 0, JSON.stringify(row))

    const linked = count(dbUrl, `select count(*) from public.nuance_sessions where anon_id = '${ANON_EMPTY}' and user_id = '${U_EMPTY}';`)
    record('empty envelope: baseline linked (user_id set on the anon row)', linked === 1, linked)

    // Replay-idempotent thereafter.
    const before = progressRow(dbUrl, U_EMPTY)
    const replay = importCall(dbUrl, U_EMPTY, env)
    record('empty envelope: replay is idempotent success, xp_awarded 0', replay.json?.xp_awarded === 0, JSON.stringify(replay.json))
    const after = progressRow(dbUrl, U_EMPTY)
    record('empty envelope: replay writes nothing (row unchanged)', JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  }

  // ═══ import happy path: mid-progress envelope ══════════════════════════════
  {
    const [T1] = TOPIC_ORDER
    const ob = ALL_OBS.find((o) => o.topicId === T1)
    const topics = {
      [T1]: topicEntry({ unlocked: true, currentLevel: 2, l1Flash: true, l1Quiz: true, l1Score: keyLen(T1, 1) }),
    }
    const opinion_builders = { [ob.obId]: { completed: true } }
    const evolved_takes = [take({ obId: ob.obId, topicId: T1, evolvedTake: ob.standardOptions[0], isCustom: false })]
    const env = envelope({ anonId: ANON_MID, topics, opinionBuilders: opinion_builders, evolvedTakes: evolved_takes })

    const r = importCall(dbUrl, U_MID, env)
    // 50 (flashcards) + 50 + 25 (perfect quiz) + 100 (ob preset) = 225
    record('mid-progress envelope: xp_awarded = 225 (50 flash + 50+25 quiz perfect + 100 ob)', r.json?.xp_awarded === 225, JSON.stringify(r.json))

    const row = progressRow(dbUrl, U_MID)
    record('mid-progress envelope: flags landed (topics + opinion_builders persisted)',
      row.topics?.[T1]?.levels?.['1']?.flashcardsComplete === true
      && row.opinion_builders?.[ob.obId]?.completed === true, JSON.stringify(row))
    record('mid-progress envelope: imported_from_guest = true, total_xp = 225', row.imported_from_guest === true && row.total_xp === 225, JSON.stringify(row))

    const takes = evolvedTakesForUser(dbUrl, U_MID)
    record('mid-progress envelope: take row is_imported = true, is_custom preserved (preset)',
      takes.length === 1 && takes[0].is_imported === true && takes[0].is_custom === false, JSON.stringify(takes))
  }

  // ═══ perfect-bonus derivation battery ═══════════════════════════════════════
  {
    const [T1] = TOPIC_ORDER
    const len = keyLen(T1, 1)
    const topics = {
      [T1]: topicEntry({ l1Quiz: true, l1Score: len }),
    }
    const r = importCall(dbUrl, U_PERFECT, envelope({ anonId: 'a5000000-0000-4000-8000-000000000030', topics }))
    record(`perfect bonus: quizScore = key length (${len}) → +25 (xp = 75)`, r.json?.xp_awarded === 75, JSON.stringify(r.json))
  }

  // Boundary battery needs three fresh users; seed them explicitly here.
  {
    const U_BONUS_EXACT = 'b5000000-0000-0000-0000-000000000032'
    const U_BONUS_MINUS1 = 'b5000000-0000-0000-0000-000000000033'
    const U_BONUS_99 = 'b5000000-0000-0000-0000-000000000034'
    const s = psql(dbUrl, [U_BONUS_EXACT, U_BONUS_MINUS1, U_BONUS_99].map((id, i) => authUserInsert(id, `b5_bonus${i}`)).join('\n'))
    if (s.status !== 0) throw new Error(`bonus-battery fixture seed failed: ${s.stderr}`)

    const [, , T3] = TOPIC_ORDER
    const len = keyLen(T3, 3)

    const exact = importCall(dbUrl, U_BONUS_EXACT, envelope({
      anonId: 'a5000000-0000-4000-8000-000000000032',
      topics: { [T3]: topicEntry({ l3Quiz: true, l3Score: len }) },
    }))
    record(`perfect bonus: L3 quizScore = key length (${len}) → +25 (xp = 75)`, exact.json?.xp_awarded === 75, JSON.stringify(exact.json))

    const minus1 = importCall(dbUrl, U_BONUS_MINUS1, envelope({
      anonId: 'a5000000-0000-4000-8000-000000000033',
      topics: { [T3]: topicEntry({ l3Quiz: true, l3Score: len - 1 }) },
    }))
    record('perfect bonus: quizScore = key length - 1 → no bonus (xp = 50)', minus1.json?.xp_awarded === 50, JSON.stringify(minus1.json))

    const ninetynine = importCall(dbUrl, U_BONUS_99, envelope({
      anonId: 'a5000000-0000-4000-8000-000000000034',
      topics: { [T3]: topicEntry({ l3Quiz: true, l3Score: 99 }) },
    }))
    record('perfect bonus: quizScore = 99 (forged, ≠ real key length) → no bonus (xp = 50)', ninetynine.json?.xp_awarded === 50, JSON.stringify(ninetynine.json))
  }

  // ═══ preset-downgrade cross-test with B3's get_ob_comparison ═══════════════
  {
    const ob = ALL_OBS[0]
    const nonRegistryText = mkText(60, 'DOWNGRADE-MARKER-')
    const env = envelope({
      anonId: 'a5000000-0000-4000-8000-000000000004',
      evolvedTakes: [take({ obId: ob.obId, topicId: ob.topicId, evolvedTake: nonRegistryText, isCustom: false })],
    })
    const r = importCall(dbUrl, U_DOWNGRADE, env)
    record('preset-downgrade: import succeeds', Boolean(r.json), r.stderr)
    record('preset-downgrade: xp = 300 (100 base + 200 bonus, downgraded to custom, len >= 50)', r.json?.xp_awarded === 300, JSON.stringify(r.json))

    const takes = evolvedTakesForUser(dbUrl, U_DOWNGRADE)
    record('preset-downgrade: stored row is_custom = true (downgraded)', takes[0]?.is_custom === true, JSON.stringify(takes))
    record('preset-downgrade: evolved_take text preserved verbatim', takes[0]?.evolved_take === nonRegistryText, JSON.stringify(takes[0]))

    // Pad the comparison fixture set to n >= 10 with direct evolved_takes
    // inserts against real seeded auth.users rows (evolved_takes.user_id is
    // FK'd to auth.users — same license as b3's suite: bypasses
    // complete_opinion_builder, which is not what's under test here) so
    // get_ob_comparison ungates.
    const padUsers = Array.from({ length: 9 }, (_, i) => `b5000000-0000-0000-0000-0000000000${50 + i}`)
    const padSeed = psql(dbUrl, padUsers.map((id, i) => authUserInsert(id, `b5_pad${i}`)).join('\n'))
    if (padSeed.status !== 0) throw new Error(`comparison-padding user seed failed: ${padSeed.stderr}`)
    for (const padUser of padUsers) {
      const insertR = psql(dbUrl, `
        insert into public.evolved_takes (user_id, topic_id, opinion_builder_id, cold_take, evolved_take, is_custom, is_imported, xp_earned)
        values ('${padUser}', '${ob.topicId}', '${ob.obId}', 'yes', '${esc(ob.standardOptions[0])}', false, false, 100);
      `)
      if (insertR.status !== 0) throw new Error(`comparison padding insert failed: ${insertR.stderr}`)
    }

    const comparison = rpc(dbUrl, 'anon', null, `public.get_ob_comparison('${ob.obId}')`)
    record('preset-downgrade: get_ob_comparison callable and open (n >= 10 after padding)', comparison.json?.gated === false, JSON.stringify(comparison))
    const responseText = JSON.stringify(comparison.json)
    record('preset-downgrade: downgraded custom text never surfaces through get_ob_comparison',
      !responseText.includes('DOWNGRADE-MARKER-'), responseText)
    record('preset-downgrade: evolved buckets only ever contain registry (standard_options) texts',
      (comparison.json?.evolved ?? []).every((b) => ob.standardOptions.includes(b.take)), responseText)
  }

  // ═══ forged-XP clamp: maximal forged envelope → exactly 4000 ══════════════
  {
    const topics = {}
    for (const t of TOPIC_ORDER) {
      topics[t] = topicEntry({
        unlocked: true, currentLevel: 3,
        l1Flash: true, l1Quiz: true, l1Score: keyLen(t, 1),
        l2Flash: true,
        l3Flash: true, l3Quiz: true, l3Score: keyLen(t, 3),
      })
    }
    const opinion_builders = {}
    const evolved_takes = []
    for (const ob of ALL_OBS) {
      opinion_builders[ob.obId] = { completed: true }
      evolved_takes.push(take({ obId: ob.obId, topicId: ob.topicId, evolvedTake: mkText(60, `MAX-${ob.obId}-`), isCustom: true }))
    }
    const env = envelope({ anonId: ANON_MAXFORGE, topics, opinionBuilders: opinion_builders, evolvedTakes: evolved_takes })
    const r = importCall(dbUrl, U_MAXFORGE, env)
    record('forged-XP clamp: maximal forged envelope → exactly 4000 XP', r.json?.xp_awarded === 4000, JSON.stringify(r.json?.xp_awarded))
    const row = progressRow(dbUrl, U_MAXFORGE)
    record('forged-XP clamp: state.total_xp (999999) never read — persisted total_xp = 4000, not 999999', row.total_xp === 4000, row.total_xp)
  }

  // ═══ OB flag without take mints 0 ═══════════════════════════════════════════
  {
    const ob = ALL_OBS[0]
    const env = envelope({
      anonId: 'a5000000-0000-4000-8000-000000000006',
      opinionBuilders: { [ob.obId]: { completed: true } },
      evolvedTakes: [],
    })
    const r = importCall(dbUrl, U_NOFLAGTAKE, env)
    record('OB flag without take mints 0 XP', r.json?.xp_awarded === 0, JSON.stringify(r.json))
    const takes = evolvedTakesForUser(dbUrl, U_NOFLAGTAKE)
    record('OB flag without take: no evolved_takes row created', takes.length === 0, JSON.stringify(takes))
  }

  // ═══ replay-before-refusal / streak-exclusion battery ══════════════════════
  {
    const [T1] = TOPIC_ORDER
    const r1 = rpc(dbUrl, 'authenticated', U_REALPLAY, `public.complete_flashcards('${T1}', 1)`)
    record('real play fixture: complete_flashcards succeeds', r1.json?.xp_awarded === 50, JSON.stringify(r1))
    const importAfterRealPlay = importCall(dbUrl, U_REALPLAY, envelope({ anonId: 'a5000000-0000-4000-8000-000000000007' }))
    record('progress_not_empty: import after real play (one complete_flashcards) → refused',
      importAfterRealPlay.errorCode === 'progress_not_empty', JSON.stringify(importAfterRealPlay))
  }
  {
    const streak = rpc(dbUrl, 'authenticated', U_STREAKONLY, `public.check_streak(0)`)
    record('streak-exclusion fixture: check_streak succeeds', Boolean(streak.json), JSON.stringify(streak))
    const importAfterStreak = importCall(dbUrl, U_STREAKONLY, envelope({ anonId: 'a5000000-0000-4000-8000-000000000008' }))
    record('streak-exclusion proof: import after ONLY check_streak → succeeds (streak columns excluded from default-state check)',
      importAfterStreak.json?.xp_awarded === 0, JSON.stringify(importAfterStreak))
  }

  // ═══ baseline linking + B4 day-30 cross-test ═══════════════════════════════
  {
    // Anon baseline submitted 40 days ago (direct SQL created_at manipulation
    // — never sleep).
    const seedBaseline = su(dbUrl, `
      insert into public.nuance_sessions (anon_id, kind, answers, score, created_at)
      values ('${ANON_BASELINK}', 'baseline', '[{"question_id":"q1","response_type":"tap","position":"yes"}]'::jsonb, 1, now() - interval '40 days');
    `)
    if (seedBaseline.status !== 0) throw new Error(`baseline-link fixture seed failed: ${seedBaseline.stderr}`)

    const imp = importCall(dbUrl, U_BASELINK, envelope({ anonId: ANON_BASELINK }))
    record('baseline linking: import succeeds', Boolean(imp.json), JSON.stringify(imp))

    const linkedCheck = su(dbUrl, `select user_id, kind from public.nuance_sessions where anon_id = '${ANON_BASELINK}';`)
    record('baseline linking: anon baseline row gains user_id', linkedCheck.stdout.trim() === `${U_BASELINK}|baseline`, linkedCheck.stdout)

    // Day-30 via B4's submit_nuance_session against the now-linked baseline.
    const day30 = rpc(dbUrl, 'authenticated', U_BASELINK, `public.submit_nuance_session('day30', '[{"question_id":"q1","response_type":"tap","position":"yes"}]'::jsonb)`)
    record('baseline linking + day-30 cross-test: submit_nuance_session(day30) succeeds against the linked baseline',
      day30.json?.accepted === true, JSON.stringify(day30))
    const elapsed = su(dbUrl, `select elapsed_days from public.nuance_sessions where user_id = '${U_BASELINK}' and kind = 'day30';`)
    record('baseline linking + day-30 cross-test: elapsed_days = 40 (the guest 30-day clock survived linking)',
      elapsed.stdout.trim() === '40', elapsed.stdout)
  }

  // ═══ rows linked to another account are untouched; import still succeeds ══
  {
    const seedOwned = su(dbUrl, `
      insert into public.nuance_sessions (user_id, anon_id, kind, answers, score)
      values ('${U_OTHERACCT_A}', '${ANON_OTHERACCT}', 'baseline', '[]'::jsonb, 1);
    `)
    if (seedOwned.status !== 0) throw new Error(`other-account fixture seed failed: ${seedOwned.stderr}`)

    const imp = importCall(dbUrl, U_OTHERACCT_B, envelope({ anonId: ANON_OTHERACCT }))
    record('other-account linking: import with an already-linked anon_id still succeeds', Boolean(imp.json), JSON.stringify(imp))

    const stillOwned = su(dbUrl, `select user_id from public.nuance_sessions where anon_id = '${ANON_OTHERACCT}';`)
    record('other-account linking: row silently skipped — still owned by the original account',
      stillOwned.stdout.trim() === U_OTHERACCT_A, stillOwned.stdout)
  }

  // ═══ invalid_snapshot battery — zero partial writes ═════════════════════════
  {
    const before = progressRow(dbUrl, U_ERR)
    const beforeTakes = count(dbUrl, `select count(*) from public.evolved_takes where user_id = '${U_ERR}';`)

    const [T1] = TOPIC_ORDER
    const ob = ALL_OBS.find((o) => o.topicId === T1)
    const anonBase = 'a5000000-0000-4000-8000-0000000000'
    let n = 40
    const cases = [
      ['wrong v', { v: 3, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [] } }],
      ['missing anon_id', { v: 2, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [] } }],
      ['malformed anon_id', { v: 2, anon_id: 'not-a-uuid', created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [] } }],
      ['unknown topic id', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: { no_such_topic: {} }, opinion_builders: {}, evolved_takes: [] } }],
      ['unknown ob', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [take({ obId: 'no-such-ob', topicId: T1, evolvedTake: mkText(60), isCustom: true })] } }],
      ['mispaired ob', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [take({ obId: ob.obId, topicId: TOPIC_ORDER[1], evolvedTake: mkText(60), isCustom: true })] } }],
      ["cold_take = 'maybe'", { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [take({ obId: ob.obId, topicId: T1, coldTake: 'maybe', evolvedTake: mkText(60), isCustom: true })] } }],
      ['non-boolean flag (unlocked)', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: { [T1]: { unlocked: 'yes' } }, opinion_builders: {}, evolved_takes: [] } }],
      ['duplicate takes (same ob_id twice)', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [take({ obId: ob.obId, topicId: T1, evolvedTake: mkText(60, 'a'), isCustom: true }), take({ obId: ob.obId, topicId: T1, evolvedTake: mkText(60, 'b'), isCustom: true })] } }],
      ['2001-char take', { v: 2, anon_id: `${anonBase}${n++}`, created_at: 'x', state: { topics: {}, opinion_builders: {}, evolved_takes: [take({ obId: ob.obId, topicId: T1, evolvedTake: 'x'.repeat(2001), isCustom: true })] } }],
    ]
    for (const [label, env] of cases) {
      const r = importCall(dbUrl, U_ERR, env)
      record(`invalid_snapshot battery: ${label} → invalid_snapshot`, r.errorCode === 'invalid_snapshot', JSON.stringify(r))
    }

    const after = progressRow(dbUrl, U_ERR)
    const afterTakes = count(dbUrl, `select count(*) from public.evolved_takes where user_id = '${U_ERR}';`)
    record('invalid_snapshot battery: zero partial writes (progress row unchanged across every refusal)',
      JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    record('invalid_snapshot battery: zero partial writes (no evolved_takes rows created)',
      beforeTakes === 0 && afterTakes === 0, `before=${beforeTakes} after=${afterTakes}`)
  }

  // ═══ log_event ══════════════════════════════════════════════════════════════
  {
    const r = rpc(dbUrl, 'authenticated', U_EVT_AUTHED, `public.log_event('app_open', null)`)
    record('log_event: authed allowlisted event inserts, ack shape exact', JSON.stringify(r.json) === '{"accepted":true}', JSON.stringify(r))
    const row = su(dbUrl, `select user_id, anon_id from public.events where user_id = '${U_EVT_AUTHED}' order by id desc limit 1;`)
    record('log_event: authed identity column correct (user_id set, anon_id null)', row.stdout.trim() === `${U_EVT_AUTHED}|`, row.stdout)
  }
  {
    const r = rpc(dbUrl, 'anon', null, `public.log_event('app_open', '{"anon_id":"${ANON_LOGEVT}","level":"taxes"}'::jsonb)`)
    record('log_event: anon allowlisted event with anon_id in props inserts', r.json?.accepted === true, JSON.stringify(r))
    const row = su(dbUrl, `select user_id, anon_id, props from public.events where anon_id = '${ANON_LOGEVT}' order by id desc limit 1;`)
    record('log_event: anon identity column correct (anon_id set, user_id null)', row.stdout.trim().startsWith(`|${ANON_LOGEVT}|`), row.stdout)
    record('log_event: stored props contain no anon_id key (stripped)', !row.stdout.includes('"anon_id"'), row.stdout)
    record('log_event: other props keys survive stripping', row.stdout.includes('"level"'), row.stdout)
  }
  {
    const r = asRole(dbUrl, 'anon', null, `select public.log_event('app_open', '{}'::jsonb);`)
    const ok = r.status !== 0 && /ERROR: {1,2}invalid_params/.test(r.stderr)
    record('log_event: anon without anon_id in props → invalid_params', ok, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'authenticated', U_EVT_AUTHED, `select public.log_event('totally_bogus_event_name', null);`)
    const ok = r.status !== 0 && /ERROR: {1,2}event_not_allowed/.test(r.stderr)
    record('log_event: off-allowlist name → event_not_allowed', ok, r.stdout + r.stderr)
  }
  {
    // Non-scalar prop value → invalid_params.
    const r = asRole(dbUrl, 'authenticated', U_EVT_AUTHED, `select public.log_event('app_open', '{"nested":{"a":1}}'::jsonb);`)
    const ok = r.status !== 0 && /ERROR: {1,2}invalid_params/.test(r.stderr)
    record('log_event: non-scalar prop value → invalid_params', ok, r.stdout + r.stderr)
  }
  {
    // Quota: seed exactly 500 for a fresh identity, then the RPC call is the 501st.
    const U_QUOTA = 'b5000000-0000-0000-0000-000000000090'
    const s = psql(dbUrl, authUserInsert(U_QUOTA, 'b5_quota'))
    if (s.status !== 0) throw new Error(`quota fixture seed failed: ${s.stderr}`)
    const seedEvents = su(dbUrl, `insert into public.events (user_id, name) select '${U_QUOTA}', 'app_open' from generate_series(1,500);`)
    if (seedEvents.status !== 0) throw new Error(`quota event seed failed: ${seedEvents.stderr}`)
    const r = asRole(dbUrl, 'authenticated', U_QUOTA, `select public.log_event('app_open', null);`)
    const ok = r.status !== 0 && /ERROR: {1,2}event_quota_exceeded/.test(r.stderr)
    record('log_event: 501st event of the UTC day → event_quota_exceeded (seed 500 directly, then RPC)', ok, r.stdout + r.stderr)

    // Identity separation: a fresh anon identity on the same UTC day is unaffected.
    const anonR = asRole(dbUrl, 'anon', null, `select public.log_event('app_open', '{"anon_id":"${ANON_QUOTASEP}"}'::jsonb);`)
    record('log_event: quota identity separation — 500 authed events do not exhaust a fresh anon identity',
      anonR.status === 0, anonR.stdout + anonR.stderr)

    // And the reverse: seed 500 for an anon identity, confirm an authed identity is unaffected.
    const ANON_QUOTA2 = 'a5000000-0000-4000-8000-000000000091'
    const seedAnonEvents = su(dbUrl, `insert into public.events (anon_id, name) select '${ANON_QUOTA2}', 'app_open' from generate_series(1,500);`)
    if (seedAnonEvents.status !== 0) throw new Error(`anon quota event seed failed: ${seedAnonEvents.stderr}`)
    const anonBlocked = asRole(dbUrl, 'anon', null, `select public.log_event('app_open', '{"anon_id":"${ANON_QUOTA2}"}'::jsonb);`)
    record('log_event: anon identity itself IS quota-limited at 500', anonBlocked.status !== 0 && /event_quota_exceeded/.test(anonBlocked.stderr), anonBlocked.stdout + anonBlocked.stderr)

    const U_QUOTA2 = 'b5000000-0000-0000-0000-000000000092'
    const s2 = psql(dbUrl, authUserInsert(U_QUOTA2, 'b5_quota2'))
    if (s2.status !== 0) throw new Error(`quota2 fixture seed failed: ${s2.stderr}`)
    const authedUnaffected = asRole(dbUrl, 'authenticated', U_QUOTA2, `select public.log_event('app_open', null);`)
    record('log_event: quota identity separation — 500 anon events do not exhaust a fresh authed identity',
      authedUnaffected.status === 0, authedUnaffected.stdout + authedUnaffected.stderr)
  }

  // ═══ delete_account: full cascade ═══════════════════════════════════════════
  {
    const [T1] = TOPIC_ORDER
    const ob = ALL_OBS[0]
    // Populate: progress (via complete_flashcards), a take, an authed
    // nuance row, a linked-anon nuance row, and an event.
    const flash = rpc(dbUrl, 'authenticated', U_DELETE, `public.complete_flashcards('${T1}', 1)`)
    record('delete_account fixture: complete_flashcards succeeds', flash.json?.xp_awarded === 50, JSON.stringify(flash))
    const evt = rpc(dbUrl, 'authenticated', U_DELETE, `public.log_event('app_open', null)`)
    record('delete_account fixture: log_event succeeds', evt.json?.accepted === true, JSON.stringify(evt))

    const seedRest = su(dbUrl, `
      insert into public.evolved_takes (user_id, topic_id, opinion_builder_id, cold_take, evolved_take, is_custom, xp_earned)
      values ('${U_DELETE}', '${ob.topicId}', '${ob.obId}', 'yes', 'a fixture take for the deletion cascade test', false, 100);
      insert into public.nuance_sessions (user_id, kind, answers, score) values ('${U_DELETE}', 'baseline', '[]'::jsonb, 1);
      insert into public.nuance_sessions (anon_id, kind, answers, score) values ('a5000000-0000-4000-8000-000000000014', 'baseline', '[]'::jsonb, 2);
      update public.nuance_sessions set user_id = '${U_DELETE}' where anon_id = 'a5000000-0000-4000-8000-000000000014';
    `)
    if (seedRest.status !== 0) throw new Error(`delete_account fixture seed failed: ${seedRest.stderr}`)

    const beforeProfiles = count(dbUrl, `select count(*) from public.profiles where id = '${U_DELETE}';`)
    const beforeProgress = count(dbUrl, `select count(*) from public.progress where id = '${U_DELETE}';`)
    const beforeTakes = count(dbUrl, `select count(*) from public.evolved_takes where user_id = '${U_DELETE}';`)
    const beforeNuance = count(dbUrl, `select count(*) from public.nuance_sessions where user_id = '${U_DELETE}';`)
    const beforeEvents = count(dbUrl, `select count(*) from public.events where user_id = '${U_DELETE}';`)
    record('delete_account fixture: fully populated before delete',
      beforeProfiles === 1 && beforeProgress === 1 && beforeTakes === 1 && beforeNuance === 2 && beforeEvents === 1,
      JSON.stringify({ beforeProfiles, beforeProgress, beforeTakes, beforeNuance, beforeEvents }))

    const del = rpc(dbUrl, 'authenticated', U_DELETE, `public.delete_account()`)
    record('delete_account: returns {deleted: true}', JSON.stringify(del.json) === '{"deleted":true}', JSON.stringify(del))

    const afterAuthUsers = count(dbUrl, `select count(*) from auth.users where id = '${U_DELETE}';`)
    const afterProfiles = count(dbUrl, `select count(*) from public.profiles where id = '${U_DELETE}';`)
    const afterProgress = count(dbUrl, `select count(*) from public.progress where id = '${U_DELETE}';`)
    const afterTakes = count(dbUrl, `select count(*) from public.evolved_takes where user_id = '${U_DELETE}';`)
    const afterNuance = count(dbUrl, `select count(*) from public.nuance_sessions where user_id = '${U_DELETE}';`)
    record('delete_account: auth.users row gone', afterAuthUsers === 0, afterAuthUsers)
    record('delete_account: zero rows in profiles/progress/evolved_takes/nuance_sessions (incl. linked-anon rows)',
      afterProfiles === 0 && afterProgress === 0 && afterTakes === 0 && afterNuance === 0,
      JSON.stringify({ afterProfiles, afterProgress, afterTakes, afterNuance }))

    const survivingEvents = count(dbUrl, `select count(*) from public.events where name = 'app_open' and user_id is null and created_at > now() - interval '5 minutes';`)
    record('delete_account: events rows remain with user_id IS NULL (anonymized, not deleted)', survivingEvents >= 1, survivingEvents)
  }
} catch (err) {
  console.error(`FAIL rpc/b5-import-events-deletion: harness error: ${err.message}\n${err.stack}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rpc/b5-import-events-deletion summary: ${results.filter((r) => r.ok).length}/${results.length} passed ===`)
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
// tests/rpc/b3-opinion-builder.test.mjs
//
// Required tests (docs/specs/B3-opinion-builder.md): integration suite for
// 0006_rpc_opinion_builder.sql — complete_opinion_builder / get_ob_comparison
// / the ob_catalog registry:
//
//   * Happy paths: required OB preset (100 XP), optional OB after required,
//     custom >=50 chars (300), custom 49 chars (100 — boundary), custom
//     exactly 50 (300)
//   * Ordering: optional before required → locked_topic; required first
//     then optional → both succeed
//   * Double-submit: identical replay and different-text replay →
//     idempotent, flag map + evolved_takes unchanged
//   * Forged inputs: cold_take = 'maybe' → invalid_params; 2001-char take →
//     invalid_params; unknown/mispaired/locked ob → unknown_ob / locked_topic,
//     zero XP minted in every case
//   * Comparison: seeded fixture set crossing n=10; anon-callable; counts
//     sum (cold.yes + cold.no = n); evolved + custom_count consistent;
//     imported rows included; excluded rows filtered; unknown ob_id →
//     {n:0, gated:true}; custom take text never returned; evolved buckets
//     only ever contain registry (standard_options) texts
//   * Grant wall: anon complete_opinion_builder → permission denied; anon
//     get_ob_comparison → callable (not denied)
//
// Requires Docker (supabase CLI local stack) + psql, OR an externally
// provisioned database via CIVIC_TEST_DB_URL (tests/lib/pg-local-stub.sql +
// migrations 0001→0006, per CLAUDE.md D-017). SKIPs (exit 0), not fails,
// when neither is available — the established convention (A1's
// deny-all-smoke precedent, mirrored by tests/rpc/b1-grading.test.mjs).
//
// Content seeding: the suite applies H1/B3's `content:seed` output itself
// (scripts/content/seed.mjs is idempotent — ON CONFLICT DO UPDATE), so it
// runs against a bare post-migration stack with no extra setup step.
// topic/ob ids are read back from topics_catalog/ob_catalog via the
// superuser connection, so this suite tracks the real content instead of
// hard-coding topic/ob ids.
//
// Run: node tests/rpc/b3-opinion-builder.test.mjs

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
  console.log('SKIP rpc/b3-opinion-builder: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rpc/b3-opinion-builder: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

// Fixed fixture UUIDs (readable; throwaway DB). Decimal-only suffixes so
// every character is a valid hex digit.
const U_PRESET_REQ       = 'b3000000-0000-0000-0000-000000000101' // required OB, preset, happy path
const U_REQ_THEN_OPT     = 'b3000000-0000-0000-0000-000000000102' // required then optional, both succeed
const U_CUSTOM_GE50      = 'b3000000-0000-0000-0000-000000000103' // custom, 60 chars -> 300 XP
const U_CUSTOM_49        = 'b3000000-0000-0000-0000-000000000104' // custom, exactly 49 chars -> 100 XP (boundary)
const U_CUSTOM_50        = 'b3000000-0000-0000-0000-000000000105' // custom, exactly 50 chars -> 300 XP (boundary)
const U_OPT_BEFORE_REQ   = 'b3000000-0000-0000-0000-000000000106' // optional attempted before required -> locked_topic
const U_REPLAY           = 'b3000000-0000-0000-0000-000000000107' // replay: identical, then different text
const U_ERR_PROBE        = 'b3000000-0000-0000-0000-000000000108' // forged/invalid input battery (writes nothing)

const CMP_USER_PREFIX    = 'b3000000-0000-0000-0000-0000000002'   // + 2-digit suffix, comparison fixture set

function cmpUser(n) {
  return `${CMP_USER_PREFIX}${String(n).padStart(2, '0')}`
}

let failed = false
const results = []

function record(name, ok, detail) {
  results.push({ name, ok })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} rpc/b3-opinion-builder: ${name}${ok ? '' : ` — ${String(detail ?? '').slice(0, 500)}`}`)
}

// Minimal service-role auth.users insert (same recipe as tests/rpc/b1-grading.test.mjs
// and tests/auth/*, kept duplicated per this repo's self-contained-test-file
// convention). The A2 on_auth_user_created trigger auto-creates the
// profiles + progress rows — progress starts at the real default:
// topics = '{}', opinion_builders = '{}'.
function authUserInsert(id, username) {
  return `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${username}@b3-test.local', '', now(), '{"provider":"email","providers":["email"]}',
      '{"username":"${username}","birth_year":"1990"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  `
}

// Runs `sql` as the given Postgres role with an optional JWT `sub` claim
// (mirrors PostgREST; auth.uid() reads request.jwt.claims). Fresh psql
// connection per call, so role/GUC never leak between checks.
function asRole(dbUrl, role, jwtSub, sql) {
  const preamble = jwtSub
    ? `set role ${role}; set request.jwt.claims = '{"sub":"${jwtSub}","role":"${role}"}';`
    : `set role ${role};`
  return spawnSync('psql', [dbUrl, '-t', '-A', '-c', `${preamble} ${sql}`], { encoding: 'utf8' })
}

function sqlQuote(str) {
  return `'${String(str).replace(/'/g, "''")}'`
}

// Builds a complete_opinion_builder(...) call string. isCustomLiteral is a
// raw SQL literal ('true' | 'false' | 'null::boolean') so the is_custom-null
// probe can be expressed without a JS boolean.
function obCall(topicId, obId, coldTake, evolvedTake, isCustomLiteral) {
  return `public.complete_opinion_builder(${sqlQuote(topicId)}, ${sqlQuote(obId)}, ${sqlQuote(coldTake)}, ${sqlQuote(evolvedTake)}, ${isCustomLiteral})`
}

// Calls an RPC as an authenticated user and parses the jsonb return.
// Returns { json } on success or { errorCode, stderr } on failure.
function rpc(dbUrl, userId, call) {
  const r = asRole(dbUrl, 'authenticated', userId, `select ${call};`)
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

// Superuser read of the full progress row as one jsonb.
function progressRow(dbUrl, userId) {
  const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select to_jsonb(p) from public.progress p where p.id = '${userId}';`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`progressRow read failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim())
}

// Superuser read of an evolved_takes row for (user, ob), or null.
function evolvedTakeRow(dbUrl, userId, obId) {
  const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select to_jsonb(et) from public.evolved_takes et where et.user_id = '${userId}' and et.opinion_builder_id = '${obId}';`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`evolved_takes read failed: ${r.stderr}`)
  const out = r.stdout.trim()
  return out ? JSON.parse(out) : null
}

function evolvedTakeCount(dbUrl, userId) {
  const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select count(*) from public.evolved_takes where user_id = '${userId}';`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`evolved_takes count failed: ${r.stderr}`)
  return Number(r.stdout.trim())
}

// Ordered ob_catalog rows for a topic (position asc): [{ obId, required, standardOptions }]
function obsForTopic(dbUrl, topicId) {
  const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select jsonb_agg(jsonb_build_object('obId', ob_id, 'required', required, 'standardOptions', standard_options) order by position) from public.ob_catalog where topic_id = '${topicId}';`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ob_catalog read failed for ${topicId}: ${r.stderr}`)
  return JSON.parse(r.stdout.trim())
}

// Direct (superuser) evolved_takes insert — used ONLY to build the
// get_ob_comparison fixture set, bypassing complete_opinion_builder (whose
// write path is exercised separately above) so comparison tests don't need
// every fixture user's topic unlocked.
function insertEvolvedTakeDirect(dbUrl, { userId, topicId, obId, coldTake, evolvedTake, isCustom, isImported = false, excluded = false }) {
  const r = psql(dbUrl, `
    insert into public.evolved_takes (user_id, topic_id, opinion_builder_id, cold_take, evolved_take, is_custom, is_imported, excluded, xp_earned)
    values ('${userId}', '${topicId}', '${obId}', '${coldTake}', ${sqlQuote(evolvedTake)}, ${isCustom}, ${isImported}, ${excluded}, 100);
  `)
  if (r.status !== 0) throw new Error(`direct evolved_takes insert failed: ${r.stdout}\n${r.stderr}`)
}

function setExcluded(dbUrl, userId, obId, excluded) {
  const r = psql(dbUrl, `
    update public.evolved_takes set excluded = ${excluded}
     where user_id = '${userId}' and opinion_builder_id = '${obId}';
  `)
  if (r.status !== 0) throw new Error(`excluded update failed: ${r.stdout}\n${r.stderr}`)
}

function comparisonCall(dbUrl, role, jwtSub, obId) {
  const r = asRole(dbUrl, role, jwtSub, `select public.get_ob_comparison('${obId}');`)
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

// Deterministic filler text of exactly n chars, plain ASCII (no quotes),
// with an optional distinctive marker prefix (for "text never returned"
// checks — marker uniquely fingerprints one user's custom submission).
function mkText(n, marker = '') {
  let s = marker
  while (s.length < n) s += 'the argument on the other side deserves real engagement '
  return s.slice(0, n)
}

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // ── seed content (H1's generator, B3-extended, idempotent) ────────────────
  const seedGen = spawnSync('node', [join(REPO_ROOT, 'scripts', 'content', 'seed.mjs')], { encoding: 'utf8' })
  if (seedGen.status !== 0) throw new Error(`content:seed generation failed:\n${seedGen.stderr}`)
  const seedApply = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: seedGen.stdout, encoding: 'utf8' })
  if (seedApply.status !== 0) throw new Error(`content:seed apply failed:\n${seedApply.stderr}`)

  // ── registry order, read back from the seeded DB ───────────────────────────
  const catalogRead = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select jsonb_agg(topic_id order by position) from public.topics_catalog;`], { encoding: 'utf8' })
  if (catalogRead.status !== 0) throw new Error(`catalog read failed: ${catalogRead.stderr}`)
  const TOPIC_ORDER = JSON.parse(catalogRead.stdout.trim())
  if (!Array.isArray(TOPIC_ORDER) || TOPIC_ORDER.length < 2) {
    throw new Error(`expected >= 2 seeded topics, got ${JSON.stringify(TOPIC_ORDER)}`)
  }
  const [TOPIC1, TOPIC2] = TOPIC_ORDER // TOPIC1 unlocked by default (position 0); TOPIC2 locked

  const obCatalogCount = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select count(*) from public.ob_catalog;`], { encoding: 'utf8' })
  record('seeder: 10 ob_catalog rows present in the seeded DB', obCatalogCount.stdout.trim() === '10', obCatalogCount.stdout)

  const topic1Obs = obsForTopic(dbUrl, TOPIC1)
  const topic2Obs = obsForTopic(dbUrl, TOPIC2)
  if (!Array.isArray(topic1Obs) || topic1Obs.length !== 2 || !Array.isArray(topic2Obs) || topic2Obs.length !== 2) {
    throw new Error(`expected exactly 2 obs per topic; topic1=${JSON.stringify(topic1Obs)} topic2=${JSON.stringify(topic2Obs)}`)
  }
  const OB1_REQ = topic1Obs.find((o) => o.required)
  const OB1_OPT = topic1Obs.find((o) => !o.required)
  const OB2_REQ = topic2Obs.find((o) => o.required)
  if (!OB1_REQ || !OB1_OPT || !OB2_REQ) {
    throw new Error(`expected one required + one optional OB per topic; topic1=${JSON.stringify(topic1Obs)} topic2=${JSON.stringify(topic2Obs)}`)
  }
  const CMP_OB = OB2_REQ.obId // used only by the comparison fixture set below (direct inserts, topic lock irrelevant)

  // ── seed fixture users ──────────────────────────────────────────────────
  const allUserIds = [
    U_PRESET_REQ, U_REQ_THEN_OPT, U_CUSTOM_GE50, U_CUSTOM_49, U_CUSTOM_50,
    U_OPT_BEFORE_REQ, U_REPLAY, U_ERR_PROBE,
    ...Array.from({ length: 12 }, (_, i) => cmpUser(i + 1)),
  ]
  const seedUsersSql = allUserIds.map((id, i) => authUserInsert(id, `b3_u${i}`)).join('\n')
  const seed = psql(dbUrl, seedUsersSql)
  if (seed.status !== 0) throw new Error(`fixture seed failed:\n${seed.stdout}\n${seed.stderr}`)

  // ═══ grant wall ═══════════════════════════════════════════════════════════
  {
    const r = asRole(dbUrl, 'anon', null, `select ${obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false')};`)
    const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
    const notBodyError = !/not_authenticated/.test(r.stderr)
    record('grant wall: anon complete_opinion_builder → permission denied (not not_authenticated)', denied && notBodyError, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'authenticated', null, `select ${obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false')};`)
    const ok = r.status !== 0 && /ERROR: {1,2}not_authenticated/.test(r.stderr)
    record('auth guard: authenticated role with null auth.uid() → not_authenticated', ok, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'anon', null, `select public.get_ob_comparison('${OB1_REQ.obId}');`)
    const ok = r.status === 0
    record('grant wall: anon get_ob_comparison → callable (anon-callable per contract)', ok, r.stdout + r.stderr)
  }

  // ═══ happy path: required OB preset (100 XP) ═══════════════════════════════
  {
    const before = progressRow(dbUrl, U_PRESET_REQ)
    record('fixture: fresh progress row has opinion_builders = {} and total_xp = 0',
      JSON.stringify(before.opinion_builders) === '{}' && before.total_xp === 0, JSON.stringify(before))

    const r = rpc(dbUrl, U_PRESET_REQ, obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false'))
    record('preset happy path: required OB completes', Boolean(r.json), r.stderr)
    if (r.json) {
      record('preset happy path: envelope is exactly {snapshot, xp_awarded}',
        JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['snapshot', 'xp_awarded']), JSON.stringify(r.json))
      record('preset happy path: xp_awarded = 100', r.json.xp_awarded === 100, JSON.stringify(r.json.xp_awarded))
      record('preset happy path: snapshot.opinion_builders flag sparse {completed:true}',
        r.json.snapshot?.opinion_builders?.[OB1_REQ.obId]?.completed === true
        && Object.keys(r.json.snapshot?.opinion_builders?.[OB1_REQ.obId] ?? {}).length === 1,
        JSON.stringify(r.json.snapshot?.opinion_builders))
    }
    const row = evolvedTakeRow(dbUrl, U_PRESET_REQ, OB1_REQ.obId)
    record('preset happy path: evolved_takes row persisted (is_custom=false, is_imported=false, xp_earned=100)',
      row && row.is_custom === false && row.is_imported === false && row.xp_earned === 100 && row.cold_take === 'yes',
      JSON.stringify(row))
    const after = progressRow(dbUrl, U_PRESET_REQ)
    record('preset happy path: total_xp = 100 persisted', after.total_xp === 100, JSON.stringify(after.total_xp))
  }

  // ═══ ordering: required then optional — both succeed ══════════════════════
  {
    const r1 = rpc(dbUrl, U_REQ_THEN_OPT, obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false'))
    record('ordering: required OB completes first', r1.json?.xp_awarded === 100, r1.stderr ?? JSON.stringify(r1.json))

    const r2 = rpc(dbUrl, U_REQ_THEN_OPT, obCall(TOPIC1, OB1_OPT.obId, 'no', OB1_OPT.standardOptions[0], 'false'))
    record('ordering: optional OB completes after required', r2.json?.xp_awarded === 100, r2.stderr ?? JSON.stringify(r2.json))

    const row = progressRow(dbUrl, U_REQ_THEN_OPT)
    record('ordering: total_xp = 200 after both, both flags completed',
      row.total_xp === 200
      && row.opinion_builders?.[OB1_REQ.obId]?.completed === true
      && row.opinion_builders?.[OB1_OPT.obId]?.completed === true,
      JSON.stringify(row))
  }

  // ═══ ordering: optional before required → locked_topic, zero XP ═══════════
  {
    const before = progressRow(dbUrl, U_OPT_BEFORE_REQ)
    const r = rpc(dbUrl, U_OPT_BEFORE_REQ, obCall(TOPIC1, OB1_OPT.obId, 'yes', OB1_OPT.standardOptions[0], 'false'))
    record('ordering: optional before required → locked_topic', r.errorCode === 'locked_topic', r.stderr ?? JSON.stringify(r.json))
    const after = progressRow(dbUrl, U_OPT_BEFORE_REQ)
    record('ordering: optional-before-required refusal writes nothing (total_xp, flags unchanged)',
      JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    record('ordering: optional-before-required refusal creates no evolved_takes row',
      evolvedTakeCount(dbUrl, U_OPT_BEFORE_REQ) === 0, null)
  }

  // ═══ custom XP: >=50 chars (300), boundary 49 (100) / 50 (300) ════════════
  {
    const text = mkText(60, 'ge50-')
    const r = rpc(dbUrl, U_CUSTOM_GE50, obCall(TOPIC1, OB1_REQ.obId, 'yes', text, 'true'))
    record('custom XP: 60-char custom take → 300 XP (100 base + 200 bonus)', r.json?.xp_awarded === 300, r.stderr ?? JSON.stringify(r.json))
  }
  {
    const text = mkText(49, 'b49-')
    record('fixture: boundary text is exactly 49 chars', text.length === 49, text.length)
    const r = rpc(dbUrl, U_CUSTOM_49, obCall(TOPIC1, OB1_REQ.obId, 'yes', text, 'true'))
    record('custom XP boundary: 49-char custom take → 100 XP (no bonus)', r.json?.xp_awarded === 100, r.stderr ?? JSON.stringify(r.json))
  }
  {
    const text = mkText(50, 'b50-')
    record('fixture: boundary text is exactly 50 chars', text.length === 50, text.length)
    const r = rpc(dbUrl, U_CUSTOM_50, obCall(TOPIC1, OB1_REQ.obId, 'yes', text, 'true'))
    record('custom XP boundary: exactly 50-char custom take → 300 XP (bonus applies at >=50)', r.json?.xp_awarded === 300, r.stderr ?? JSON.stringify(r.json))
  }

  // ═══ double-submit: identical replay, then different-text replay ══════════
  {
    const first = rpc(dbUrl, U_REPLAY, obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false'))
    record('replay fixture: first completion succeeds (100 XP)', first.json?.xp_awarded === 100, first.stderr ?? JSON.stringify(first.json))

    const beforeIdentical = progressRow(dbUrl, U_REPLAY)
    const identical = rpc(dbUrl, U_REPLAY, obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'false'))
    record('replay (identical): xp_awarded = 0', identical.json?.xp_awarded === 0, identical.stderr ?? JSON.stringify(identical.json))
    const afterIdentical = progressRow(dbUrl, U_REPLAY)
    record('replay (identical): full progress row unchanged (no writes)',
      JSON.stringify(beforeIdentical) === JSON.stringify(afterIdentical), `before=${JSON.stringify(beforeIdentical)} after=${JSON.stringify(afterIdentical)}`)

    // Different text: still a valid preset for this OB (so it clears the
    // preset-integrity check) but different from the original submission —
    // must still land on the replay path, and the ORIGINAL text is kept.
    const differentText = OB1_REQ.standardOptions[1]
    const diff = rpc(dbUrl, U_REPLAY, obCall(TOPIC1, OB1_REQ.obId, 'yes', differentText, 'false'))
    record('replay (different text): xp_awarded = 0', diff.json?.xp_awarded === 0, diff.stderr ?? JSON.stringify(diff.json))
    const afterDiff = progressRow(dbUrl, U_REPLAY)
    record('replay (different text): progress row unchanged (no writes)',
      JSON.stringify(beforeIdentical) === JSON.stringify(afterDiff), JSON.stringify(afterDiff))
    const rowAfterDiff = evolvedTakeRow(dbUrl, U_REPLAY, OB1_REQ.obId)
    record('replay (different text): original evolved_take text is kept (no overwrite)',
      rowAfterDiff?.evolved_take === OB1_REQ.standardOptions[0], JSON.stringify(rowAfterDiff))
    record('replay: no second evolved_takes row created', evolvedTakeCount(dbUrl, U_REPLAY) === 1, null)
  }

  // ═══ forged/invalid input battery — one probe user, verify zero writes ════
  {
    const before = progressRow(dbUrl, U_ERR_PROBE)

    {
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC1, OB1_REQ.obId, 'maybe', OB1_REQ.standardOptions[0], 'false'))
      record('forged input: cold_take = \'maybe\' → invalid_params', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
    }
    {
      const longTake = mkText(2001)
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC1, OB1_REQ.obId, 'yes', longTake, 'true'))
      record('forged input: 2001-char evolved_take → invalid_params', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
    }
    {
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC1, OB1_REQ.obId, 'yes', 'this is not one of the registered preset options', 'false'))
      record('preset-integrity: is_custom=false with non-preset text → invalid_params', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
    }
    {
      const r = asRole(dbUrl, 'authenticated', U_ERR_PROBE,
        `select ${obCall(TOPIC1, OB1_REQ.obId, 'yes', OB1_REQ.standardOptions[0], 'null::boolean')};`)
      const errCode = (r.stderr.match(/ERROR: {1,2}([^\n]*)/) || [])[1]?.trim()
      record('forged input: is_custom = null → invalid_params', r.status !== 0 && errCode === 'invalid_params', r.stderr)
    }
    {
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC1, 'invented-ob-id-that-does-not-exist', 'yes', 'anything', 'true'))
      record('forged-ob battery: invented ob_id → unknown_ob', r.errorCode === 'unknown_ob', r.stderr ?? JSON.stringify(r.json))
    }
    {
      // Real ob_id, but paired with the WRONG topic_id.
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC1, OB2_REQ.obId, 'yes', OB2_REQ.standardOptions[0], 'false'))
      record('forged-ob battery: real ob_id mispaired with wrong topic_id → unknown_ob', r.errorCode === 'unknown_ob', r.stderr ?? JSON.stringify(r.json))
    }
    {
      // Real ob_id, correctly paired with its own topic — but that topic is
      // locked for this (fresh) user.
      const r = rpc(dbUrl, U_ERR_PROBE, obCall(TOPIC2, OB2_REQ.obId, 'yes', OB2_REQ.standardOptions[0], 'false'))
      record('forged-ob battery: real ob_id on a locked topic → locked_topic', r.errorCode === 'locked_topic', r.stderr ?? JSON.stringify(r.json))
    }

    const after = progressRow(dbUrl, U_ERR_PROBE)
    record('forged/invalid battery: zero XP minted, progress row fully unchanged across every probe',
      JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
    record('forged/invalid battery: no evolved_takes row created by any probe',
      evolvedTakeCount(dbUrl, U_ERR_PROBE) === 0, null)
  }

  // ═══ comparison: gate crossing, sums, imported/excluded, unknown ob ═══════
  {
    const opt0 = OB2_REQ.standardOptions[0]
    const opt1 = OB2_REQ.standardOptions[1]
    const customMarkers = []

    // u1..u4: preset opt0, cold 'yes'
    for (let i = 1; i <= 4; i++) {
      insertEvolvedTakeDirect(dbUrl, { userId: cmpUser(i), topicId: TOPIC2, obId: CMP_OB, coldTake: 'yes', evolvedTake: opt0, isCustom: false })
    }
    // u5..u6: preset opt1, cold 'no'
    for (let i = 5; i <= 6; i++) {
      insertEvolvedTakeDirect(dbUrl, { userId: cmpUser(i), topicId: TOPIC2, obId: CMP_OB, coldTake: 'no', evolvedTake: opt1, isCustom: false })
    }
    // u7..u9: custom, cold 'yes','no','yes' — only 9 rows so far (n=9, gated)
    const coldForCustom = { 7: 'yes', 8: 'no', 9: 'yes', 10: 'no' }
    for (let i = 7; i <= 9; i++) {
      const marker = `CMPMARKER${i}-`
      customMarkers.push(marker)
      insertEvolvedTakeDirect(dbUrl, { userId: cmpUser(i), topicId: TOPIC2, obId: CMP_OB, coldTake: coldForCustom[i], evolvedTake: mkText(60, marker), isCustom: true })
    }

    const gated = comparisonCall(dbUrl, 'anon', null, CMP_OB)
    record('comparison gate: n=9 → {n:9, gated:true}',
      gated.json?.n === 9 && gated.json?.gated === true && Object.keys(gated.json ?? {}).sort().join(',') === 'gated,n',
      JSON.stringify(gated.json ?? gated.stderr))

    // u10: 10th custom row → crosses the gate
    {
      const marker = 'CMPMARKER10-'
      customMarkers.push(marker)
      insertEvolvedTakeDirect(dbUrl, { userId: cmpUser(10), topicId: TOPIC2, obId: CMP_OB, coldTake: coldForCustom[10], evolvedTake: mkText(60, marker), isCustom: true })
    }

    const open = comparisonCall(dbUrl, 'anon', null, CMP_OB)
    record('comparison gate: n=10 → gated:false (open shape)', open.json?.gated === false, JSON.stringify(open.json))
    record('comparison open shape: exact key set {n,gated,cold,evolved,custom_count}',
      JSON.stringify(Object.keys(open.json ?? {}).sort()) === JSON.stringify(['cold', 'custom_count', 'evolved', 'gated', 'n']),
      JSON.stringify(open.json))
    record('comparison open shape: n = 10', open.json?.n === 10, JSON.stringify(open.json?.n))
    record('comparison open shape: cold.yes + cold.no = n', (open.json?.cold?.yes ?? 0) + (open.json?.cold?.no ?? 0) === open.json?.n, JSON.stringify(open.json?.cold))
    record('comparison open shape: cold counts exactly {yes:6, no:4}', open.json?.cold?.yes === 6 && open.json?.cold?.no === 4, JSON.stringify(open.json?.cold))
    record('comparison open shape: custom_count = 4', open.json?.custom_count === 4, JSON.stringify(open.json?.custom_count))
    const evolvedSum = (open.json?.evolved ?? []).reduce((acc, b) => acc + b.count, 0)
    record('comparison open shape: evolved bucket counts + custom_count = n',
      evolvedSum + (open.json?.custom_count ?? 0) === open.json?.n, `evolvedSum=${evolvedSum} custom_count=${open.json?.custom_count} n=${open.json?.n}`)
    record('comparison open shape: evolved buckets exactly [{opt0,4},{opt1,2}] ordered by count desc',
      JSON.stringify(open.json?.evolved) === JSON.stringify([{ take: opt0, count: 4 }, { take: opt1, count: 2 }]),
      JSON.stringify(open.json?.evolved))
    const allBucketsAreRegistryTexts = (open.json?.evolved ?? []).every((b) => OB2_REQ.standardOptions.includes(b.take))
    record('comparison open shape: every evolved bucket "take" is a registry standard_options text',
      allBucketsAreRegistryTexts, JSON.stringify(open.json?.evolved))
    const responseText = JSON.stringify(open.json)
    const noCustomTextLeak = customMarkers.every((marker) => !responseText.includes(marker))
    record('comparison open shape: no custom take text (marker) appears anywhere in the response',
      noCustomTextLeak, `markers=${JSON.stringify(customMarkers)} response=${responseText}`)

    const anonOpen = comparisonCall(dbUrl, 'anon', null, CMP_OB)
    record('comparison: anon-callable, same result as above', JSON.stringify(anonOpen.json) === JSON.stringify(open.json), JSON.stringify(anonOpen.json))
    const authOpen = comparisonCall(dbUrl, 'authenticated', U_PRESET_REQ, CMP_OB)
    record('comparison: authenticated-callable, same result', JSON.stringify(authOpen.json) === JSON.stringify(open.json), JSON.stringify(authOpen.json))

    // imported rows count.
    insertEvolvedTakeDirect(dbUrl, { userId: cmpUser(11), topicId: TOPIC2, obId: CMP_OB, coldTake: 'yes', evolvedTake: opt0, isCustom: false, isImported: true })
    const withImported = comparisonCall(dbUrl, 'anon', null, CMP_OB)
    record('comparison: imported row counted (n=11, opt0 bucket now 5, cold.yes now 7)',
      withImported.json?.n === 11
      && withImported.json?.cold?.yes === 7
      && (withImported.json?.evolved ?? []).find((b) => b.take === opt0)?.count === 5,
      JSON.stringify(withImported.json))

    // excluded rows are filtered out of both n and the buckets — mark the
    // just-inserted imported row excluded and confirm it reverts to the
    // exact n=10 snapshot from before.
    setExcluded(dbUrl, cmpUser(11), CMP_OB, true)
    const withExcluded = comparisonCall(dbUrl, 'anon', null, CMP_OB)
    record('comparison: excluded row dropped from n and buckets (back to the n=10 snapshot)',
      JSON.stringify(withExcluded.json) === JSON.stringify(open.json), JSON.stringify(withExcluded.json))

    // unknown ob_id → {n:0, gated:true}, never an error.
    const unknown = comparisonCall(dbUrl, 'anon', null, 'no-such-ob-id-at-all')
    record('comparison: unknown ob_id → {n:0, gated:true} (not an error)',
      unknown.json?.n === 0 && unknown.json?.gated === true && !unknown.errorCode, JSON.stringify(unknown.json ?? unknown.stderr))
  }
} catch (err) {
  console.error(`FAIL rpc/b3-opinion-builder: harness error: ${err.message}\n${err.stack}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rpc/b3-opinion-builder summary: ${results.filter(r => r.ok).length}/${results.length} passed ===`)
process.exit(failed ? 1 : 0)

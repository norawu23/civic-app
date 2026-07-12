#!/usr/bin/env node
// tests/rpc/b1-grading.test.mjs
//
// Spec "Required tests" (docs/specs/B1-l1-grading.md): integration suite for
// 0004_rpc_grading.sql — complete_flashcards / complete_quiz plus the three
// shared internal helpers (progress_snapshot / topic_unlocked / xp_for):
//
//   * happy path both RPCs: flags set, XP correct (50 / 50+25 perfect),
//     n_correct correct, snapshot shape valid (contract §2 key set + types)
//   * replay: flashcards ×2, quiz ×2 (same vector), quiz replay with a
//     different vector (fresh n_correct, stored quizScore unchanged, 0 XP);
//     full progress row compared before/after — replay writes NOTHING
//   * locked_topic / unknown_topic; first registry topic callable with
//     topics = '{}'
//   * invalid_params: flashcards level 2/0/99; quiz level with no key row;
//     null/empty answers
//   * invalid_answers: wrong vector length; element = 4; element = −1
//   * unlock chain: topic-1 L3 quiz → topic 2 unlocked, topic 3 still
//     locked; complete_flashcards on topic 2 then succeeds; last topic
//     completes without error; replay does not re-unlock
//   * score bounds: n_correct ∈ [0, key length]; perfect bonus only at
//     exactly key length
//   * grant wall: anon call → permission denied (not not_authenticated);
//     helpers execute-revoked for anon AND authenticated
//
// Requires Docker (supabase CLI local stack) + psql, OR an externally
// provisioned database via CIVIC_TEST_DB_URL (tests/lib/pg-local-stub.sql +
// migrations 0001→0004, per CLAUDE.md D-017). SKIPs (exit 0), not fails,
// when neither is available — the established convention (A1's
// deny-all-smoke precedent).
//
// Content seeding: the suite applies H1's `content:seed` output itself
// (scripts/content/seed.mjs is idempotent — ON CONFLICT DO UPDATE), so it
// runs against a bare post-migration stack with no extra setup step.
// Answer keys are then read back from quiz_answer_keys via the superuser
// connection, so vectors below track the real content instead of
// hard-coding it.
//
// Run: node tests/rpc/b1-grading.test.mjs

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
  console.log('SKIP rpc/b1-grading: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rpc/b1-grading: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

// Fixed fixture UUIDs (readable; throwaway DB).
const U_FLASH = 'b1000000-0000-0000-0000-000000000001' // flashcards happy + replay
const U_QUIZ = 'b1000000-0000-0000-0000-000000000002' // quiz perfect + replays
const U_PARTIAL = 'b1000000-0000-0000-0000-000000000003' // quiz partial score
const U_CHAIN = 'b1000000-0000-0000-0000-000000000004' // unlock chain
const U_LAST = 'b1000000-0000-0000-0000-000000000005' // last-topic completion
const U_ERR = 'b1000000-0000-0000-0000-000000000006' // error-path probes
const U_ZERO = 'b1000000-0000-0000-0000-000000000007' // all-wrong quiz (bounds)

let failed = false
const results = []

function record(name, ok, detail) {
  results.push({ name, ok })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} rpc/b1-grading: ${name}${ok ? '' : ` — ${String(detail ?? '').slice(0, 500)}`}`)
}

// Minimal service-role auth.users insert (same recipe as tests/auth/*, kept
// duplicated per this repo's self-contained-test-file convention). The A2
// on_auth_user_created trigger then auto-creates the profiles + progress
// rows — progress starts at the real default: topics = '{}'.
function authUserInsert(id, username) {
  return `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${username}@b1-test.local', '', now(), '{"provider":"email","providers":["email"]}',
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

// Calls an RPC as an authenticated user and parses the jsonb return.
// Returns { json } on success or { errorCode, stderr } on failure.
function rpc(dbUrl, userId, call) {
  const r = asRole(dbUrl, 'authenticated', userId, `select ${call};`)
  if (r.status !== 0) {
    const m = r.stderr.match(/ERROR: {1,2}([^\n]*)/)
    return { errorCode: m ? m[1].trim() : null, stderr: r.stderr }
  }
  // stdout is "SET\nSET\n{json}" (-t -A suppresses headers, not SET tags).
  const lines = r.stdout.trim().split('\n')
  try {
    return { json: JSON.parse(lines[lines.length - 1]) }
  } catch (e) {
    return { errorCode: null, stderr: `unparseable RPC output: ${r.stdout}` }
  }
}

// Superuser read of the full progress row as one jsonb (replay comparisons).
function progressRow(dbUrl, userId) {
  const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select to_jsonb(p) from public.progress p where p.id = '${userId}';`], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`progressRow read failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim())
}

function sqlIntArray(arr) {
  return `array[${arr.join(',')}]::int[]`
}

// Contract §2 snapshot validation: exact key set + types, and the S1
// envelope's xp_awarded presence, asserted wherever this is called.
const SNAPSHOT_KEYS = [
  'total_xp', 'streak', 'streak_freezes', 'last_login_date',
  'tz_offset_minutes', 'topics', 'opinion_builders', 'schema_version', 'updated_at',
]
function snapshotShapeProblems(snap) {
  const problems = []
  if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return ['snapshot is not an object']
  const keys = Object.keys(snap).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...SNAPSHOT_KEYS].sort())) {
    problems.push(`key set mismatch: got ${JSON.stringify(keys)}`)
  }
  if (!Number.isInteger(snap.total_xp) || snap.total_xp < 0) problems.push('total_xp not a non-negative int')
  if (!Number.isInteger(snap.streak) || snap.streak < 0) problems.push('streak not a non-negative int')
  if (![0, 1].includes(snap.streak_freezes)) problems.push('streak_freezes not 0|1')
  if (snap.last_login_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(snap.last_login_date)) problems.push('last_login_date not null|YYYY-MM-DD')
  if (!Number.isInteger(snap.tz_offset_minutes) || snap.tz_offset_minutes < -840 || snap.tz_offset_minutes > 840) problems.push('tz_offset_minutes out of range')
  if (snap.topics === null || typeof snap.topics !== 'object' || Array.isArray(snap.topics)) problems.push('topics not an object')
  if (snap.opinion_builders === null || typeof snap.opinion_builders !== 'object' || Array.isArray(snap.opinion_builders)) problems.push('opinion_builders not an object')
  if (!Number.isInteger(snap.schema_version)) problems.push('schema_version not an int')
  if (typeof snap.updated_at !== 'string' || Number.isNaN(Date.parse(snap.updated_at))) problems.push('updated_at not an ISO 8601 string')
  return problems
}

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // ── seed content (H1's generator, idempotent) ─────────────────────────────
  const seedGen = spawnSync('node', [join(REPO_ROOT, 'scripts', 'content', 'seed.mjs')], { encoding: 'utf8' })
  if (seedGen.status !== 0) throw new Error(`content:seed generation failed:\n${seedGen.stderr}`)
  const seedApply = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: seedGen.stdout, encoding: 'utf8' })
  if (seedApply.status !== 0) throw new Error(`content:seed apply failed:\n${seedApply.stderr}`)

  // ── registry order + answer keys, read back from the seeded DB ────────────
  const catalogRead = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
    `select jsonb_agg(topic_id order by position) from public.topics_catalog;`], { encoding: 'utf8' })
  if (catalogRead.status !== 0) throw new Error(`catalog read failed: ${catalogRead.stderr}`)
  const TOPIC_ORDER = JSON.parse(catalogRead.stdout.trim())
  if (!Array.isArray(TOPIC_ORDER) || TOPIC_ORDER.length < 3) {
    throw new Error(`expected >= 3 seeded topics, got ${JSON.stringify(TOPIC_ORDER)}`)
  }
  const [TOPIC1, TOPIC2, TOPIC3] = TOPIC_ORDER
  const TOPIC_LAST = TOPIC_ORDER[TOPIC_ORDER.length - 1]

  function answerKey(topicId, level) {
    const r = spawnSync('psql', [dbUrl, '-t', '-A', '-c',
      `select to_jsonb(answers) from public.quiz_answer_keys where topic_id = '${topicId}' and level = ${level};`], { encoding: 'utf8' })
    if (r.status !== 0 || !r.stdout.trim()) throw new Error(`answer key read failed for (${topicId}, ${level}): ${r.stderr}`)
    return JSON.parse(r.stdout.trim())
  }
  const KEY_T1_L1 = answerKey(TOPIC1, 1)
  const KEY_T1_L3 = answerKey(TOPIC1, 3)
  const KEY_LAST_L3 = answerKey(TOPIC_LAST, 3)
  const allWrong = (key) => key.map((k) => (k + 1) % 4) // element-wise ≠ key, still 0..3

  // ── seed fixture users (trigger creates progress rows with topics='{}') ───
  const seed = psql(dbUrl, `
    ${authUserInsert(U_FLASH, 'b1_flash')}
    ${authUserInsert(U_QUIZ, 'b1_quiz')}
    ${authUserInsert(U_PARTIAL, 'b1_partial')}
    ${authUserInsert(U_CHAIN, 'b1_chain')}
    ${authUserInsert(U_LAST, 'b1_last')}
    ${authUserInsert(U_ERR, 'b1_err')}
    ${authUserInsert(U_ZERO, 'b1_zero')}
  `)
  if (seed.status !== 0) throw new Error(`fixture seed failed:\n${seed.stdout}\n${seed.stderr}`)

  // ═══ grant wall ═══════════════════════════════════════════════════════════
  {
    const r = asRole(dbUrl, 'anon', null, `select public.complete_flashcards('${TOPIC1}', 1);`)
    const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
    const notBodyError = !/not_authenticated/.test(r.stderr)
    record('grant wall: anon complete_flashcards → permission denied (not not_authenticated)', denied && notBodyError, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'anon', null, `select public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(KEY_T1_L1)});`)
    const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
    const notBodyError = !/not_authenticated/.test(r.stderr)
    record('grant wall: anon complete_quiz → permission denied (not not_authenticated)', denied && notBodyError, r.stdout + r.stderr)
  }
  // Helpers are server-internal: execute revoked from anon AND authenticated.
  for (const [call, label] of [
    [`public.progress_snapshot('${U_FLASH}'::uuid)`, 'progress_snapshot'],
    [`public.topic_unlocked('{}'::jsonb, '${TOPIC1}')`, 'topic_unlocked'],
    [`public.xp_for('quiz')`, 'xp_for'],
  ]) {
    for (const [role, sub] of [['anon', null], ['authenticated', U_FLASH]]) {
      const r = asRole(dbUrl, role, sub, `select ${call};`)
      const denied = r.status !== 0 && /permission denied for function/i.test(r.stderr)
      record(`grant wall: ${role} cannot execute helper ${label}`, denied, r.stdout + r.stderr)
    }
  }
  // Defensive in-body guard: authenticated role but no JWT sub → not_authenticated.
  {
    const r = asRole(dbUrl, 'authenticated', null, `select public.complete_flashcards('${TOPIC1}', 1);`)
    const ok = r.status !== 0 && /ERROR: {1,2}not_authenticated/.test(r.stderr)
    record('auth guard: authenticated role with null auth.uid() → not_authenticated', ok, r.stdout + r.stderr)
  }

  // ═══ flashcards happy path (first registry topic, topics = '{}') ══════════
  {
    const before = progressRow(dbUrl, U_FLASH)
    record('fixture: fresh progress row has topics = {} and total_xp = 0',
      JSON.stringify(before.topics) === '{}' && before.total_xp === 0, JSON.stringify(before))

    const r = rpc(dbUrl, U_FLASH, `public.complete_flashcards('${TOPIC1}', 1)`)
    record('flashcards happy path: first registry topic callable with topics = {}', Boolean(r.json), r.stderr)
    if (r.json) {
      record('flashcards happy path: envelope is exactly {snapshot, xp_awarded}',
        JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['snapshot', 'xp_awarded']), JSON.stringify(r.json))
      record('flashcards happy path: xp_awarded = 50', r.json.xp_awarded === 50, JSON.stringify(r.json.xp_awarded))
      const problems = snapshotShapeProblems(r.json.snapshot)
      record('flashcards happy path: snapshot validates against contract §2 (key set + types)', problems.length === 0, problems.join('; '))
      record('flashcards happy path: snapshot.total_xp = 50', r.json.snapshot?.total_xp === 50, JSON.stringify(r.json.snapshot))
      const lvl = r.json.snapshot?.topics?.[TOPIC1]?.levels?.['1']
      record('flashcards happy path: flag set sparsely (levels."1".flashcardsComplete = true)',
        lvl?.flashcardsComplete === true, JSON.stringify(r.json.snapshot?.topics))
    }
    const after = progressRow(dbUrl, U_FLASH)
    record('flashcards happy path: row persisted (total_xp = 50, flag true)',
      after.total_xp === 50 && after.topics?.[TOPIC1]?.levels?.['1']?.flashcardsComplete === true, JSON.stringify(after))
  }

  // ═══ flashcards replay ═════════════════════════════════════════════════════
  {
    const before = progressRow(dbUrl, U_FLASH)
    const r = rpc(dbUrl, U_FLASH, `public.complete_flashcards('${TOPIC1}', 1)`)
    record('flashcards replay: success with xp_awarded = 0', r.json?.xp_awarded === 0, r.stderr ?? JSON.stringify(r.json))
    record('flashcards replay: snapshot still returned and valid',
      r.json && snapshotShapeProblems(r.json.snapshot).length === 0, JSON.stringify(r.json))
    const after = progressRow(dbUrl, U_FLASH)
    record('flashcards replay: full progress row unchanged (no writes, incl. updated_at)',
      JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  }

  // ═══ quiz happy path — perfect score ═══════════════════════════════════════
  {
    const r = rpc(dbUrl, U_QUIZ, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(KEY_T1_L1)})`)
    record('quiz happy path: perfect score succeeds', Boolean(r.json), r.stderr)
    if (r.json) {
      record('quiz happy path: envelope is exactly {snapshot, xp_awarded, n_correct}',
        JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['n_correct', 'snapshot', 'xp_awarded']), JSON.stringify(r.json))
      record(`quiz happy path: n_correct = key length (${KEY_T1_L1.length})`, r.json.n_correct === KEY_T1_L1.length, JSON.stringify(r.json.n_correct))
      record('quiz happy path: xp_awarded = 75 (50 + 25 perfect bonus)', r.json.xp_awarded === 75, JSON.stringify(r.json.xp_awarded))
      const problems = snapshotShapeProblems(r.json.snapshot)
      record('quiz happy path: snapshot validates against contract §2 (key set + types)', problems.length === 0, problems.join('; '))
    }
    const row = progressRow(dbUrl, U_QUIZ)
    const t = row.topics?.[TOPIC1]
    record('quiz happy path: quizComplete = true, quizScore = key length persisted',
      t?.levels?.['1']?.quizComplete === true && t?.levels?.['1']?.quizScore === KEY_T1_L1.length, JSON.stringify(row.topics))
    record('quiz happy path: level 1 completion sets currentLevel = 2 (D-012 §1 parity)',
      t?.currentLevel === 2, JSON.stringify(t))
    record('quiz happy path: total_xp = 75 persisted', row.total_xp === 75, JSON.stringify(row.total_xp))
  }

  // ═══ quiz replay — same vector, then a different vector ════════════════════
  {
    const before = progressRow(dbUrl, U_QUIZ)
    const same = rpc(dbUrl, U_QUIZ, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(KEY_T1_L1)})`)
    record('quiz replay (same vector): xp_awarded = 0, fresh n_correct identical',
      same.json?.xp_awarded === 0 && same.json?.n_correct === KEY_T1_L1.length, same.stderr ?? JSON.stringify(same.json))
    const afterSame = progressRow(dbUrl, U_QUIZ)
    record('quiz replay (same vector): full progress row unchanged',
      JSON.stringify(before) === JSON.stringify(afterSame), `before=${JSON.stringify(before)} after=${JSON.stringify(afterSame)}`)

    const diff = rpc(dbUrl, U_QUIZ, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(allWrong(KEY_T1_L1))})`)
    record('quiz replay (different vector): xp_awarded = 0, fresh n_correct = 0',
      diff.json?.xp_awarded === 0 && diff.json?.n_correct === 0, diff.stderr ?? JSON.stringify(diff.json))
    const afterDiff = progressRow(dbUrl, U_QUIZ)
    record('quiz replay (different vector): stored quizScore unchanged, row unchanged',
      afterDiff.topics?.[TOPIC1]?.levels?.['1']?.quizScore === KEY_T1_L1.length
      && JSON.stringify(before) === JSON.stringify(afterDiff), JSON.stringify(afterDiff))
  }

  // ═══ score bounds: partial + all-wrong (perfect bonus only at key length) ══
  {
    // Exactly one correct element; the rest wrong.
    const partial = [KEY_T1_L1[0], ...allWrong(KEY_T1_L1).slice(1)]
    const r = rpc(dbUrl, U_PARTIAL, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(partial)})`)
    record('score bounds: partial vector → n_correct = 1', r.json?.n_correct === 1, r.stderr ?? JSON.stringify(r.json))
    record('score bounds: partial score gets base XP only (50, no perfect bonus)',
      r.json?.xp_awarded === 50, JSON.stringify(r.json?.xp_awarded))
    record('score bounds: n_correct within [0, key length]',
      r.json && r.json.n_correct >= 0 && r.json.n_correct <= KEY_T1_L1.length, JSON.stringify(r.json?.n_correct))
  }
  {
    const r = rpc(dbUrl, U_ZERO, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(allWrong(KEY_T1_L1))})`)
    record('score bounds: all-wrong vector → n_correct = 0, xp_awarded = 50 (no bonus)',
      r.json?.n_correct === 0 && r.json?.xp_awarded === 50, r.stderr ?? JSON.stringify(r.json))
  }

  // ═══ locked / unknown topics ═══════════════════════════════════════════════
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_flashcards('${TOPIC2}', 1)`)
    record('locked topic: complete_flashcards on topic 2 with topics={} → locked_topic', r.errorCode === 'locked_topic', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC2}', 1, ${sqlIntArray(allWrong(KEY_T1_L1))})`)
    record('locked topic: complete_quiz on topic 2 with topics={} → locked_topic', r.errorCode === 'locked_topic', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_flashcards('no_such_topic', 1)`)
    record('unknown topic: complete_flashcards → unknown_topic', r.errorCode === 'unknown_topic', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('no_such_topic', 1, ${sqlIntArray(allWrong(KEY_T1_L1))})`)
    record('unknown topic: complete_quiz → unknown_topic', r.errorCode === 'unknown_topic', r.stderr ?? JSON.stringify(r.json))
  }

  // ═══ invalid_params ═════════════════════════════════════════════════════════
  for (const lvl of [2, 0, 99]) {
    const r = rpc(dbUrl, U_ERR, `public.complete_flashcards('${TOPIC1}', ${lvl})`)
    record(`invalid_params: complete_flashcards level ${lvl} (P0 flashcard levels: 1 only)`, r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
  }
  {
    // Level 2 exists in the catalog but carries no quiz — no key row.
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 2, ${sqlIntArray([0, 0, 0, 0, 0])})`)
    record('invalid_params: complete_quiz on a level with no answer-key row', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, null::int[])`)
    record('invalid_params: complete_quiz with null answers', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, array[]::int[])`)
    record('invalid_params: complete_quiz with empty answers', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
  }
  {
    // Precedence: the answers type check fires before unknown_topic (spec order).
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('no_such_topic', 1, null::int[])`)
    record('invalid_params: null answers checked before unknown_topic (spec check order)', r.errorCode === 'invalid_params', r.stderr ?? JSON.stringify(r.json))
  }

  // ═══ invalid_answers ════════════════════════════════════════════════════════
  {
    const short = KEY_T1_L1.slice(0, KEY_T1_L1.length - 1)
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(short)})`)
    record('invalid_answers: vector shorter than key', r.errorCode === 'invalid_answers', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const long = [...KEY_T1_L1, 0]
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(long)})`)
    record('invalid_answers: vector longer than key', r.errorCode === 'invalid_answers', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const el4 = [4, ...KEY_T1_L1.slice(1)]
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(el4)})`)
    record('invalid_answers: element = 4 (outside 0..3)', r.errorCode === 'invalid_answers', r.stderr ?? JSON.stringify(r.json))
  }
  {
    const elNeg = [-1, ...KEY_T1_L1.slice(1)]
    const r = rpc(dbUrl, U_ERR, `public.complete_quiz('${TOPIC1}', 1, ${sqlIntArray(elNeg)})`)
    record('invalid_answers: element = -1 (outside 0..3)', r.errorCode === 'invalid_answers', r.stderr ?? JSON.stringify(r.json))
  }
  {
    // None of the error probes above may have written anything.
    const row = progressRow(dbUrl, U_ERR)
    record('error paths write nothing: probe user still at topics={}, total_xp=0',
      JSON.stringify(row.topics) === '{}' && row.total_xp === 0, JSON.stringify(row))
  }

  // ═══ unlock chain: topic-1 L3 quiz → topic 2 unlocked, topic 3 locked ══════
  {
    const r = rpc(dbUrl, U_CHAIN, `public.complete_quiz('${TOPIC1}', 3, ${sqlIntArray(KEY_T1_L3)})`)
    record('unlock chain: topic-1 L3 quiz completes (perfect, xp_awarded = 75)',
      r.json?.xp_awarded === 75 && r.json?.n_correct === KEY_T1_L3.length, r.stderr ?? JSON.stringify(r.json))
    const row = progressRow(dbUrl, U_CHAIN)
    const t1 = row.topics?.[TOPIC1]
    record('unlock chain: L3 completion sets currentLevel = 3 on the completed topic',
      t1?.currentLevel === 3 && t1?.levels?.['3']?.quizComplete === true, JSON.stringify(t1))
    const t2 = row.topics?.[TOPIC2]
    record('unlock chain: exactly the next registry topic unlocked (unlocked=true, currentLevel=1)',
      t2?.unlocked === true && t2?.currentLevel === 1, JSON.stringify(row.topics))
    record('unlock chain: topic 3 still locked (no entry / not unlocked)',
      (row.topics?.[TOPIC3]?.unlocked ?? false) !== true, JSON.stringify(row.topics?.[TOPIC3]))
    record('unlock chain: no other topic entries created (sparse writes only)',
      Object.keys(row.topics ?? {}).sort().join(',') === [TOPIC1, TOPIC2].sort().join(','), JSON.stringify(Object.keys(row.topics ?? {})))
  }
  {
    // Topic 2 now unlocked: flashcards on it succeeds.
    const r = rpc(dbUrl, U_CHAIN, `public.complete_flashcards('${TOPIC2}', 1)`)
    record('unlock chain: complete_flashcards on the newly unlocked topic 2 succeeds (xp = 50)',
      r.json?.xp_awarded === 50, r.stderr ?? JSON.stringify(r.json))
  }
  {
    // L3-quiz replay: nothing re-fires, nothing re-unlocks.
    const before = progressRow(dbUrl, U_CHAIN)
    const r = rpc(dbUrl, U_CHAIN, `public.complete_quiz('${TOPIC1}', 3, ${sqlIntArray(KEY_T1_L3)})`)
    record('unlock chain: L3 quiz replay → xp_awarded = 0', r.json?.xp_awarded === 0, r.stderr ?? JSON.stringify(r.json))
    const after = progressRow(dbUrl, U_CHAIN)
    record('unlock chain: L3 quiz replay does not re-unlock / rewrite anything (row unchanged)',
      JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  }

  // ═══ last topic completes without error ═════════════════════════════════════
  {
    // Unlock the last registry topic directly (superuser fixture write, same
    // license as the policies suite's fixture seeding).
    const unlock = psql(dbUrl, `
      update public.progress
         set topics = jsonb_build_object('${TOPIC_LAST}', '{"unlocked": true, "currentLevel": 1}'::jsonb)
       where id = '${U_LAST}';
    `)
    if (unlock.status !== 0) throw new Error(`last-topic fixture unlock failed: ${unlock.stderr}`)

    const r = rpc(dbUrl, U_LAST, `public.complete_quiz('${TOPIC_LAST}', 3, ${sqlIntArray(KEY_LAST_L3)})`)
    record('last topic: L3 quiz on the final registry topic completes without error (xp = 75)',
      r.json?.xp_awarded === 75, r.stderr ?? JSON.stringify(r.json))
    const row = progressRow(dbUrl, U_LAST)
    record('last topic: no phantom next-topic entry created',
      Object.keys(row.topics ?? {}).length === 1 && row.topics?.[TOPIC_LAST]?.currentLevel === 3, JSON.stringify(row.topics))

    const before = progressRow(dbUrl, U_LAST)
    const replay = rpc(dbUrl, U_LAST, `public.complete_quiz('${TOPIC_LAST}', 3, ${sqlIntArray(KEY_LAST_L3)})`)
    const after = progressRow(dbUrl, U_LAST)
    record('last topic: replay is a success with xp_awarded = 0 and row unchanged',
      replay.json?.xp_awarded === 0 && JSON.stringify(before) === JSON.stringify(after), replay.stderr ?? JSON.stringify(replay.json))
  }
} catch (err) {
  console.error(`FAIL rpc/b1-grading: harness error: ${err.message}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rpc/b1-grading summary: ${results.filter(r => r.ok).length}/${results.length} passed ===`)
process.exit(failed ? 1 : 0)

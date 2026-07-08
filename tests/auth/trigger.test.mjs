#!/usr/bin/env node
// tests/auth/trigger.test.mjs
//
// Spec docs/specs/A2-auth-trigger-username.md, "Required tests": exercises
// public.handle_new_user() / on_auth_user_created end to end against a real
// local Supabase stack (0001 + 0002 applied from empty).
//
// We insert directly into auth.users (rather than driving the GoTrue HTTP
// signup endpoint) to keep this a pure Postgres-level test of the trigger,
// following the same "raw INSERT with raw_user_meta_data" technique widely
// used to test Supabase auth triggers locally — GoTrue itself does exactly
// this INSERT under the hood on signup, so the trigger fires identically.
//
// Requires Docker (local Supabase CLI stack) + psql, same as
// deny-all-smoke.test.mjs. SKIPs (exit 0), not fails, when either is
// missing — per A1's deny-all-smoke precedent.
//
// Run: node tests/auth/trigger.test.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  hasDocker, createProject, startProject, stopProject, destroyProject, getDbUrl, psql,
} from '../lib/supabase-stack.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function hasPsql() {
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

if (!hasDocker()) {
  console.log('SKIP auth/trigger: Docker is not available in this environment (required for the supabase CLI local stack). Run in CI / a Docker-capable environment.')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP auth/trigger: psql is not available on PATH. Required to exercise the trigger against the local stack.')
  process.exit(0)
}

let projectDir
let failed = false
const results = []

function check(name, condition, detail) {
  if (condition) {
    results.push(`PASS auth/trigger: ${name}`)
  } else {
    results.push(`FAIL auth/trigger: ${name}${detail ? ` — ${detail}` : ''}`)
    failed = true
  }
}

// Minimal INSERT into auth.users carrying signup metadata, mirroring what
// GoTrue itself writes on a real signup. Returns the psql spawnSync result.
function insertAuthUser(dbUrl, { id, email, metadata }) {
  const metaJson = JSON.stringify(metadata).replace(/'/g, "''")
  const sql = `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${email}', '', now(), '{"provider":"email","providers":["email"]}',
      '${metaJson}'::jsonb, now(), now(), '', '', '', ''
    );
  `
  return psql(dbUrl, sql)
}

function queryOne(dbUrl, sql) {
  const result = spawnSync('psql', [dbUrl, '-t', '-A', '-c', sql], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`query failed: ${sql}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

try {
  projectDir = createProject({ repoRoot: REPO_ROOT, withMigrations: true })
  startProject(projectDir) // applies 0001 + 0002 from empty — DoD item 1
  const dbUrl = getDbUrl(projectDir)

  // ── Happy path ────────────────────────────────────────────────────────────
  const happyId = 'aaaaaaaa-0000-0000-0000-000000000001'
  const happyResult = insertAuthUser(dbUrl, {
    id: happyId,
    email: 'alice@example.com',
    metadata: { username: 'alice_wonder', birth_year: '2000' },
  })
  check('happy-path signup succeeds', happyResult.status === 0, happyResult.stderr)
  if (happyResult.status === 0) {
    const row = queryOne(dbUrl, `select username, birth_year, needs_profile_completion from public.profiles where id = '${happyId}';`)
    check('happy-path profiles row has real username, correct birth_year, needs_profile_completion=false', row === 'alice_wonder|2000|f', row)
    const progressCount = queryOne(dbUrl, `select count(*) from public.progress where id = '${happyId}';`)
    check('happy-path progress row exists', progressCount === '1', progressCount)
  }

  // ── Under-13 rejection + non-persistence (load-bearing §8.1 assertion) ────
  // D-008 §2: threshold is current_year - birth_year < 14, NOT < 13. At
  // "today" (2026), birth_year 2013 => 2026-2013=13 < 14 => must reject.
  // birth_year 2012 => 14, not < 14 => must be allowed (boundary check).
  const under13Id = 'bbbbbbbb-0000-0000-0000-000000000002'
  const under13Result = insertAuthUser(dbUrl, {
    id: under13Id,
    email: 'kid13@example.com',
    metadata: { username: 'kiduser13', birth_year: '2013' },
  })
  check('under-13 (boundary, age=13 by year-diff) signup is rejected', under13Result.status !== 0, under13Result.stdout)
  check('under-13 rejection message mentions under-13', /under-13/i.test(under13Result.stderr), under13Result.stderr)

  const usersCount = queryOne(dbUrl, `select count(*) from auth.users where email = 'kid13@example.com';`)
  check('under-13 signup: zero auth.users rows persisted', usersCount === '0', usersCount)
  const profilesCount = queryOne(dbUrl, `select count(*) from public.profiles where username = 'kiduser13';`)
  check('under-13 signup: zero profiles rows persisted', profilesCount === '0', profilesCount)
  const progressCount13 = queryOne(dbUrl, `select count(*) from public.progress where id = '${under13Id}';`)
  check('under-13 signup: zero progress rows persisted', progressCount13 === '0', progressCount13)

  // 14-year-old (birth_year 2012) must be allowed — proves the threshold is
  // strictly < 14, not <= 14 or < 13.
  const okId = 'dddddddd-0000-0000-0000-000000000004'
  const okResult = insertAuthUser(dbUrl, {
    id: okId,
    email: 'ok14@example.com',
    metadata: { username: 'okuser14', birth_year: '2012' },
  })
  check('exactly-14-by-year-diff signup is allowed (boundary is < 14, not <= 14)', okResult.status === 0, okResult.stderr)

  // ── F1 (review): present-but-non-integer birth_year FAILS CLOSED ──────────
  // A birth_year that is present but does not parse to an integer must abort
  // the signup (RAISE) — never degrade to NULL, which would skip the under-13
  // gate and admit the account. Each form must reject AND persist zero rows.
  const nonIntForms = [
    ['2013.5', 'nonint-decimal'],
    ['2013abc', 'nonint-alpha'],
    ['0x7DD', 'nonint-hex'],
    ['2_013', 'nonint-underscore'],
  ]
  let nonIntIdx = 0
  for (const [by, label] of nonIntForms) {
    const id = `cccccccc-0000-0000-0000-00000000010${nonIntIdx++}`
    const email = `${label}@example.com`
    const r = insertAuthUser(dbUrl, { id, email, metadata: { username: `u_${label}`.slice(0, 20), birth_year: by } })
    check(`F1 non-integer birth_year "${by}" rejected (fail closed)`, r.status !== 0, r.stdout)
    const u = queryOne(dbUrl, `select count(*) from auth.users where email = '${email}';`)
    check(`F1 non-integer birth_year "${by}": zero auth.users rows persisted`, u === '0', u)
    const p = queryOne(dbUrl, `select count(*) from public.profiles where id = '${id}';`)
    check(`F1 non-integer birth_year "${by}": zero profiles rows persisted`, p === '0', p)
  }
  // Whitespace-padded integer must still be accepted (int cast trims it).
  const paddedId = 'cccccccc-0000-0000-0000-000000000110'
  const paddedResult = insertAuthUser(dbUrl, {
    id: paddedId, email: 'padded@example.com',
    metadata: { username: 'padded_ok', birth_year: ' 2000 ' },
  })
  check('F1 whitespace-padded integer " 2000 " still accepted', paddedResult.status === 0, paddedResult.stderr)

  // ── Collision fallback ─────────────────────────────────────────────────────
  const collisionId = 'eeeeeeee-0000-0000-0000-000000000005'
  const collisionResult = insertAuthUser(dbUrl, {
    id: collisionId,
    email: 'bob@example.com',
    metadata: { username: 'alice_wonder', birth_year: '1990' }, // same username as the happy-path user above
  })
  check('username-collision signup still succeeds (account not stranded)', collisionResult.status === 0, collisionResult.stderr)
  if (collisionResult.status === 0) {
    const row = queryOne(dbUrl, `select username, needs_profile_completion, char_length(username) <= 20 from public.profiles where id = '${collisionId}';`)
    const [username, needsCompletion, lenOk] = row.split('|')
    check('collision fallback: placeholder username assigned (not the taken one)', username !== 'alice_wonder' && username.startsWith('user_'), row)
    check('collision fallback: needs_profile_completion=true', needsCompletion === 't', row)
    check('collision fallback: placeholder satisfies 3-20 CHECK', lenOk === 't', row)
    const progressCount2 = queryOne(dbUrl, `select count(*) from public.progress where id = '${collisionId}';`)
    check('collision fallback: progress row still inserted', progressCount2 === '1', progressCount2)
  }

  // F2 (review): the placeholder derives from only the first 15 hex of the id,
  // so a pre-squatted matching placeholder could collide on the username UNIQUE
  // index. The fallback must retry with fresh entropy, never strand the auth row.
  // Victim id below derives placeholder 'user_111111112222333'; squat it first.
  const squatResult = insertAuthUser(dbUrl, {
    id: '99999999-0000-0000-0000-000000000009', email: 'squatter@example.com',
    metadata: { username: 'user_111111112222333', birth_year: '2000' },
  })
  check('F2 squatter (holds the victim placeholder) created', squatResult.status === 0, squatResult.stderr)
  const victimId = '11111111-2222-3333-4444-555555555555'
  const victimResult = insertAuthUser(dbUrl, {
    id: victimId, email: 'victim@example.com', metadata: { username: '', birth_year: '2000' },
  })
  check('F2 placeholder-collision victim still created (not stranded)', victimResult.status === 0, victimResult.stderr)
  if (victimResult.status === 0) {
    const row = queryOne(dbUrl, `select username, needs_profile_completion, char_length(username) <= 20 from public.profiles where id = '${victimId}';`)
    const [vUser, vNpc, vLenOk] = row.split('|')
    check('F2 victim got a DIFFERENT placeholder (retry with fresh entropy)', vUser !== 'user_111111112222333' && vUser.startsWith('user_'), row)
    check('F2 victim needs_profile_completion=true', vNpc === 't', row)
    check('F2 victim placeholder within 20-char CHECK', vLenOk === 't', row)
    const vProg = queryOne(dbUrl, `select count(*) from public.progress where id = '${victimId}';`)
    check('F2 victim progress row inserted', vProg === '1', vProg)
  }

  // ── Missing-metadata fallback ───────────────────────────────────────────────
  const missingId = 'ffffffff-0000-0000-0000-000000000006'
  const missingResult = insertAuthUser(dbUrl, {
    id: missingId,
    email: 'noname@example.com',
    metadata: { birth_year: '1995' }, // no username key at all
  })
  check('missing-username signup still succeeds', missingResult.status === 0, missingResult.stderr)
  if (missingResult.status === 0) {
    const row = queryOne(dbUrl, `select username, birth_year, needs_profile_completion from public.profiles where id = '${missingId}';`)
    check('missing-username fallback: placeholder + valid birth_year kept + needs_profile_completion=true', row === `user_ffffffff0000000|1995|t`, row)
  }

  // Blank username string ('') must take the same fallback path.
  const blankId = '11111111-1111-1111-1111-000000000007'
  const blankResult = insertAuthUser(dbUrl, {
    id: blankId,
    email: 'blank@example.com',
    metadata: { username: '' },
  })
  check('blank-username signup still succeeds', blankResult.status === 0, blankResult.stderr)
  if (blankResult.status === 0) {
    const row = queryOne(dbUrl, `select needs_profile_completion from public.profiles where id = '${blankId}';`)
    check('blank-username fallback: needs_profile_completion=true', row === 't', row)
  }

  // F3 (review): a whitespace-only username ('   ') is effectively blank and
  // must take the fallback path, NOT be stored as a real username. Non-empty
  // names are otherwise not trimmed (exact-match freeze) — only empty-after-trim changes.
  const wsId = '11111111-1111-1111-1111-000000000008'
  const wsResult = insertAuthUser(dbUrl, {
    id: wsId, email: 'whitespace@example.com',
    metadata: { username: '   ', birth_year: '2000' },
  })
  check('whitespace-only username signup still succeeds', wsResult.status === 0, wsResult.stderr)
  if (wsResult.status === 0) {
    const row = queryOne(dbUrl, `select username, needs_profile_completion from public.profiles where id = '${wsId}';`)
    const [wsUsername, wsNpc] = row.split('|')
    check('whitespace-only username: placeholder assigned, not stored verbatim', wsUsername.startsWith('user_') && wsUsername !== '   ', row)
    check('whitespace-only username: needs_profile_completion=true', wsNpc === 't', row)
  }

  // ── Placeholder length on a real UUID (max-hex-density case) ──────────────
  const maxHexId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  const lenCheck = queryOne(dbUrl, `select char_length(left('user_' || replace('${maxHexId}','-',''),20));`)
  check('placeholder length is exactly 20 (== the CHECK upper bound) on an all-hex UUID', lenCheck === '20', lenCheck)

  // ── Double-fire idempotency ─────────────────────────────────────────────────
  // AFTER INSERT ON auth.users fires once per row, so a literal "insert the
  // same auth.users row twice" isn't reachable (auth.users.id is itself a
  // PK). Instead we re-run the trigger's own downstream statements — the
  // exact profiles/progress inserts it performs — a second time for the
  // already-existing happy-path id, which is what a genuine re-fire would
  // produce. Both ON CONFLICT (id) DO NOTHING clauses must make this a
  // true no-op: no error, no duplicate row.
  const refire = psql(dbUrl, `
    insert into public.profiles (id, username, birth_year) values ('${happyId}', 'alice_wonder', 2000) on conflict (id) do nothing;
    insert into public.progress (id) values ('${happyId}') on conflict (id) do nothing;
  `)
  check('double-fire (re-run insert path) raises no error', refire.status === 0, refire.stderr)
  const profilesAfter = queryOne(dbUrl, `select count(*) from public.profiles where id = '${happyId}';`)
  const progressAfter = queryOne(dbUrl, `select count(*) from public.progress where id = '${happyId}';`)
  check('double-fire: still exactly one profiles row', profilesAfter === '1', profilesAfter)
  check('double-fire: still exactly one progress row', progressAfter === '1', progressAfter)
} catch (err) {
  results.push(`FAIL auth/trigger: harness error: ${err.message}`)
  failed = true
} finally {
  if (projectDir) {
    stopProject(projectDir)
    destroyProject(projectDir)
  }
}

for (const line of results) console.log(line)
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
// tests/rls/column-restriction.test.mjs
//
// Spec "Required tests" (docs/specs/A3-rls-column-restriction.md): the
// profiles BEFORE UPDATE column-restriction trigger ([N9]) — is_admin
// escalation blocked, id/created_at immutable, birth_year settable only
// while NULL, username/avatar_id writable, and needs_profile_completion
// cleared only by the first username change on a flagged account (not
// otherwise client-settable, and NOT gated on a `user_%` pattern match).
//
// Deny-path RLS policies (cross-user SELECT, anon denial, admin path,
// direct-write denial, grading-secret tables) are covered separately in
// policies.test.mjs.
//
// Requires Docker (supabase CLI local stack) + psql on PATH, same as A1's
// deny-all-smoke.test.mjs. SKIPS (exit 0), not fails, when either is
// unavailable — this build environment had neither (see A3 handoff notes),
// so this has been sanity-checked against a hand-rolled non-Docker Postgres
// stub (auth.uid()/auth.users approximation) but NOT executed against the
// real supabase CLI local stack. It genuinely runs on any Docker-capable
// runner (e.g. GitHub Actions ubuntu-latest).
//
// Run: node tests/rls/column-restriction.test.mjs

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
  console.log('SKIP rls/column-restriction: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rls/column-restriction: psql is not available on PATH. Required to exercise the authenticated role against the local stack.')
  process.exit(0)
}

// Fixed fixture UUIDs.
const USER_F = 'f0000000-0000-0000-0000-000000000001' // birth_year NULL — escalation / id / created_at / birth_year-settable / username-avatar cases
const USER_G = 'f0000000-0000-0000-0000-000000000002' // birth_year already set — immutable-once-set case
const USER_C = 'f0000000-0000-0000-0000-000000000003' // needs_profile_completion flagged — plain rename
const USER_D = 'f0000000-0000-0000-0000-000000000004' // needs_profile_completion flagged — user_-prefixed rename (no pattern-matching proof)

let failed = false
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} rls/column-restriction: ${name}${ok ? '' : ` — ${detail ?? ''}`}`)
}

function authUserInsert(id, email) {
  return `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${id}', 'authenticated', 'authenticated', '${email}', 'not-a-real-hash',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}'
    );
  `
}

// Runs `sql` as the given Postgres role with an optional JWT `sub` claim,
// in unaligned tuples-only mode (easiest to parse exact column values from).
// The last non-empty output line is always the trailing SELECT's row (SET /
// UPDATE n command tags print as their own lines before it).
function asRole(dbUrl, role, jwtSub, sql) {
  const preamble = jwtSub
    ? `set role ${role}; set request.jwt.claims = '{"sub":"${jwtSub}","role":"${role}"}';`
    : `set role ${role};`
  return spawnSync('psql', [dbUrl, '-t', '-A', '-F', '|', '-c', `${preamble} ${sql}`], { encoding: 'utf8' })
}

function lastLine(stdout) {
  const lines = stdout.trim().split('\n')
  return lines[lines.length - 1]
}

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  const seed = psql(dbUrl, `
    ${authUserInsert(USER_F, 'f@rls-test.local')}
    ${authUserInsert(USER_G, 'g@rls-test.local')}
    ${authUserInsert(USER_C, 'c@rls-test.local')}
    ${authUserInsert(USER_D, 'd@rls-test.local')}

    -- Integration reality (operator, CI fix 2026-07-08): A2's
    -- on_auth_user_created trigger (0002, applied on the full-chain shadow)
    -- has already auto-created profiles + progress rows for the users above.
    -- Clear them so the exact fixture rows below insert cleanly, as
    -- originally verified (progress rows first — FK).
    delete from public.progress where id in ('${USER_F}', '${USER_G}', '${USER_C}', '${USER_D}');
    delete from public.profiles where id in ('${USER_F}', '${USER_G}', '${USER_C}', '${USER_D}');

    insert into public.profiles (id, username, is_admin, birth_year, needs_profile_completion) values
      ('${USER_F}', 'rls_user_f', false, null, false),
      ('${USER_G}', 'rls_user_g', false, 1990, false),
      ('${USER_C}', 'placeholder_c', false, null, true),
      ('${USER_D}', 'placeholder_d', false, null, true);
  `)
  if (seed.status !== 0) {
    throw new Error(`fixture seed failed:\n${seed.stdout}\n${seed.stderr}`)
  }

  const originalCreatedAt = lastLine(
    spawnSync('psql', [dbUrl, '-t', '-A', '-c', `select created_at from public.profiles where id = '${USER_F}';`], { encoding: 'utf8' }).stdout,
  )

  // ── is_admin escalation blocked ─────────────────────────────────────────────
  {
    const r = asRole(dbUrl, 'authenticated', USER_F,
      `update public.profiles set is_admin = true where id = '${USER_F}'; select is_admin from public.profiles where id = '${USER_F}';`)
    record('is_admin escalation blocked (own-profile UPDATE leaves is_admin=false)', r.status === 0 && lastLine(r.stdout) === 'f', r.stdout + r.stderr)
  }

  // ── id / created_at immutable ───────────────────────────────────────────────
  {
    const BOGUS_ID = '00000000-1111-2222-3333-444444444444'
    const r = asRole(dbUrl, 'authenticated', USER_F,
      `update public.profiles set id = '${BOGUS_ID}', created_at = '2000-01-01' where id = '${USER_F}'; select id, created_at from public.profiles where id = '${USER_F}';`)
    const [id, createdAt] = lastLine(r.stdout).split('|')
    const createdAtOk = r.status === 0 && !!createdAt && !createdAt.startsWith('2000-01-01') && createdAt.trim() === originalCreatedAt.trim()
    record('id immutable on self-update', r.status === 0 && id === USER_F, r.stdout + r.stderr)
    record('created_at immutable on self-update (matches the pre-update value, not the bogus one)', createdAtOk, r.stdout + r.stderr)
  }

  // ── birth_year settable only while NULL ─────────────────────────────────────
  {
    const r = asRole(dbUrl, 'authenticated', USER_F,
      `update public.profiles set birth_year = 1995 where id = '${USER_F}'; select birth_year from public.profiles where id = '${USER_F}';`)
    record('birth_year settable while currently NULL', r.status === 0 && lastLine(r.stdout) === '1995', r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'authenticated', USER_G,
      `update public.profiles set birth_year = 2005 where id = '${USER_G}'; select birth_year from public.profiles where id = '${USER_G}';`)
    record('birth_year immutable once set (cannot overwrite non-NULL value)', r.status === 0 && lastLine(r.stdout) === '1990', r.stdout + r.stderr)
  }

  // ── username / avatar_id writable ───────────────────────────────────────────
  {
    const r = asRole(dbUrl, 'authenticated', USER_F,
      `update public.profiles set username = 'rls_user_f_renamed', avatar_id = 4 where id = '${USER_F}'; select username, avatar_id from public.profiles where id = '${USER_F}';`)
    const [username, avatarId] = lastLine(r.stdout).split('|')
    record('username and avatar_id are writable', r.status === 0 && username === 'rls_user_f_renamed' && avatarId === '4', r.stdout + r.stderr)
  }

  // ── needs_profile_completion: not directly settable ─────────────────────────
  {
    const r = asRole(dbUrl, 'authenticated', USER_C,
      `update public.profiles set needs_profile_completion = false where id = '${USER_C}'; select needs_profile_completion from public.profiles where id = '${USER_C}';`)
    record('needs_profile_completion cannot be directly cleared without a username change', r.status === 0 && lastLine(r.stdout) === 't', r.stdout + r.stderr)
  }

  // ── needs_profile_completion: cleared by the first valid username change ────
  {
    const r = asRole(dbUrl, 'authenticated', USER_C,
      `update public.profiles set username = 'chosen_by_c' where id = '${USER_C}'; select username, needs_profile_completion from public.profiles where id = '${USER_C}';`)
    const [username, npc] = lastLine(r.stdout).split('|')
    record('needs_profile_completion cleared by first username change', r.status === 0 && username === 'chosen_by_c' && npc === 'f', r.stdout + r.stderr)
  }

  // ── needs_profile_completion: cannot be directly re-set to true afterward ───
  {
    const r = asRole(dbUrl, 'authenticated', USER_C,
      `update public.profiles set needs_profile_completion = true where id = '${USER_C}'; select needs_profile_completion from public.profiles where id = '${USER_C}';`)
    record('needs_profile_completion cannot be directly re-set to true', r.status === 0 && lastLine(r.stdout) === 'f', r.stdout + r.stderr)
  }

  // ── needs_profile_completion: a second username change does not re-flip it ──
  {
    const r = asRole(dbUrl, 'authenticated', USER_C,
      `update public.profiles set username = 'chosen_by_c_2' where id = '${USER_C}'; select needs_profile_completion from public.profiles where id = '${USER_C}';`)
    record('needs_profile_completion stays false on a subsequent username change (only the first clears it)', r.status === 0 && lastLine(r.stdout) === 'f', r.stdout + r.stderr)
  }

  // ── needs_profile_completion: user_-prefixed rename still clears the flag ───
  // (D-008 §5: deliberately NOT pattern-matched against the `user_%` placeholder)
  {
    const r = asRole(dbUrl, 'authenticated', USER_D,
      `update public.profiles set username = 'user_legit_choice' where id = '${USER_D}'; select username, needs_profile_completion from public.profiles where id = '${USER_D}';`)
    const [username, npc] = lastLine(r.stdout).split('|')
    record('a legitimately-chosen user_-prefixed username still clears needs_profile_completion (no pattern-matching)', r.status === 0 && username === 'user_legit_choice' && npc === 'f', r.stdout + r.stderr)
  }
} catch (err) {
  console.error(`FAIL rls/column-restriction: harness error: ${err.message}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rls/column-restriction summary: ${results.filter(r => r.ok).length}/${results.length} passed ===`)
process.exit(failed ? 1 : 0)

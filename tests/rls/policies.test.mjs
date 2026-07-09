#!/usr/bin/env node
// tests/rls/policies.test.mjs
//
// Spec "Required tests" (docs/specs/A3-rls-column-restriction.md): deny-path
// per policy per table — cross-user SELECT denial, anon denial on all eight
// tables, non-admin-cannot-use-admin-path / admin-can, direct write denial
// (proving the RPC-only write path holds even before B* exists), and the
// grading-secret / default-deny tables (xp_awards, quiz_answer_keys,
// topics_catalog) remaining unreadable.
//
// The profiles BEFORE UPDATE column-restriction trigger (is_admin
// escalation, birth_year/id/created_at immutability, needs_profile_completion
// derivation) is covered separately in column-restriction.test.mjs.
//
// Requires Docker (supabase CLI local stack) + psql on PATH, same as A1's
// deny-all-smoke.test.mjs. SKIPS (exit 0), not fails, when either is
// unavailable — this build environment had neither (see A3 handoff notes),
// so this has been sanity-checked against a hand-rolled non-Docker Postgres
// stub (auth.uid()/auth.users approximation) but NOT executed against the
// real supabase CLI local stack. It genuinely runs on any Docker-capable
// runner (e.g. GitHub Actions ubuntu-latest).
//
// Fixture users are seeded via DIRECT inserts against the DB_URL connection
// (the `postgres` superuser role from `supabase status -o env`, which
// bypasses RLS) — the spec explicitly permits this in lieu of depending on
// A2's on_auth_user_created trigger, which is not in this worktree (0003
// only depends on 0001).
//
// Run: node tests/rls/policies.test.mjs

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
  console.log('SKIP rls/policies: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rls/policies: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

// Fixed fixture UUIDs (readable, no randomness needed for a throwaway DB).
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ADMIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

let failed = false
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} rls/policies: ${name}${ok ? '' : ` — ${detail ?? ''}`}`)
}

// Minimal service-role auth.users insert. See column-restriction.test.mjs
// for the same recipe; kept duplicated per this repo's convention of
// self-contained test files (no new shared lib in A3's in-scope list).
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

// Runs `sql` as the given Postgres role, with an optional JWT `sub` claim
// (mirrors what PostgREST sets per-request; auth.uid() reads it from the
// request.jwt.claims GUC).
function asRole(dbUrl, role, jwtSub, sql) {
  const preamble = jwtSub
    ? `set role ${role}; set request.jwt.claims = '{"sub":"${jwtSub}","role":"${role}"}';`
    : `set role ${role};`
  return spawnSync('psql', [dbUrl, '-c', `${preamble} ${sql}`], { encoding: 'utf8' })
}

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // ── seed fixtures (service-role / superuser, bypasses RLS) ────────────────
  const seed = psql(dbUrl, `
    ${authUserInsert(USER_A, 'a@rls-test.local')}
    ${authUserInsert(USER_B, 'b@rls-test.local')}
    ${authUserInsert(ADMIN, 'admin@rls-test.local')}

    -- Integration reality (operator, CI fix 2026-07-08): with the full
    -- migration chain applied, A2's on_auth_user_created trigger has already
    -- auto-created profiles + progress rows for the inserts above (this
    -- worktree's original assumption — 0003 only depends on 0001 — no longer
    -- holds on the CI shadow). Clear the trigger-created rows so the exact
    -- fixture rows below insert cleanly, as originally verified.
    delete from public.progress where id in ('${USER_A}', '${USER_B}', '${ADMIN}');
    delete from public.profiles where id in ('${USER_A}', '${USER_B}', '${ADMIN}');

    insert into public.profiles (id, username, is_admin, birth_year) values
      ('${USER_A}', 'rls_user_a', false, 1990),
      ('${USER_B}', 'rls_user_b', false, 1991),
      ('${ADMIN}', 'rls_admin', true, 1980);

    insert into public.progress (id) values ('${USER_A}'), ('${USER_B}');

    insert into public.evolved_takes (user_id, topic_id, opinion_builder_id, cold_take, evolved_take, xp_earned) values
      ('${USER_A}', 'topic1', 'ob1', 'yes', 'evolved a', 100),
      ('${USER_B}', 'topic1', 'ob1', 'no', 'evolved b', 100);

    insert into public.nuance_sessions (user_id, kind, answers, score) values
      ('${USER_A}', 'baseline', '[]', 5),
      ('${USER_B}', 'baseline', '[]', 6);
  `)
  if (seed.status !== 0) {
    throw new Error(`fixture seed failed:\n${seed.stdout}\n${seed.stderr}`)
  }

  // ── cross-user SELECT denial (A cannot see B) ──────────────────────────────
  for (const [table, col] of [['profiles', 'id'], ['progress', 'id'], ['evolved_takes', 'user_id'], ['nuance_sessions', 'user_id']]) {
    const r = asRole(dbUrl, 'authenticated', USER_A, `select count(*) from public.${table} where ${col} = '${USER_B}';`)
    const ok = r.status === 0 && /\n\s*0\s*\n/.test(r.stdout)
    record(`cross-user SELECT denial: A cannot see B's row in ${table}`, ok, r.stdout + r.stderr)
  }

  // ── anon SELECT denial on all eight tables ─────────────────────────────────
  const ALL_TABLES = ['profiles', 'progress', 'evolved_takes', 'nuance_sessions', 'xp_awards', 'quiz_answer_keys', 'topics_catalog', 'events']
  for (const table of ALL_TABLES) {
    const r = asRole(dbUrl, 'anon', null, `select * from public.${table};`)
    const zeroRows = /\(0 rows\)/.test(r.stdout)
    const denied = /permission denied/i.test(r.stderr)
    record(`anon SELECT denial on ${table}`, r.status === 0 ? zeroRows : denied, r.stdout + r.stderr)
  }

  // ── non-admin cannot use the admin path; admin can read all ───────────────
  {
    const nonAdmin = asRole(dbUrl, 'authenticated', USER_A, `select count(*) from public.profiles;`)
    const nonAdminSeesOnlyOwn = nonAdmin.status === 0 && /\n\s*1\s*\n/.test(nonAdmin.stdout)
    record('non-admin SELECT profiles sees only own row (admin path does not apply)', nonAdminSeesOnlyOwn, nonAdmin.stdout + nonAdmin.stderr)

    // Also proves is_admin() does not recurse: a policy-recursion error would
    // surface here as a Postgres error (infinite recursion detected), not a
    // clean row count.
    const admin = asRole(dbUrl, 'authenticated', ADMIN, `select count(*) from public.profiles;`)
    const adminSeesAll = admin.status === 0 && /\n\s*3\s*\n/.test(admin.stdout)
    record('admin SELECT profiles returns all rows (is_admin() does not recurse)', adminSeesAll, admin.stdout + admin.stderr)

    for (const table of ['progress', 'evolved_takes', 'nuance_sessions']) {
      const r = asRole(dbUrl, 'authenticated', ADMIN, `select count(*) from public.${table};`)
      const ok = r.status === 0 && /\n\s*2\s*\n/.test(r.stdout)
      record(`admin SELECT ${table} returns all rows`, ok, r.stdout + r.stderr)
    }
  }

  // ── direct write denial (RPC-only write path) ──────────────────────────────
  {
    const r = asRole(dbUrl, 'authenticated', USER_A, `update public.progress set total_xp = 999 where id = '${USER_A}';`)
    const denied = (r.status === 0 && /UPDATE 0/.test(r.stdout)) || /permission denied|row-level security/i.test(r.stderr)
    record('direct UPDATE progress by authenticated user denied', denied, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'authenticated', USER_A, `insert into public.evolved_takes (user_id, topic_id, opinion_builder_id, cold_take, evolved_take, xp_earned) values ('${USER_A}', 'topic2', 'ob2', 'yes', 'x', 10);`)
    const denied = r.status !== 0 && /permission denied|row-level security/i.test(r.stderr)
    record('direct INSERT evolved_takes by authenticated user denied', denied, r.stdout + r.stderr)
  }
  {
    const r = asRole(dbUrl, 'authenticated', USER_A, `insert into public.nuance_sessions (user_id, kind, answers, score) values ('${USER_A}', 'day30', '[]', 5);`)
    const denied = r.status !== 0 && /permission denied|row-level security/i.test(r.stderr)
    record('direct INSERT nuance_sessions by authenticated user denied', denied, r.stdout + r.stderr)
  }

  // ── grading-secret / default-deny tables unreadable ────────────────────────
  for (const table of ['xp_awards', 'quiz_answer_keys', 'topics_catalog']) {
    for (const [role, sub] of [['authenticated', USER_A], ['authenticated', ADMIN], ['anon', null]]) {
      const r = asRole(dbUrl, role, sub, `select * from public.${table};`)
      const zeroRows = /\(0 rows\)/.test(r.stdout)
      const denied = /permission denied/i.test(r.stderr)
      const who = sub === ADMIN ? 'admin' : role
      record(`${table} unreadable by ${who} (default-deny, no policy at all)`, r.status === 0 ? zeroRows : denied, r.stdout + r.stderr)
    }
  }
} catch (err) {
  console.error(`FAIL rls/policies: harness error: ${err.message}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rls/policies summary: ${results.filter(r => r.ok).length}/${results.length} passed ===`)
process.exit(failed ? 1 : 0)

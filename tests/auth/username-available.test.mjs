#!/usr/bin/env node
// tests/auth/username-available.test.mjs
//
// Spec docs/specs/A2-auth-trigger-username.md, "Required tests":
// public.username_available(name text) — taken / too-short / too-long /
// free, and callable as anon (it's a pre-flight check, used before login).
//
// Requires Docker (local Supabase CLI stack) + psql, same as
// deny-all-smoke.test.mjs. SKIPs (exit 0), not fails, when either is
// missing — per A1's deny-all-smoke precedent.
//
// Run: node tests/auth/username-available.test.mjs

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
  console.log('SKIP auth/username-available: Docker is not available in this environment (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP auth/username-available: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

let stack
let failed = false
const results = []

function check(name, condition, detail) {
  if (condition) {
    results.push(`PASS auth/username-available: ${name}`)
  } else {
    results.push(`FAIL auth/username-available: ${name}${detail ? ` — ${detail}` : ''}`)
    failed = true
  }
}

// Runs `set role <role>; select public.username_available('<name>');` and
// returns the raw 't'/'f' text (same technique as deny-all-smoke.test.mjs's
// `set role` probing — a fresh psql connection per call, so the role change
// never leaks between checks).
function usernameAvailable(dbUrl, name, role = 'anon') {
  const escaped = name.replace(/'/g, "''")
  const sql = `set role ${role}; select public.username_available('${escaped}');`
  const result = spawnSync('psql', [dbUrl, '-t', '-A', '-c', sql], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`username_available('${name}') as ${role} failed:\n${result.stderr}`)
  }
  // stdout is "SET\nt" — `-t` suppresses headers/footers but NOT the SET
  // command tag, so take the last non-empty line (the select's value).
  // This was the auth CI job's actual failure: trim() alone returns
  // "SET\nt", which never equals 't'/'f'. (operator, CI fix 2026-07-08)
  const lines = result.stdout.trim().split('\n')
  return lines[lines.length - 1].trim()
}

try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // Seed one taken username via a real auth.users insert (fires the A2
  // trigger, same as trigger.test.mjs), so this test also implicitly
  // exercises 0002 applying + the happy path, independent of trigger.test.mjs.
  const seedId = 'a0000000-0000-0000-0000-00000000000a'
  const seed = psql(dbUrl, `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '${seedId}', 'authenticated', 'authenticated',
      'taken@example.com', '', now(), '{}', '{"username":"taken_name","birth_year":"2000"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  `)
  if (seed.status !== 0) throw new Error(`seed insert failed:\n${seed.stderr}`)

  check('taken name returns false (as anon)', usernameAvailable(dbUrl, 'taken_name', 'anon') === 'f')
  check('2-char name returns false (below 3-20 CHECK, as anon)', usernameAvailable(dbUrl, 'ab', 'anon') === 'f')
  check('21-char name returns false (above 3-20 CHECK, as anon)', usernameAvailable(dbUrl, 'a'.repeat(21), 'anon') === 'f')
  check('free valid name returns true (as anon)', usernameAvailable(dbUrl, 'brand_new_free_name', 'anon') === 't')

  // Boundary: exactly 3 and exactly 20 chars, both free, must be true.
  check('exactly-3-char free name returns true (lower CHECK bound)', usernameAvailable(dbUrl, 'abc', 'anon') === 't')
  check('exactly-20-char free name returns true (upper CHECK bound)', usernameAvailable(dbUrl, 'a'.repeat(20), 'anon') === 't')

  // Case-sensitive exact match (D-008 §1 freeze ruling): a different-case
  // variant of a taken name must still be reported available, matching the
  // UNIQUE index's plain (case-sensitive) comparison.
  check('case-variant of a taken name returns true (case-sensitive match, D-008 §1)', usernameAvailable(dbUrl, 'Taken_Name', 'anon') === 't')

  // Also callable as authenticated (granted alongside anon per the spec).
  check('free valid name returns true (as authenticated)', usernameAvailable(dbUrl, 'another_free_name', 'authenticated') === 't')
} catch (err) {
  results.push(`FAIL auth/username-available: harness error: ${err.message}`)
  failed = true
} finally {
  if (stack) stack.release()
}

for (const line of results) console.log(line)
process.exit(failed ? 1 : 0)

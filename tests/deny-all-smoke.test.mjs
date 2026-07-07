#!/usr/bin/env node
// tests/deny-all-smoke.test.mjs
//
// Spec "Required tests": deny-all smoke — with 0001 applied and no policies,
// SELECT on profiles/progress as anon and as an authenticated role returns
// zero rows / permission denied.
//
// Requires Docker (for the supabase CLI's local Postgres+Auth+PostgREST
// stack) and a `psql` client on PATH. NEITHER was available in the A1 build
// environment (no `docker` binary at all) — this test could not be executed
// there. It SKIPS (exit 0) rather than fail when its prerequisites are
// missing, so it does not falsely redden CI on runners that lack Docker,
// but genuinely runs the check on any runner that has it (e.g. GitHub
// Actions' standard Linux runners, which do).
//
// Run: node tests/deny-all-smoke.test.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  hasDocker, createProject, startProject, stopProject, destroyProject, getDbUrl,
} from './lib/supabase-stack.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

function hasPsql() {
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

if (!hasDocker()) {
  console.log('SKIP deny-all-smoke: Docker is not available in this environment (required for the supabase CLI local stack). Run in CI / a Docker-capable environment.')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP deny-all-smoke: psql is not available on PATH. Required to exercise anon/authenticated roles against the local stack.')
  process.exit(0)
}

const TABLES = ['profiles', 'progress']
let projectDir
let failed = false

try {
  projectDir = createProject({ repoRoot: REPO_ROOT, withMigrations: true })
  startProject(projectDir)
  const dbUrl = getDbUrl(projectDir)

  for (const table of TABLES) {
    for (const role of ['anon', 'authenticated']) {
      const sql = `set role ${role}; select * from public.${table};`
      const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })

      // Deny-all (RLS enabled, zero policies) means the SELECT must either
      // error (permission denied) or return zero data rows. psql exits
      // non-zero on a SQL error with ON_ERROR_STOP=1, which is the expected
      // path here since these tables have no policies at all.
      if (result.status === 0) {
        // No error — check the row count is actually zero (defensive; RLS
        // with zero policies should error, not silently return rows).
        const returnedRows = /\(0 rows\)/.test(result.stdout)
        if (!returnedRows) {
          console.error(`FAIL deny-all-smoke: role '${role}' SELECT on '${table}' succeeded and returned rows — RLS default-deny is broken`)
          console.error(result.stdout)
          failed = true
          continue
        }
        console.log(`PASS deny-all-smoke: role '${role}' SELECT on '${table}' returned zero rows`)
      } else {
        if (!/permission denied/i.test(result.stderr)) {
          console.error(`FAIL deny-all-smoke: role '${role}' SELECT on '${table}' failed, but not with 'permission denied' as expected`)
          console.error(result.stderr)
          failed = true
          continue
        }
        console.log(`PASS deny-all-smoke: role '${role}' SELECT on '${table}' correctly denied`)
      }
    }
  }
} catch (err) {
  console.error(`FAIL deny-all-smoke: harness error: ${err.message}`)
  failed = true
} finally {
  if (projectDir) {
    stopProject(projectDir)
    destroyProject(projectDir)
  }
}

process.exit(failed ? 1 : 0)

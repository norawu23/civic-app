#!/usr/bin/env node
// tests/repair-rehearsal.test.mjs
//
// Spec "Required tests": repair rehearsal — applies the prod dump to a
// scratch DB, runs repair_prod.sql, runs schema-diff.sh, asserts empty.
//
// This test is SKIPPED-WITH-REASON until the operator-supplied schema-only
// pg_dump of live prod exists (see docs/specs/A1-migration-squash.md
// "Interfaces consumed" and the authorized deviation for this build: the
// dump was not available). It is written as a ready-to-run harness: once
// the dump lands, point this at it (CLI arg or PROD_DUMP_PATH env var) and
// it exercises the real rehearsal end-to-end. It also requires Docker +
// psql, same as deny-all-smoke.test.mjs, neither of which was available in
// the A1 build environment — so beyond the dump being absent, this has not
// been executed at all.
//
// Usage: node tests/repair-rehearsal.test.mjs [path/to/prod-schema-only-dump.sql]
//   (or: PROD_DUMP_PATH=path/to/dump.sql node tests/repair-rehearsal.test.mjs)

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  hasDocker, createProject, startProject, stopProject, destroyProject, getDbUrl, psqlFile,
} from './lib/supabase-stack.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const REPAIR_SQL = join(REPO_ROOT, 'supabase', 'repair_prod.sql')
const SCHEMA_DIFF = join(REPO_ROOT, 'scripts', 'schema-diff.sh')

const dumpPath = process.argv[2] || process.env.PROD_DUMP_PATH

if (!dumpPath) {
  console.log('SKIP repair-rehearsal: no prod dump supplied (pass a path as argv[1] or set PROD_DUMP_PATH). Awaiting the operator-supplied schema-only pg_dump of live prod per docs/specs/A1-migration-squash.md — this build shipped repair_prod.sql as a documented skeleton, not a runnable script, for exactly this reason.')
  process.exit(0)
}

if (!existsSync(dumpPath)) {
  console.log(`SKIP repair-rehearsal: dump path '${dumpPath}' does not exist.`)
  process.exit(0)
}

function hasPsql() {
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

if (!hasDocker()) {
  console.log('SKIP repair-rehearsal: Docker is not available in this environment (required for the supabase CLI local stack).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP repair-rehearsal: psql is not available on PATH.')
  process.exit(0)
}

let shadowDir, scratchDir
let failed = false

try {
  // Shadow: fresh project, 0001 migrations applied on start.
  shadowDir = createProject({ repoRoot: REPO_ROOT, withMigrations: true })
  startProject(shadowDir)
  const shadowDbUrl = getDbUrl(shadowDir)

  // Scratch: fresh project, NO migrations — we apply the prod dump by hand,
  // then repair_prod.sql, to rehearse the real runbook (BUILD_PLAN §3a).
  scratchDir = createProject({ repoRoot: REPO_ROOT, withMigrations: false })
  startProject(scratchDir)
  const scratchDbUrl = getDbUrl(scratchDir)

  const dumpApply = psqlFile(scratchDbUrl, dumpPath)
  if (dumpApply.status !== 0) {
    throw new Error(`applying the prod dump to the scratch DB failed:\n${dumpApply.stdout}\n${dumpApply.stderr}`)
  }

  const repairApply = psqlFile(scratchDbUrl, REPAIR_SQL)
  if (repairApply.status !== 0) {
    throw new Error(`applying repair_prod.sql to the scratch DB failed:\n${repairApply.stdout}\n${repairApply.stderr}`)
  }

  const diff = spawnSync('bash', [SCHEMA_DIFF, scratchDbUrl, shadowDbUrl], { encoding: 'utf8' })
  if (diff.status === 0) {
    console.log('PASS repair-rehearsal: schema-diff.sh reports an empty diff between the repaired scratch DB and the 0001 shadow DB')
  } else {
    console.error('FAIL repair-rehearsal: schema-diff.sh reports a non-empty diff (or errored) between the repaired scratch DB and the 0001 shadow DB')
    console.error(diff.stdout)
    console.error(diff.stderr)
    failed = true
  }
} catch (err) {
  console.error(`FAIL repair-rehearsal: harness error: ${err.message}`)
  failed = true
} finally {
  for (const dir of [shadowDir, scratchDir]) {
    if (dir) {
      stopProject(dir)
      destroyProject(dir)
    }
  }
}

process.exit(failed ? 1 : 0)

// tests/lib/supabase-stack.mjs
//
// Shared helper for spinning up a throwaway local Supabase stack (Postgres +
// Auth + PostgREST via the supabase CLI's `db start`), used by both
// deny-all-smoke.test.mjs and repair-rehearsal.test.mjs.
//
// Requires Docker. Both callers check `hasDocker()` first and SKIP (not
// fail) when it's unavailable — this environment did not have Docker at
// build time, so none of this has been exercised end-to-end. See each
// test's own header comment and the A1 handoff notes.
//
// Deliberately does NOT write a supabase/config.toml into the real worktree
// (that file is outside A1's in-scope file list): every stack is created in
// a throwaway temp directory with its own `supabase init`-generated config,
// so the real repo's supabase/ directory is never touched by running tests.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function hasDocker() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore' })
  return result.status === 0
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return result
}

// Creates a fresh throwaway supabase project directory.
//   withMigrations: if true, copies the real supabase/migrations/ in so
//     `supabase start` applies 0001_schema.sql on boot (the "shadow" DB).
//     If false, the project starts with an empty public schema (the
//     "scratch" DB, onto which a rehearsal test applies a dump + repair by
//     hand).
export function createProject({ repoRoot, withMigrations }) {
  const dir = mkdtempSync(join(tmpdir(), 'civic-supabase-'))
  mkdirSync(join(dir, 'supabase'), { recursive: true })

  if (withMigrations) {
    cpSync(
      join(repoRoot, 'supabase', 'migrations'),
      join(dir, 'supabase', 'migrations'),
      { recursive: true },
    )
  }

  const init = run('npx', ['--yes', 'supabase', 'init', '--workdir', dir])
  if (init.status !== 0) {
    throw new Error(`supabase init failed:\n${init.stdout}\n${init.stderr}`)
  }

  return dir
}

export function startProject(dir) {
  const result = run('npx', ['--yes', 'supabase', 'start', '--workdir', dir])
  if (result.status !== 0) {
    throw new Error(`supabase start failed:\n${result.stdout}\n${result.stderr}`)
  }
}

export function stopProject(dir) {
  // Best-effort teardown — don't throw if this fails, we're cleaning up.
  run('npx', ['--yes', 'supabase', 'stop', '--workdir', dir, '--no-backup'])
}

export function destroyProject(dir) {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}

// Returns the direct Postgres connection string for a started project, by
// parsing `supabase status -o env --workdir <dir>`.
export function getDbUrl(dir) {
  const result = run('npx', ['--yes', 'supabase', 'status', '-o', 'env', '--workdir', dir])
  if (result.status !== 0) {
    throw new Error(`supabase status failed:\n${result.stdout}\n${result.stderr}`)
  }
  const match = result.stdout.match(/DB_URL="?([^"\n]+)"?/)
  if (!match) throw new Error(`could not parse DB_URL from supabase status output:\n${result.stdout}`)
  return match[1]
}

// Runs a SQL string against a project's DB via `psql` inside the local
// Postgres container (avoids needing a psql/pg client on the host).
export function psql(dbUrl, sql) {
  return run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql])
}

// Runs a SQL file the same way.
export function psqlFile(dbUrl, filePath) {
  return run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', filePath])
}

#!/usr/bin/env node
// tests/column-refs-negative.test.mjs
//
// Spec "Required tests": negative test for the grep gate — a fixture file
// referencing a fake column turns the job red. Also asserts the real gate
// stays green against src/ (regression: catches the checker itself breaking).
//
// Run: node tests/column-refs-negative.test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CHECKER = join(REPO_ROOT, 'scripts', 'check-column-refs.mjs')
const FIXTURE_DIR = join(__dirname, 'fixtures', 'column-refs-bad')

let failed = false

function run(args) {
  return spawnSync('node', [CHECKER, ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
}

// 1. The fixture (references profiles.this_column_does_not_exist) must turn
//    the gate red, with no allowlist to save it.
{
  const result = run(['--dir', FIXTURE_DIR, '--allowlist', '/dev/null'])
  if (result.status === 0) {
    console.error('FAIL column-refs-negative: fixture with a fake column did NOT turn the gate red (expected non-zero exit)')
    failed = true
  } else if (!result.stderr.includes('this_column_does_not_exist')) {
    console.error('FAIL column-refs-negative: gate went red, but did not report the offending column name')
    console.error(`  stderr was:\n${result.stderr}`)
    failed = true
  } else {
    console.log('PASS column-refs-negative: fixture with a fake column correctly turns the gate red')
  }
}

// 2. The real src/ tree, with the checked-in allowlist, must stay green —
//    proves the negative-test fixture is a real negative, not just a bug in
//    the checker that flags everything.
{
  const result = run([])
  if (result.status !== 0) {
    console.error('FAIL column-refs-negative: real src/ tree (with the checked-in allowlist) unexpectedly went red')
    console.error(`  stderr was:\n${result.stderr}`)
    failed = true
  } else {
    console.log('PASS column-refs-negative: real src/ tree stays green with the checked-in allowlist')
  }
}

process.exit(failed ? 1 : 0)

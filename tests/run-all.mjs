#!/usr/bin/env node
// tests/run-all.mjs
//
// Runs every A1 test script in this directory and reports PASS/FAIL/SKIP
// per file, exiting non-zero iff any test FAILED (a SKIP does not fail the
// run — see each test's own header for why it skips in this environment).
//
// Run: node tests/run-all.mjs

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const files = readdirSync(__dirname)
  .filter(f => f.endsWith('.test.mjs'))
  .sort()

let anyFailed = false
const summary = []

for (const file of files) {
  const path = join(__dirname, file)
  console.log(`\n=== ${file} ===`)
  const result = spawnSync('node', [path], { encoding: 'utf8', stdio: 'inherit' })
  const status = result.status === 0 ? 'PASS/SKIP' : 'FAIL'
  if (result.status !== 0) anyFailed = true
  summary.push({ file, status })
}

console.log('\n=== summary ===')
for (const { file, status } of summary) {
  console.log(`${status.padEnd(9)} ${file}`)
}

process.exit(anyFailed ? 1 : 0)

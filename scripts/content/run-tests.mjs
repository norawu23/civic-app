#!/usr/bin/env node
// scripts/content/run-tests.mjs
//
// Runs every H1 content-pipeline test script (fixture-driven, no DB needed)
// and reports PASS/FAIL per file, exiting non-zero iff any file failed.
// Mirrors the shape of tests/run-all.mjs (A1) without depending on it.
//
// Run: node scripts/content/run-tests.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const files = ['validate.test.mjs', 'lint-sources.test.mjs', 'seed.test.mjs']

let anyFailed = false
const summary = []

for (const file of files) {
  const path = join(__dirname, file)
  console.log(`\n=== ${file} ===`)
  const result = spawnSync('node', [path], { encoding: 'utf8', stdio: 'inherit' })
  const status = result.status === 0 ? 'PASS' : 'FAIL'
  if (result.status !== 0) anyFailed = true
  summary.push({ file, status })
}

console.log('\n=== summary ===')
for (const { file, status } of summary) {
  console.log(`${status.padEnd(4)} ${file}`)
}

process.exit(anyFailed ? 1 : 0)

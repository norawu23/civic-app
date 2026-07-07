#!/usr/bin/env node
// scripts/content/validate.test.mjs
//
// Required test: "Validator: one green fixture + one fixture per failure
// mode above (red)" (H1 spec). Drives validate.mjs's CLI as a subprocess
// against each fixture in scripts/content/fixtures/ and asserts exit code +
// (for the red cases) that the reported error actually names the intended
// failure, so this doesn't just check "exits non-zero" but "fails for the
// right reason".
//
// Run: node scripts/content/validate.test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VALIDATE = join(__dirname, 'validate.mjs')
const FIXTURES = join(__dirname, 'fixtures')

let failed = false

function runFile(file) {
  return spawnSync('node', [VALIDATE, '--file', join(FIXTURES, file)], { encoding: 'utf8' })
}

function runDir(dir) {
  return spawnSync('node', [VALIDATE, '--dir', join(FIXTURES, dir)], { encoding: 'utf8' })
}

function check(label, result, { expectFail, mustContain }) {
  const failedActually = result.status !== 0
  if (failedActually !== expectFail) {
    console.error(`FAIL ${label}: expected exit ${expectFail ? 'non-zero' : '0'}, got ${result.status}`)
    console.error(result.stdout + result.stderr)
    failed = true
    return
  }
  if (mustContain) {
    const out = result.stdout + result.stderr
    if (!out.includes(mustContain)) {
      console.error(`FAIL ${label}: expected output to contain ${JSON.stringify(mustContain)}, got:\n${out}`)
      failed = true
      return
    }
  }
  console.log(`PASS ${label}`)
}

// 1. Green fixture — the real content (all 5 files), unmodified.
check(
  'validate: real src/data content passes clean',
  spawnSync('node', [VALIDATE], { encoding: 'utf8' }),
  { expectFail: false, mustContain: 'PASS content:validate' },
)

// 2. Green fixture — the minimal standalone fixture.
check('validate: valid.json fixture passes', runFile('valid.json'), { expectFail: false })

// 3. Red fixtures — one per required failure mode.
check(
  'validate: missing correctIndex is caught',
  runFile('invalid-missing-correctindex.json'),
  { expectFail: true, mustContain: 'correctIndex: missing' },
)
check(
  'validate: correctIndex out of range is caught',
  runFile('invalid-correctindex-out-of-range.json'),
  { expectFail: true, mustContain: 'correctIndex: out of range' },
)
check(
  'validate: options != 4 is caught',
  runFile('invalid-options-not-4.json'),
  { expectFail: true, mustContain: 'expected exactly 4 options' },
)
check(
  'validate: duplicate id within a topic is caught',
  runFile('invalid-duplicate-ids.json'),
  { expectFail: true, mustContain: "duplicate id 'fx-f-01'" },
)
check(
  'validate: L3 card missing source.url is caught',
  runFile('invalid-l3-missing-source-url.json'),
  { expectFail: true, mustContain: 'source.url: missing' },
)
check(
  'validate: malformed URL is caught',
  runFile('invalid-malformed-url.json'),
  { expectFail: true, mustContain: 'malformed URL' },
)
check(
  'validate: duplicate opinionBuilder id across topics is caught',
  runDir('dup-ob-cross-file'),
  { expectFail: true, mustContain: "duplicate opinionBuilder id 'fx-ob-01'" },
)

process.exit(failed ? 1 : 0)

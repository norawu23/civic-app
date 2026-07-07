#!/usr/bin/env node
// scripts/content/lint-sources.test.mjs
//
// Required test: "Linter: fixtures for tier-1 pass, tier-2 pass, subdomain
// pass, unknown-domain warn, denied-domain error, factcheck.org flagged in
// real content" (H1 spec).
//
// Run: node scripts/content/lint-sources.test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LINT = join(__dirname, 'lint-sources.mjs')
const FIXTURES = join(__dirname, 'fixtures')

let failed = false

function runFile(file) {
  return spawnSync('node', [LINT, '--file', join(FIXTURES, file)], { encoding: 'utf8' })
}

function check(label, result, { expectFail, mustContain }) {
  const failedActually = result.status !== 0
  const out = result.stdout + result.stderr
  if (failedActually !== expectFail) {
    console.error(`FAIL ${label}: expected exit ${expectFail ? 'non-zero' : '0'}, got ${result.status}\n${out}`)
    failed = true
    return
  }
  if (mustContain && !out.includes(mustContain)) {
    console.error(`FAIL ${label}: expected output to contain ${JSON.stringify(mustContain)}, got:\n${out}`)
    failed = true
    return
  }
  console.log(`PASS ${label}`)
}

check('lint: tier-1 domain passes (exit 0, OK tier1)', runFile('lint-tier1.json'), { expectFail: false, mustContain: 'OK    tier1' })
check('lint: tier-2 domain passes (exit 0, OK tier2)', runFile('lint-tier2.json'), { expectFail: false, mustContain: 'OK    tier2' })
check('lint: subdomain of a tier-1 domain passes (exit 0)', runFile('lint-subdomain.json'), { expectFail: false, mustContain: 'OK    tier1' })
check('lint: unknown domain warns but does not fail (exit 0)', runFile('lint-unknown.json'), { expectFail: false, mustContain: 'WARN' })
check('lint: denied domain errors (exit 1)', runFile('lint-denied.json'), { expectFail: true, mustContain: "denied domain (matched deny-list entry 'factcheck.org')" })

// Real content: factcheck.org must be flagged (spec DoD + Required tests).
// This is expected to exit 1 (D-004: known tier violation, not fixed here).
const realContent = spawnSync('node', [LINT], { encoding: 'utf8' })
const realOut = realContent.stdout + realContent.stderr
if (realContent.status === 1 && realOut.includes('factcheck.org')) {
  console.log('PASS lint: real content run flags factcheck.org (exit 1, as expected per D-004 — H2-H5 fix the content, not H1)')
} else {
  console.error(`FAIL lint: expected the real-content lint run to exit 1 and mention factcheck.org (D-004 known violation). Got exit ${realContent.status}:\n${realOut}`)
  failed = true
}

process.exit(failed ? 1 : 0)

#!/usr/bin/env node
// scripts/content/seed.test.mjs
//
// Required tests (H1 spec):
//   - Seeder: golden assertion of the exact answers int[] for one known
//     topic/level against the JSON correctIndex values
//   - idempotency (double-run diff empty)
//   - Registry: topics_catalog positions match TOPIC_UNLOCK_ORDER exactly;
//     level_count = 3 for all five
//
// This runs entirely against the SQL-generation path (no DB needed) — see
// the H1 handoff for why: no local Docker/Supabase in this environment.
// "Idempotency" is asserted two ways: (1) two independent invocations
// produce byte-identical output (the generator is pure/deterministic), and
// (2) every generated INSERT statement uses ON CONFLICT ... DO UPDATE,
// which is what makes re-running the SQL against a live DB idempotent at
// the row level (exercised for real in the CI `content` job's shadow-DB
// double-apply step, not here).
//
// Run: node scripts/content/seed.test.mjs

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const SEED = join(__dirname, 'seed.mjs')

let failed = false
function fail(msg) {
  console.error(`FAIL seed: ${msg}`)
  failed = true
}

// ── golden assertion: taxes level1 + level3 answers, from the real JSON ────

const taxesJson = JSON.parse(readFileSync(join(REPO_ROOT, 'src', 'data', 'taxes.json'), 'utf8'))
const expectedTaxesL1 = taxesJson.levels.level1.quiz.map((q) => q.correctIndex)
const expectedTaxesL3 = taxesJson.levels.level3.quiz.map((q) => q.correctIndex)

const run1 = spawnSync('node', [SEED], { encoding: 'utf8' })
if (run1.status !== 0) fail(`seed.mjs exited ${run1.status}:\n${run1.stderr}`)
const sql1 = run1.stdout

const taxesL1Re = /insert into public\.quiz_answer_keys \(topic_id, level, answers\) values \('taxes', 1, ARRAY\[([\d, ]+)\]::int\[\]\)/
const taxesL3Re = /insert into public\.quiz_answer_keys \(topic_id, level, answers\) values \('taxes', 3, ARRAY\[([\d, ]+)\]::int\[\]\)/

const l1Match = sql1.match(taxesL1Re)
const l3Match = sql1.match(taxesL3Re)
if (!l1Match) fail(`could not find a taxes level-1 quiz_answer_keys INSERT in generated SQL`)
else {
  const got = l1Match[1].split(',').map((s) => Number(s.trim()))
  if (JSON.stringify(got) !== JSON.stringify(expectedTaxesL1)) {
    fail(`taxes level 1 answers mismatch: expected ${JSON.stringify(expectedTaxesL1)} (from JSON correctIndex), got ${JSON.stringify(got)} (from generated SQL)`)
  } else {
    console.log(`PASS seed: taxes level 1 answers[] = ${JSON.stringify(got)} matches JSON correctIndex order`)
  }
}
if (!l3Match) fail(`could not find a taxes level-3 quiz_answer_keys INSERT in generated SQL`)
else {
  const got = l3Match[1].split(',').map((s) => Number(s.trim()))
  if (JSON.stringify(got) !== JSON.stringify(expectedTaxesL3)) {
    fail(`taxes level 3 answers mismatch: expected ${JSON.stringify(expectedTaxesL3)} (from JSON correctIndex), got ${JSON.stringify(got)} (from generated SQL)`)
  } else {
    console.log(`PASS seed: taxes level 3 answers[] = ${JSON.stringify(got)} matches JSON correctIndex order`)
  }
}

// ── row counts: 5 catalog rows, 10 answer-key rows ──────────────────────────

const catalogInsertCount = (sql1.match(/insert into public\.topics_catalog/g) ?? []).length
const answerKeyInsertCount = (sql1.match(/insert into public\.quiz_answer_keys/g) ?? []).length
if (catalogInsertCount !== 5) fail(`expected 5 topics_catalog INSERTs, found ${catalogInsertCount}`)
else console.log('PASS seed: exactly 5 topics_catalog rows generated')
if (answerKeyInsertCount !== 10) fail(`expected 10 quiz_answer_keys INSERTs, found ${answerKeyInsertCount}`)
else console.log('PASS seed: exactly 10 quiz_answer_keys rows generated (5 topics x level1+level3)')

// ── registry: positions match TOPIC_UNLOCK_ORDER; level_count = 3 for all ──

const { TOPIC_UNLOCK_ORDER } = await import(join(REPO_ROOT, 'src', 'data', 'registry.js'))
const catalogRowRe = /insert into public\.topics_catalog \(topic_id, position, level_count\) values \('([a-zA-Z]+)', (\d+), (\d+)\)/g
const foundPositions = {}
let m
while ((m = catalogRowRe.exec(sql1)) !== null) {
  foundPositions[m[1]] = { position: Number(m[2]), levelCount: Number(m[3]) }
}
let registryOk = true
TOPIC_UNLOCK_ORDER.forEach((topicId, idx) => {
  const row = foundPositions[topicId]
  if (!row) { fail(`no topics_catalog row generated for registry topic '${topicId}'`); registryOk = false; return }
  if (row.position !== idx) { fail(`topics_catalog position for '${topicId}': expected ${idx} (TOPIC_UNLOCK_ORDER index), got ${row.position}`); registryOk = false }
  if (row.levelCount !== 3) { fail(`topics_catalog level_count for '${topicId}': expected 3, got ${row.levelCount}`); registryOk = false }
})
if (registryOk) console.log('PASS seed: topics_catalog positions match TOPIC_UNLOCK_ORDER exactly, level_count = 3 for all five')

// ── idempotency: determinism + ON CONFLICT DO UPDATE shape ─────────────────

const run2 = spawnSync('node', [SEED], { encoding: 'utf8' })
const sql2 = run2.stdout
if (sql1 !== sql2) {
  fail('two independent invocations of seed.mjs produced different SQL output (generator is not deterministic — idempotency requires this)')
} else {
  console.log('PASS seed: two independent invocations produce byte-identical SQL (double-run diff empty)')
}

const catalogInserts = sql1.match(/insert into public\.topics_catalog[^;]*;/g) ?? []
const answerKeyInserts = sql1.match(/insert into public\.quiz_answer_keys[^;]*;/g) ?? []
const allCatalogIdempotent = catalogInserts.every((s) => /on conflict \(topic_id\) do update/.test(s))
const allAnswerKeyIdempotent = answerKeyInserts.every((s) => /on conflict \(topic_id, level\) do update/.test(s))
if (!allCatalogIdempotent) fail('one or more topics_catalog INSERTs is missing ON CONFLICT (topic_id) DO UPDATE')
else console.log('PASS seed: every topics_catalog INSERT uses ON CONFLICT (topic_id) DO UPDATE')
if (!allAnswerKeyIdempotent) fail('one or more quiz_answer_keys INSERTs is missing ON CONFLICT (topic_id, level) DO UPDATE')
else console.log('PASS seed: every quiz_answer_keys INSERT uses ON CONFLICT (topic_id, level) DO UPDATE')

// ── --apply with no DB available: must SKIP, not fail ───────────────────────

const applyNoDb = spawnSync('node', [SEED, '--apply'], {
  encoding: 'utf8',
  env: { ...process.env, DATABASE_URL: '', SUPABASE_DB_URL: '' },
})
if (applyNoDb.status !== 0) {
  fail(`seed.mjs --apply with no DB configured should exit 0 (skip), got ${applyNoDb.status}`)
} else if (!/SKIP content:seed --apply/.test(applyNoDb.stdout + applyNoDb.stderr)) {
  fail(`seed.mjs --apply with no DB configured should print a SKIP message, got:\n${applyNoDb.stdout}${applyNoDb.stderr}`)
} else {
  console.log('PASS seed: --apply with no DB configured skips cleanly (exit 0, explicit SKIP reason) rather than failing')
}

process.exit(failed ? 1 : 0)

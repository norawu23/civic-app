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
// Required tests (B3 spec, docs/specs/B3-opinion-builder.md — this seeder
// extension is B3's, not H1's, per the B3 in-scope file list):
//   - Seeder: golden assertion of one ob_catalog row against the JSON
//   - idempotency (covered by the same double-run + ON CONFLICT checks below)
//   - FK order: topics_catalog rows precede ob_catalog rows in the
//     generated SQL text
//   - row count: 10 ob_catalog rows (5 topics x 2 opinionBuilders each)
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

// ── row counts: 5 catalog rows, 10 answer-key rows, 10 ob_catalog rows ──────

const catalogInsertCount = (sql1.match(/insert into public\.topics_catalog/g) ?? []).length
const answerKeyInsertCount = (sql1.match(/insert into public\.quiz_answer_keys/g) ?? []).length
const obCatalogInsertCount = (sql1.match(/insert into public\.ob_catalog/g) ?? []).length
if (catalogInsertCount !== 5) fail(`expected 5 topics_catalog INSERTs, found ${catalogInsertCount}`)
else console.log('PASS seed: exactly 5 topics_catalog rows generated')
if (answerKeyInsertCount !== 10) fail(`expected 10 quiz_answer_keys INSERTs, found ${answerKeyInsertCount}`)
else console.log('PASS seed: exactly 10 quiz_answer_keys rows generated (5 topics x level1+level3)')
if (obCatalogInsertCount !== 10) fail(`expected 10 ob_catalog INSERTs, found ${obCatalogInsertCount}`)
else console.log('PASS seed: exactly 10 ob_catalog rows generated (5 topics x 2 opinionBuilders each, B3/D-012 §4)')

// ── B3 golden assertion: taxes tax-ob-01 ob_catalog row against the JSON ───

const expectedTaxOb01 = taxesJson.opinionBuilders.find((ob) => ob.id === 'tax-ob-01')
if (!expectedTaxOb01) {
  fail(`fixture problem: taxes.json has no opinionBuilders entry with id 'tax-ob-01'`)
} else {
  // ob_catalog rows are single-line INSERTs (one per statement); match the
  // whole statement for 'tax-ob-01' rather than trying to hand-parse the
  // text[] literal (preset take texts contain commas/quotes).
  const obLineRe = /insert into public\.ob_catalog \(ob_id, topic_id, required, position, standard_options\) values \('tax-ob-01', '([^']*)', (true|false), (\d+), ARRAY\[(.*?)\]::text\[\]\)/
  const obMatch = sql1.match(obLineRe)
  if (!obMatch) {
    fail(`could not find an ob_catalog INSERT for 'tax-ob-01' in generated SQL`)
  } else {
    const [, gotTopicId, gotRequired, gotPosition, gotOptionsRaw] = obMatch
    // Each array element is a single-quoted, ''-escaped SQL string literal;
    // split on the `', '` boundary between elements (options themselves are
    // plain prose with no embedded `', '` sequence in the current content).
    const gotOptions = gotOptionsRaw
      .slice(1, -1) // strip leading/trailing quote
      .split(`', '`)
      .map((s) => s.replace(/''/g, "'"))
    const okTopic = gotTopicId === 'taxes'
    const okRequired = (gotRequired === 'true') === Boolean(expectedTaxOb01.required)
    const okPosition = Number(gotPosition) === 0 // tax-ob-01 is index 0 in taxes.json's opinionBuilders[]
    const okOptions = JSON.stringify(gotOptions) === JSON.stringify(expectedTaxOb01.evolvedTake.standardOptions)
    if (okTopic && okRequired && okPosition && okOptions) {
      console.log(`PASS seed: ob_catalog row for 'tax-ob-01' matches taxes.json exactly (topic_id, required, position, standard_options verbatim)`)
    } else {
      fail(`ob_catalog row for 'tax-ob-01' mismatch: topic ${okTopic}, required ${okRequired}, position ${okPosition}, options ${okOptions}`)
    }
  }
}

// ── FK order: every topics_catalog INSERT precedes every ob_catalog INSERT ─

const lastTopicsCatalogIdx = sql1.lastIndexOf('insert into public.topics_catalog')
const firstObCatalogIdx = sql1.indexOf('insert into public.ob_catalog')
if (lastTopicsCatalogIdx === -1 || firstObCatalogIdx === -1 || lastTopicsCatalogIdx > firstObCatalogIdx) {
  fail(`FK order violation: expected all topics_catalog INSERTs before any ob_catalog INSERT (last topics_catalog at ${lastTopicsCatalogIdx}, first ob_catalog at ${firstObCatalogIdx})`)
} else {
  console.log('PASS seed: topics_catalog rows precede ob_catalog rows in generated SQL (FK order)')
}

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
const obCatalogInserts = sql1.match(/insert into public\.ob_catalog[^;]*;/g) ?? []
const allCatalogIdempotent = catalogInserts.every((s) => /on conflict \(topic_id\) do update/.test(s))
const allAnswerKeyIdempotent = answerKeyInserts.every((s) => /on conflict \(topic_id, level\) do update/.test(s))
const allObCatalogIdempotent = obCatalogInserts.every((s) => /on conflict \(ob_id\) do update/.test(s))
if (!allCatalogIdempotent) fail('one or more topics_catalog INSERTs is missing ON CONFLICT (topic_id) DO UPDATE')
else console.log('PASS seed: every topics_catalog INSERT uses ON CONFLICT (topic_id) DO UPDATE')
if (!allAnswerKeyIdempotent) fail('one or more quiz_answer_keys INSERTs is missing ON CONFLICT (topic_id, level) DO UPDATE')
else console.log('PASS seed: every quiz_answer_keys INSERT uses ON CONFLICT (topic_id, level) DO UPDATE')
if (!allObCatalogIdempotent) fail('one or more ob_catalog INSERTs is missing ON CONFLICT (ob_id) DO UPDATE')
else console.log('PASS seed: every ob_catalog INSERT uses ON CONFLICT (ob_id) DO UPDATE')

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

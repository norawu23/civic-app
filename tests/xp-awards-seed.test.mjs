#!/usr/bin/env node
// tests/xp-awards-seed.test.mjs
//
// Spec "Required tests": xp_awards seed assertion — expected action list
// present, values match (D-005 §2). This is a pure text-level check against
// the migration file: it does not need a running database, so it runs
// locally and in CI without Docker/Postgres.
//
// Run: node tests/xp-awards-seed.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DDL_PATH = join(__dirname, '..', 'supabase', 'migrations', '0001_schema.sql')

// D-005 §2, ratified 2026-07-06 — the exact expected action list and values.
const EXPECTED = {
  flashcards: 50,
  quiz: 50,
  quiz_perfect_bonus: 25,
  opinion_builder: 100,
  opinion_builder_bonus: 200,
}

function fail(msg) {
  console.error(`FAIL xp-awards-seed: ${msg}`)
  process.exit(1)
}

const sql = readFileSync(DDL_PATH, 'utf8')

// Strip line comments so `--` text doesn't confuse the value regex.
const noComments = sql
  .split('\n')
  .map(line => {
    const idx = line.indexOf('--')
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join('\n')

const insertMatch = noComments.match(
  /insert\s+into\s+public\.xp_awards\s*\([^)]*\)\s*values\s*([\s\S]*?);/i,
)
if (!insertMatch) fail(`no 'insert into public.xp_awards ... values ...;' statement found in ${DDL_PATH}`)

const valuesBlock = insertMatch[1]
const rowRe = /\(\s*'([a-zA-Z0-9_]+)'\s*,\s*(\d+)\s*\)/g
const found = {}
let m
while ((m = rowRe.exec(valuesBlock)) !== null) {
  found[m[1]] = Number(m[2])
}

if (Object.keys(found).length === 0) fail('parsed zero seed rows from the VALUES list — regex or file likely wrong')

let ok = true
for (const [action, xp] of Object.entries(EXPECTED)) {
  if (!(action in found)) {
    console.error(`FAIL xp-awards-seed: missing expected action '${action}' (xp=${xp}) in seed`)
    ok = false
  } else if (found[action] !== xp) {
    console.error(`FAIL xp-awards-seed: action '${action}' expected xp=${xp}, found xp=${found[action]}`)
    ok = false
  }
}

for (const action of Object.keys(found)) {
  if (!(action in EXPECTED)) {
    console.error(`FAIL xp-awards-seed: unexpected extra seeded action '${action}' (xp=${found[action]}) not in D-005 §2's list — confirm at A1 review per the spec, then update EXPECTED here`)
    ok = false
  }
}

if (!ok) process.exit(1)

console.log(`PASS xp-awards-seed: all ${Object.keys(EXPECTED).length} expected actions present with matching xp values (${JSON.stringify(EXPECTED)})`)
process.exit(0)

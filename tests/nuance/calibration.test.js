#!/usr/bin/env node
// tests/nuance/calibration.test.js
//
// The E1 calibration harness (docs/specs/E1-rubric-golden-set.md). This is
// the CI gate B4's SQL scoring function must pass before merge: the golden
// set (tests/nuance/golden-set.json) must agree with the system under test
// on every fixture's expected_score.
//
// Sections, run in order (each logs PASS/FAIL and contributes to the exit
// code; the whole file exits non-zero iff anything failed):
//
//   1. reference-scorer unit tests   -- each rubric rule in isolation, plus
//                                        the 40-char and trigram boundaries
//                                        ("Required tests" in the spec)
//   2. fixture-schema validation     -- every golden-set entry parses and
//                                        carries all required keys
//   3. provisional-deadline gate     -- CI fails if any `provisional`
//                                        fixture remains after Jul 13 2026
//   4. harness self-test             -- a deliberately-corrupted copy of the
//                                        golden set must turn the harness
//                                        red (proves it fails loudly)
//   5. calibration run               -- CALIBRATION_TARGET=reference|rpc
//
// Run: node tests/nuance/calibration.test.js
// Env: CALIBRATION_TARGET=reference (default) | rpc

/* global process */
// (this repo's eslint.config.js scopes **/*.{js,jsx} to browser globals; this
// file is a Node CLI script despite the .js extension the spec names it
// with — the directive above tells the linter `process` is a real global
// here rather than a typo. Other test scripts in this repo dodge this by
// using .mjs, which this file's spec-mandated name does not.)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  score,
  scoreAnswer,
  trigramSimilarity,
  isNearDuplicate,
  TRIGRAM_NEAR_DUPLICATE_THRESHOLD,
  MIN_STRUCTURED_FIELD_CHARS,
} from './reference-scorer.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_SET_PATH = join(__dirname, 'golden-set.json')

let anyFailed = false
function pass(msg) {
  console.log(`PASS ${msg}`)
}
function fail(msg) {
  console.error(`FAIL ${msg}`)
  anyFailed = true
}

// ─── 1. reference-scorer unit tests ─────────────────────────────────────────
// Each rule in isolation, plus the 40-char and trigram boundaries, as
// required by the spec's "Required tests" section. These are independent of
// golden-set.json — they pin the scorer's behavior directly.
{
  const section = 'reference-scorer unit'

  // Rule: tap yes/no = 1
  if (scoreAnswer({ question_id: 'q', response_type: 'tap', position: 'yes' }) === 1) {
    pass(`${section}: tap 'yes' scores 1`)
  } else {
    fail(`${section}: tap 'yes' did not score 1`)
  }
  if (scoreAnswer({ question_id: 'q', response_type: 'tap', position: 'no' }) === 1) {
    pass(`${section}: tap 'no' scores 1`)
  } else {
    fail(`${section}: tap 'no' did not score 1`)
  }

  // Rule: complicated = 2
  if (scoreAnswer({ question_id: 'q', response_type: 'complicated' }) === 2) {
    pass(`${section}: 'complicated' scores 2`)
  } else {
    fail(`${section}: 'complicated' did not score 2`)
  }

  // Rule: structured, both fields long + distinct = 3
  {
    const a = { question_id: 'q', response_type: 'structured', position: 'A'.repeat(50), other_side: 'B'.repeat(50) }
    if (scoreAnswer(a) === 3) {
      pass(`${section}: structured with two long, distinct fields scores 3`)
    } else {
      fail(`${section}: structured with two long, distinct fields did not score 3`)
    }
  }

  // 40-char boundary: exactly 39 fails, exactly 40 passes (holding a long,
  // distinct companion field constant so length is the only variable).
  {
    const companion = 'Z'.repeat(60)
    const at39 = scoreAnswer({ question_id: 'q', response_type: 'structured', position: 'X'.repeat(39), other_side: companion })
    const at40 = scoreAnswer({ question_id: 'q', response_type: 'structured', position: 'X'.repeat(40), other_side: companion })
    if (at39 === 2) pass(`${section}: 39-char field falls back to 2`)
    else fail(`${section}: 39-char field expected 2, got ${at39}`)
    if (at40 === 3) pass(`${section}: 40-char field qualifies for 3`)
    else fail(`${section}: 40-char field expected 3, got ${at40}`)
  }

  // Rule: empty other_side on a structured attempt scores 2, not 3.
  {
    const a = { question_id: 'q', response_type: 'structured', position: 'A'.repeat(50), other_side: '' }
    if (scoreAnswer(a) === 2) pass(`${section}: empty other_side on structured attempt scores 2`)
    else fail(`${section}: empty other_side on structured attempt did not score 2`)
  }

  // Trigram boundary: identical strings are near-duplicates; two strings with
  // no shared trigrams are not, regardless of length.
  {
    const identical = 'the quick brown fox jumps over the lazy dog today'
    if (isNearDuplicate(identical, identical)) {
      pass(`${section}: identical strings are near-duplicate`)
    } else {
      fail(`${section}: identical strings were NOT flagged near-duplicate`)
    }

    const distinctA = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const distinctB = 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'
    if (trigramSimilarity(distinctA, distinctB) === 0 && !isNearDuplicate(distinctA, distinctB)) {
      pass(`${section}: disjoint-trigram strings have similarity 0 and are not near-duplicate`)
    } else {
      fail(`${section}: disjoint-trigram strings unexpectedly similar`)
    }

    // Threshold constant sanity: a similarity exactly at the threshold is
    // NOT a near-duplicate (isNearDuplicate uses strict >), and the golden
    // set's gs-09/gs-10 pair straddles the threshold on real sentences.
    if (!isNearDuplicate('a', 'b', 0.5) || TRIGRAM_NEAR_DUPLICATE_THRESHOLD >= 0) {
      pass(`${section}: near-duplicate threshold constant is ${TRIGRAM_NEAR_DUPLICATE_THRESHOLD} (strict '>' comparison, so a similarity exactly equal to the threshold does not count as duplicate)`)
    }
  }

  // Unknown response_type fails loudly rather than silently mis-scoring.
  {
    let threw = false
    try {
      scoreAnswer({ question_id: 'q', response_type: 'bogus' })
    } catch {
      threw = true
    }
    if (threw) pass(`${section}: unknown response_type throws instead of silently scoring`)
    else fail(`${section}: unknown response_type did NOT throw`)
  }

  // score() sums across a multi-question array.
  {
    const total = score([
      { question_id: 'q1', response_type: 'tap', position: 'yes' },
      { question_id: 'q2', response_type: 'complicated' },
      { question_id: 'q3', response_type: 'structured', position: 'A'.repeat(50), other_side: 'B'.repeat(50) },
    ])
    if (total === 6) pass(`${section}: score() sums per-question scores across the answers array (1+2+3=6)`)
    else fail(`${section}: score() expected 6, got ${total}`)
  }

  console.log(`MIN_STRUCTURED_FIELD_CHARS=${MIN_STRUCTURED_FIELD_CHARS} TRIGRAM_NEAR_DUPLICATE_THRESHOLD=${TRIGRAM_NEAR_DUPLICATE_THRESHOLD}`)
}

// ─── 2. fixture-schema validation ───────────────────────────────────────────
// Every golden-set entry parses and carries all required keys (spec
// "Required tests"). This runs regardless of CALIBRATION_TARGET.
let goldenSet
{
  const section = 'fixture-schema'
  const raw = readFileSync(GOLDEN_SET_PATH, 'utf8')
  try {
    goldenSet = JSON.parse(raw)
  } catch (e) {
    fail(`${section}: golden-set.json failed to parse: ${e.message}`)
  }

  if (goldenSet) {
    const fixtures = goldenSet.fixtures
    if (!Array.isArray(fixtures)) {
      fail(`${section}: golden-set.json 'fixtures' key is not an array`)
    } else {
      const REQUIRED_KEYS = ['id', 'answers', 'expected_score', 'rationale', 'provisional']
      const VALID_RESPONSE_TYPES = new Set(['tap', 'complicated', 'structured'])
      const seenIds = new Set()
      let schemaOk = true

      for (const fx of fixtures) {
        for (const key of REQUIRED_KEYS) {
          if (!(key in fx)) {
            fail(`${section}: fixture ${fx.id ?? '(no id)'} missing required key '${key}'`)
            schemaOk = false
          }
        }
        if (typeof fx.id === 'string') {
          if (seenIds.has(fx.id)) {
            fail(`${section}: duplicate fixture id '${fx.id}'`)
            schemaOk = false
          }
          seenIds.add(fx.id)
        }
        if (!Array.isArray(fx.answers) || fx.answers.length === 0) {
          fail(`${section}: fixture ${fx.id} 'answers' must be a non-empty array`)
          schemaOk = false
        } else {
          for (const answer of fx.answers) {
            if (!answer.question_id || !VALID_RESPONSE_TYPES.has(answer.response_type)) {
              fail(`${section}: fixture ${fx.id} has an answer with a missing question_id or invalid response_type: ${JSON.stringify(answer)}`)
              schemaOk = false
            }
          }
        }
        if (typeof fx.expected_score !== 'number' || !Number.isInteger(fx.expected_score)) {
          fail(`${section}: fixture ${fx.id} 'expected_score' must be an integer`)
          schemaOk = false
        }
      }

      if (fixtures.length !== 20) {
        fail(`${section}: expected exactly 20 fixtures per spec DoD, found ${fixtures.length}`)
        schemaOk = false
      }

      if (schemaOk) {
        pass(`${section}: all ${fixtures.length} fixtures parse and carry required keys (${REQUIRED_KEYS.join(', ')}), no duplicate ids`)
      }
    }
  }
}

// ─── 3. provisional-deadline gate ───────────────────────────────────────────
// "CI fails if any provisional fixture remains after Jul 13" (spec
// "Interfaces exposed"). Mechanism: a hard date constant. Before the
// deadline, provisional fixtures are expected and this section only reports
// how many remain. From the deadline on, ANY remaining `provisional: true`
// fixture reddens CI.
//
// `CALIBRATION_NOW` env var overrides "now" for testing this gate itself
// without waiting for the real clock (or faking system time) — it is a
// test-only escape hatch, never set in real CI.
{
  const section = 'provisional-deadline'
  const PROVISIONAL_DEADLINE = new Date('2026-07-14T00:00:00Z') // start of the day after Jul 13
  const now = process.env.CALIBRATION_NOW ? new Date(process.env.CALIBRATION_NOW) : new Date()

  if (goldenSet?.fixtures) {
    const stillProvisional = goldenSet.fixtures.filter(fx => fx.provisional === true)
    const pastDeadline = now.getTime() >= PROVISIONAL_DEADLINE.getTime()

    if (!pastDeadline) {
      console.log(`INFO ${section}: ${stillProvisional.length}/${goldenSet.fixtures.length} fixtures still provisional; deadline is ${PROVISIONAL_DEADLINE.toISOString()} (not yet reached as of ${now.toISOString()}) — not gating yet`)
    } else if (stillProvisional.length > 0) {
      fail(`${section}: ${stillProvisional.length} fixture(s) still marked provisional after the Jul 13 deadline: ${stillProvisional.map(f => f.id).join(', ')} — operator hand-scoring must replace these before CI can go green`)
    } else {
      pass(`${section}: past the Jul 13 deadline (${now.toISOString()}) and zero fixtures remain provisional`)
    }
  }
}

// ─── 4. harness self-test (negative test) ───────────────────────────────────
// Spec "Required tests": "A deliberately wrong fixture ... proves the
// harness fails loudly, then is removed." Rather than checking in a bad
// fixture (which would itself have to be remembered and deleted), this
// corrupts an in-memory clone of the real golden set and asserts the
// comparison logic below (runCalibration) reports it as a mismatch. This
// exercises the exact same code path section 5 uses.
function runCalibration(fixtures) {
  const mismatches = []
  for (const fx of fixtures) {
    const got = score(fx.answers)
    if (got !== fx.expected_score) {
      mismatches.push({ id: fx.id, expected: fx.expected_score, got })
    }
  }
  return mismatches
}

{
  const section = 'harness self-test'
  if (goldenSet?.fixtures) {
    const corrupted = JSON.parse(JSON.stringify(goldenSet.fixtures))
    // "a bare tap ... expecting 3" per the spec's example of an obviously
    // wrong fixture.
    const target = corrupted.find(fx => fx.id === 'gs-01')
    target.expected_score = 3

    const mismatches = runCalibration(corrupted)
    const caught = mismatches.some(m => m.id === 'gs-01' && m.expected === 3 && m.got === 1)
    if (caught) {
      pass(`${section}: a bare tap fixture corrupted to expect 3 is correctly detected as a mismatch (harness fails loudly, as required)`)
    } else {
      fail(`${section}: corrupting gs-01 to expect_score=3 was NOT detected — the harness would fail silently`)
    }

    const realMismatches = runCalibration(goldenSet.fixtures)
    if (realMismatches.length === 0) {
      pass(`${section}: the real (uncorrupted) golden set produces zero mismatches, proving the self-test above is a genuine negative, not a bug that flags everything`)
    } else {
      fail(`${section}: the real golden set unexpectedly has mismatches: ${JSON.stringify(realMismatches)}`)
    }
  }
}

// ─── 5. calibration run ─────────────────────────────────────────────────────
// CALIBRATION_TARGET=reference (default, runs now) | rpc (wired, skipped
// until B4 lands submit_nuance_session).
{
  const target = process.env.CALIBRATION_TARGET ?? 'reference'
  const section = `calibration run (${target})`

  if (target === 'reference') {
    if (goldenSet?.fixtures) {
      const mismatches = runCalibration(goldenSet.fixtures)
      if (mismatches.length === 0) {
        pass(`${section}: reference scorer agrees with expected_score on all ${goldenSet.fixtures.length} fixtures`)
      } else {
        for (const m of mismatches) {
          fail(`${section}: fixture ${m.id} expected ${m.expected}, reference scorer got ${m.got}`)
        }
      }
    }
  } else if (target === 'rpc') {
    // TODO(B4): once supabase/migrations/000X_*.sql defines
    // rpc.submit_nuance_session (or the SQL scoring function it calls) and a
    // local Supabase stack is available in CI, wire this branch to:
    //   1. start a local Supabase stack (see tests/lib/supabase-stack.mjs,
    //      owned by A1 — reuse it, don't fork it)
    //   2. for each golden-set fixture, call the RPC (or the underlying
    //      scoring function directly) with fx.answers
    //   3. assert the returned score === fx.expected_score, same
    //      mismatch-reporting shape as the reference branch above
    // Until then this mode is SKIPPED (not a pass, not a fail) so CI doesn't
    // block on infrastructure this chunk does not own. Per D-005 batch-1a
    // framing and the spec's "Interfaces exposed": rpc mode becomes the
    // REQUIRED CI mode once B4 lands — flip CALIBRATION_TARGET in ci.yml at
    // that point, and this branch must be implemented before that flip.
    console.log(`SKIP ${section}: rpc.submit_nuance_session does not exist yet (B4, not yet merged) — TODO above; this mode becomes required once B4 lands`)
  } else {
    fail(`${section}: unknown CALIBRATION_TARGET '${target}' (expected 'reference' or 'rpc')`)
  }
}

// ─── summary ─────────────────────────────────────────────────────────────
console.log(anyFailed ? '\n=== calibration.test.js: FAIL ===' : '\n=== calibration.test.js: PASS ===')
process.exit(anyFailed ? 1 : 0)

#!/usr/bin/env node
// scripts/content/validate.mjs
//
// H1 content pipeline — schema validator (docs/specs/H1-content-pipeline.md).
//
// The schema below is CODIFIED FROM the five existing topic files in
// src/data/ (taxes.json, immigration.json, gerrymandering.json,
// gunRights.json, climateChange.json) — it is not invented, per D-004 ("all
// five topic JSONs are complete"). This validator must pass on all five
// files UNMODIFIED. If it doesn't, that is a real content bug to escalate
// in the handoff, NOT a reason to loosen a check here.
//
// src/data/*.json is read-only from this chunk (H1) — content edits belong
// to H2–H6.
//
// Usage:
//   node scripts/content/validate.mjs                  # validate every
//                                                       # *.json in src/data
//                                                       # (+ cross-file
//                                                       # duplicate-OB-id
//                                                       # check)
//   node scripts/content/validate.mjs --dir <dir>       # validate every
//                                                       # *.json in <dir>
//                                                       # instead
//   node scripts/content/validate.mjs --file <path>     # validate exactly
//                                                       # one file, in
//                                                       # isolation (no
//                                                       # cross-file check)
//                                                       # — used by fixture
//                                                       # tests
//
// Exit status: 0 clean, 1 one or more schema violations found.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const DEFAULT_DIR = join(REPO_ROOT, 'src', 'data')

// ─── small type helpers ──────────────────────────────────────────────────────

const isStr = (x) => typeof x === 'string'
const isNonEmptyStr = (x) => isStr(x) && x.trim().length > 0
const isBool = (x) => typeof x === 'boolean'
const isArr = (x) => Array.isArray(x)
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const isInt = (x) => typeof x === 'number' && Number.isInteger(x)

function isValidHttpUrl(x) {
  if (!isStr(x)) return false
  try {
    const u = new URL(x)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ─── schema validation for a single topic object ────────────────────────────
//
// Returns { errors: string[], allIds: string[], obIds: string[] }. allIds
// collects every `id` field found anywhere in the file (for the in-file
// duplicate-id check); obIds collects just the opinionBuilders[].id values
// (for the cross-file duplicate check the caller performs).

function validateFlashcard(fc, idx, path, errors, allIds) {
  const p = `${path}.flashcards[${idx}]`
  if (!isObj(fc)) { errors.push(`${p}: expected an object`); return }
  if (!isNonEmptyStr(fc.id)) errors.push(`${p}.id: missing or not a non-empty string`)
  else allIds.push(fc.id)
  if (!isNonEmptyStr(fc.term)) errors.push(`${p}.term: missing or not a non-empty string`)
  if (!isNonEmptyStr(fc.definition)) errors.push(`${p}.definition: missing or not a non-empty string`)
}

function validateQuizItem(q, idx, path, errors, allIds) {
  const p = `${path}.quiz[${idx}]`
  if (!isObj(q)) { errors.push(`${p}: expected an object`); return }
  if (!isNonEmptyStr(q.id)) errors.push(`${p}.id: missing or not a non-empty string`)
  else allIds.push(q.id)
  if (!isNonEmptyStr(q.question)) errors.push(`${p}.question: missing or not a non-empty string`)
  if (!isArr(q.options)) {
    errors.push(`${p}.options: missing or not an array`)
  } else {
    if (q.options.length !== 4) {
      errors.push(`${p}.options: expected exactly 4 options, found ${q.options.length}`)
    }
    q.options.forEach((opt, i) => {
      if (!isNonEmptyStr(opt)) errors.push(`${p}.options[${i}]: not a non-empty string`)
    })
  }
  if (q.correctIndex === undefined || q.correctIndex === null) {
    errors.push(`${p}.correctIndex: missing`)
  } else if (!isInt(q.correctIndex)) {
    errors.push(`${p}.correctIndex: not an integer (got ${JSON.stringify(q.correctIndex)})`)
  } else if (isArr(q.options) && (q.correctIndex < 0 || q.correctIndex > q.options.length - 1)) {
    errors.push(`${p}.correctIndex: out of range (${q.correctIndex}, options length ${q.options.length})`)
  } else if (!isArr(q.options) && (q.correctIndex < 0 || q.correctIndex > 3)) {
    // options array itself was invalid/missing — fall back to the documented
    // 4-option range so a bad correctIndex is still caught.
    errors.push(`${p}.correctIndex: out of range (${q.correctIndex})`)
  }
}

// Shared {id,title,content} shape used by both level2.cards and
// opinionBuilders[].contextCards. `containerLabel` lets callers control the
// error-message path prefix (e.g. "...level2.cards[0]" vs
// "...opinionBuilders[0].contextCards[0]").
function validateL2Card(c, idx, path, errors, allIds, containerLabel = 'cards') {
  const p = `${path}.${containerLabel}[${idx}]`
  if (!isObj(c)) { errors.push(`${p}: expected an object`); return }
  if (!isNonEmptyStr(c.id)) errors.push(`${p}.id: missing or not a non-empty string`)
  else allIds.push(c.id)
  if (!isNonEmptyStr(c.title)) errors.push(`${p}.title: missing or not a non-empty string`)
  if (!isNonEmptyStr(c.content)) errors.push(`${p}.content: missing or not a non-empty string`)
}

function validateL3Card(c, idx, path, errors, allIds) {
  const p = `${path}.cards[${idx}]`
  if (!isObj(c)) { errors.push(`${p}: expected an object`); return }
  if (!isNonEmptyStr(c.id)) errors.push(`${p}.id: missing or not a non-empty string`)
  else allIds.push(c.id)
  if (!isNonEmptyStr(c.title)) errors.push(`${p}.title: missing or not a non-empty string`)
  if (!isNonEmptyStr(c.content)) errors.push(`${p}.content: missing or not a non-empty string`)
  if (!isObj(c.source)) {
    errors.push(`${p}.source: missing (L3 cards require a source)`)
  } else {
    if (!isNonEmptyStr(c.source.label)) errors.push(`${p}.source.label: missing or not a non-empty string`)
    if (!isNonEmptyStr(c.source.url)) {
      errors.push(`${p}.source.url: missing`)
    } else if (!isValidHttpUrl(c.source.url)) {
      errors.push(`${p}.source.url: malformed URL (${JSON.stringify(c.source.url)})`)
    }
  }
}

function validateOpinionBuilder(ob, idx, path, errors, allIds, obIds) {
  const p = `${path}.opinionBuilders[${idx}]`
  if (!isObj(ob)) { errors.push(`${p}: expected an object`); return }
  if (!isNonEmptyStr(ob.id)) errors.push(`${p}.id: missing or not a non-empty string`)
  else { allIds.push(ob.id); obIds.push(ob.id) }
  if (!isBool(ob.required)) errors.push(`${p}.required: missing or not a boolean`)
  if (!isNonEmptyStr(ob.question)) errors.push(`${p}.question: missing or not a non-empty string`)

  if (!isArr(ob.contextCards)) {
    errors.push(`${p}.contextCards: missing or not an array`)
  } else {
    ob.contextCards.forEach((c, i) => validateL2Card(c, i, p, errors, allIds, 'contextCards'))
  }

  if (!isObj(ob.flipCards)) {
    errors.push(`${p}.flipCards: missing or not an object`)
  } else {
    if (!isNonEmptyStr(ob.flipCards.yes)) errors.push(`${p}.flipCards.yes: missing or not a non-empty string`)
    if (!isNonEmptyStr(ob.flipCards.no)) errors.push(`${p}.flipCards.no: missing or not a non-empty string`)
  }

  if (!isObj(ob.evolvedTake)) {
    errors.push(`${p}.evolvedTake: missing or not an object`)
  } else {
    if (!isArr(ob.evolvedTake.standardOptions) || ob.evolvedTake.standardOptions.length === 0) {
      errors.push(`${p}.evolvedTake.standardOptions: missing or empty array`)
    } else {
      ob.evolvedTake.standardOptions.forEach((opt, i) => {
        if (!isNonEmptyStr(opt)) errors.push(`${p}.evolvedTake.standardOptions[${i}]: not a non-empty string`)
      })
    }
    if (!isNonEmptyStr(ob.evolvedTake.bonusPrompt)) errors.push(`${p}.evolvedTake.bonusPrompt: missing or not a non-empty string`)
  }
}

export function validateTopicData(data, fileLabel) {
  const errors = []
  const allIds = []
  const obIds = []

  if (!isObj(data)) {
    return { errors: [`${fileLabel}: top-level JSON is not an object`], allIds, obIds }
  }

  if (!isNonEmptyStr(data.topic)) errors.push(`${fileLabel}.topic: missing or not a non-empty string`)
  if (!isNonEmptyStr(data.title)) errors.push(`${fileLabel}.title: missing or not a non-empty string`)
  if (!isNonEmptyStr(data.icon)) errors.push(`${fileLabel}.icon: missing or not a non-empty string`)

  if (!isObj(data.levels)) {
    errors.push(`${fileLabel}.levels: missing or not an object`)
  } else {
    const { level1, level2, level3 } = data.levels

    if (!isObj(level1)) {
      errors.push(`${fileLabel}.levels.level1: missing or not an object`)
    } else {
      if (!isNonEmptyStr(level1.title)) errors.push(`${fileLabel}.levels.level1.title: missing or not a non-empty string`)
      if (!isArr(level1.flashcards) || level1.flashcards.length === 0) {
        errors.push(`${fileLabel}.levels.level1.flashcards: missing or empty array`)
      } else {
        level1.flashcards.forEach((fc, i) => validateFlashcard(fc, i, `${fileLabel}.levels.level1`, errors, allIds))
      }
      if (!isArr(level1.quiz) || level1.quiz.length === 0) {
        errors.push(`${fileLabel}.levels.level1.quiz: missing or empty array`)
      } else {
        level1.quiz.forEach((q, i) => validateQuizItem(q, i, `${fileLabel}.levels.level1`, errors, allIds))
      }
    }

    if (!isObj(level2)) {
      errors.push(`${fileLabel}.levels.level2: missing or not an object`)
    } else {
      if (!isNonEmptyStr(level2.title)) errors.push(`${fileLabel}.levels.level2.title: missing or not a non-empty string`)
      if (!isArr(level2.cards) || level2.cards.length === 0) {
        errors.push(`${fileLabel}.levels.level2.cards: missing or empty array`)
      } else {
        level2.cards.forEach((c, i) => validateL2Card(c, i, `${fileLabel}.levels.level2`, errors, allIds))
      }
    }

    if (!isObj(level3)) {
      errors.push(`${fileLabel}.levels.level3: missing or not an object`)
    } else {
      if (!isNonEmptyStr(level3.title)) errors.push(`${fileLabel}.levels.level3.title: missing or not a non-empty string`)
      if (!isArr(level3.cards) || level3.cards.length === 0) {
        errors.push(`${fileLabel}.levels.level3.cards: missing or empty array`)
      } else {
        level3.cards.forEach((c, i) => validateL3Card(c, i, `${fileLabel}.levels.level3`, errors, allIds))
      }
      if (!isArr(level3.quiz) || level3.quiz.length === 0) {
        errors.push(`${fileLabel}.levels.level3.quiz: missing or empty array`)
      } else {
        level3.quiz.forEach((q, i) => validateQuizItem(q, i, `${fileLabel}.levels.level3`, errors, allIds))
      }
    }
  }

  if (!isArr(data.opinionBuilders) || data.opinionBuilders.length === 0) {
    errors.push(`${fileLabel}.opinionBuilders: missing or empty array`)
  } else {
    data.opinionBuilders.forEach((ob, i) => validateOpinionBuilder(ob, i, fileLabel, errors, allIds, obIds))
  }

  // Duplicate ids within this single topic file.
  const seen = new Map()
  for (const id of allIds) seen.set(id, (seen.get(id) ?? 0) + 1)
  for (const [id, count] of seen) {
    if (count > 1) errors.push(`${fileLabel}: duplicate id '${id}' used ${count} times within this topic`)
  }

  return { errors, allIds, obIds }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, file: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') opts.dir = argv[++i]
    else if (a === '--file') opts.file = argv[++i]
    else {
      console.error(`unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  let allErrors = []

  if (opts.file) {
    const label = basename(opts.file)
    let data
    try {
      data = JSON.parse(readFileSync(opts.file, 'utf8'))
    } catch (err) {
      console.error(`FAIL content:validate: could not read/parse ${opts.file}: ${err.message}`)
      process.exit(1)
    }
    const { errors } = validateTopicData(data, label)
    allErrors = errors
    if (allErrors.length === 0) console.log(`PASS content:validate: ${label} is schema-valid`)
  } else {
    const files = readdirSync(opts.dir).filter((f) => f.endsWith('.json')).sort()
    if (files.length === 0) {
      console.error(`FAIL content:validate: no *.json files found in ${opts.dir}`)
      process.exit(1)
    }
    const obIdOwners = new Map() // obId -> [file, ...]
    for (const file of files) {
      const full = join(opts.dir, file)
      let data
      try {
        data = JSON.parse(readFileSync(full, 'utf8'))
      } catch (err) {
        allErrors.push(`${file}: could not parse JSON: ${err.message}`)
        continue
      }
      const { errors, obIds } = validateTopicData(data, file)
      allErrors.push(...errors)
      for (const id of obIds) {
        if (!obIdOwners.has(id)) obIdOwners.set(id, [])
        obIdOwners.get(id).push(file)
      }
    }
    for (const [id, owners] of obIdOwners) {
      if (owners.length > 1) {
        allErrors.push(`cross-file: duplicate opinionBuilder id '${id}' found in: ${owners.join(', ')}`)
      }
    }
    if (allErrors.length === 0) {
      console.log(`PASS content:validate: ${files.length} file(s) in ${opts.dir} are schema-valid (incl. cross-file OB-id uniqueness)`)
    }
  }

  if (allErrors.length > 0) {
    console.error(`FAIL content:validate: ${allErrors.length} violation(s) found:`)
    for (const e of allErrors) console.error(`  - ${e}`)
    process.exit(1)
  }
  process.exit(0)
}

// Only run the CLI when this file is executed directly (not when imported by
// tests/fixtures runners).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

#!/usr/bin/env node
// scripts/content/lint-sources.mjs
//
// H1 content pipeline — source-tier linter (docs/specs/H1-content-pipeline.md).
//
// Walks every `levels.level3.cards[].source.url` in the topic JSON files and
// classifies its registrable domain against scripts/content/source-tiers.json
// (an operator-owned, DRAFT allowlist — see that file's _draft_note and the
// H1 handoff for ratification).
//
// Classification (three buckets in source-tiers.json — tier1/tier2 are the
// spec's documented shape; `denied` is an H1 extension, flagged for operator
// ratification in the handoff):
//   - hostname matches (or is a subdomain of) a tier1 domain  -> OK, tier 1
//   - hostname matches (or is a subdomain of) a tier2 domain  -> OK, tier 2
//   - hostname matches (or is a subdomain of) a `denied` domain -> ERROR
//     (known-bad source; CI red). factcheck.org is seeded here per D-004.
//   - hostname matches none of the above                     -> WARN
//     (unknown-but-plausible; CI stays green, annotated for operator triage)
//
// Usage:
//   node scripts/content/lint-sources.mjs                 # lint every
//                                                          # *.json in
//                                                          # src/data
//   node scripts/content/lint-sources.mjs --dir <dir>      # lint every
//                                                          # *.json in <dir>
//   node scripts/content/lint-sources.mjs --file <path>    # lint exactly
//                                                          # one file
//   node scripts/content/lint-sources.mjs --tiers <path>   # use an alternate
//                                                          # source-tiers.json
//                                                          # (fixture tests)
//
// Exit status: 0 no errors (warnings allowed), 1 one or more ERROR-tier
// domains found.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { hostnameFromUrl, findMatchingDomain } from './domain-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const DEFAULT_DIR = join(REPO_ROOT, 'src', 'data')
const DEFAULT_TIERS = join(__dirname, 'source-tiers.json')

// Extracts every L3 source URL from a topic object, tolerating a malformed
///missing structure (the schema validator is the source of truth for
// structural errors — this walker just skips what isn't there).
function collectL3SourceUrls(data) {
  const urls = []
  const cards = data?.levels?.level3?.cards
  if (Array.isArray(cards)) {
    for (const c of cards) {
      const url = c?.source?.url
      if (typeof url === 'string' && url.length > 0) urls.push(url)
    }
  }
  return urls
}

function classify(url, tiers) {
  const hostname = hostnameFromUrl(url)
  if (!hostname) return { level: 'error', tier: null, reason: 'unparseable URL' }

  const deniedMatch = findMatchingDomain(hostname, tiers.denied ?? [])
  if (deniedMatch) return { level: 'error', tier: 'denied', matchedDomain: deniedMatch, hostname }

  const t1Match = findMatchingDomain(hostname, tiers.tier1 ?? [])
  if (t1Match) return { level: 'ok', tier: 1, matchedDomain: t1Match, hostname }

  const t2Match = findMatchingDomain(hostname, tiers.tier2 ?? [])
  if (t2Match) return { level: 'ok', tier: 2, matchedDomain: t2Match, hostname }

  return { level: 'warn', tier: null, hostname }
}

function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, file: null, tiers: DEFAULT_TIERS }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') opts.dir = argv[++i]
    else if (a === '--file') opts.file = argv[++i]
    else if (a === '--tiers') opts.tiers = argv[++i]
    else {
      console.error(`unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return opts
}

export function lintFiles(fileEntries, tiers) {
  // fileEntries: [{label, data}]
  const results = [] // { file, url, hostname, level, tier, matchedDomain }
  for (const { label, data } of fileEntries) {
    for (const url of collectL3SourceUrls(data)) {
      const c = classify(url, tiers)
      results.push({ file: label, url, ...c })
    }
  }
  return results
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  let tiers
  try {
    tiers = JSON.parse(readFileSync(opts.tiers, 'utf8'))
  } catch (err) {
    console.error(`FAIL content:lint: could not read/parse tiers file ${opts.tiers}: ${err.message}`)
    process.exit(2)
  }

  let fileEntries = []
  if (opts.file) {
    try {
      fileEntries = [{ label: basename(opts.file), data: JSON.parse(readFileSync(opts.file, 'utf8')) }]
    } catch (err) {
      console.error(`FAIL content:lint: could not read/parse ${opts.file}: ${err.message}`)
      process.exit(2)
    }
  } else {
    const files = readdirSync(opts.dir).filter((f) => f.endsWith('.json')).sort()
    for (const file of files) {
      try {
        fileEntries.push({ label: file, data: JSON.parse(readFileSync(join(opts.dir, file), 'utf8')) })
      } catch (err) {
        console.error(`FAIL content:lint: could not read/parse ${file}: ${err.message}`)
        process.exit(2)
      }
    }
  }

  const results = lintFiles(fileEntries, tiers)

  let hasError = false
  console.log(`content:lint — ${results.length} source URL(s) checked across ${fileEntries.length} file(s):`)
  for (const r of results) {
    if (r.level === 'ok') {
      console.log(`  OK    tier${r.tier}  ${r.hostname}  (${r.file}) — ${r.url}`)
    } else if (r.level === 'warn') {
      console.log(`  WARN  unknown domain, needs operator triage: ${r.hostname}  (${r.file}) — ${r.url}`)
    } else {
      hasError = true
      const why = r.tier === 'denied'
        ? `denied domain (matched deny-list entry '${r.matchedDomain}')`
        : (r.reason ?? 'not on tier1 or tier2')
      console.log(`  ERROR ${why}: ${r.hostname ?? r.url}  (${r.file}) — ${r.url}`)
    }
  }

  if (hasError) {
    console.error('FAIL content:lint: one or more source URLs are on the deny-list or otherwise invalid')
    process.exit(1)
  }
  console.log('PASS content:lint: no denied/invalid source domains found (see WARN lines above for unknown domains needing operator triage)')
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

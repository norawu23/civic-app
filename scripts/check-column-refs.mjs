#!/usr/bin/env node
// scripts/check-column-refs.mjs
//
// CI "column-refs" gate (spec DoD item 6): extracts `.from('<table>')` calls
// and the column identifiers used alongside them in supabase-js calls under
// src/, and checks each (table, column) pair against the DDL in
// supabase/migrations/0001_schema.sql. Fails (non-zero exit) on a reference
// to a table or column that does not exist in the migration.
//
// This is a grep-shaped gate, not a full JS/SQL parser: it uses regex-based
// extraction, which is sufficient for the flat `.from()/.select()/.eq()/
// .insert()/.update()/.upsert()` call shapes actually used in this codebase
// (no query builder abstraction, no dynamic table/column names).
//
// Known, accepted false positives (e.g. the legacy client's `progress
// .user_id` / `progress.progress_data` references, which predate the 0001
// schema and are knowingly broken until the P1-1 client deploy — D-002) are
// suppressed via the checked-in allowlist file, not silenced in this script.
//
// Usage:
//   node scripts/check-column-refs.mjs [--dir <src-dir>] [--ddl <ddl-file>]
//                                       [--allowlist <allowlist-file>]
//
// Exit status:
//   0 — no unallowlisted violations
//   1 — one or more unallowlisted (table, column) or unknown-table references
//   2 — usage / tooling error (e.g. DDL file not found)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, resolve as resolvePath } from 'node:path'

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    dir: 'src',
    ddl: 'supabase/migrations/0001_schema.sql',
    allowlist: 'scripts/check-column-refs.allowlist.txt',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') opts.dir = argv[++i]
    else if (a === '--ddl') opts.ddl = argv[++i]
    else if (a === '--allowlist') opts.allowlist = argv[++i]
    else {
      console.error(`unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return opts
}

// ─── DDL parsing ─────────────────────────────────────────────────────────────

const TABLE_LEVEL_KEYWORDS = [
  'constraint', 'primary key', 'unique', 'check', 'foreign key', 'exclude',
]

// Splits the inside of a `create table (...)` block on top-level commas
// (i.e. commas not nested inside parens), so `CHECK (a, b)` doesn't get
// split apart.
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

// Returns Map<tableName, Set<columnName>>
function parseDdlColumns(ddlText) {
  const sql = stripSqlComments(ddlText)
  const tables = new Map()

  // Match `create table [public.]name (` ... up to the matching close paren.
  const createRe = /create\s+table\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi
  let match
  while ((match = createRe.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase()
    const startIdx = match.index + match[0].length // just after the opening '('
    let depth = 1
    let i = startIdx
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
      i++
    }
    const body = sql.slice(startIdx, i - 1) // exclude the closing paren
    const columns = new Set()

    for (const rawSegment of splitTopLevel(body)) {
      const segment = rawSegment.trim()
      if (!segment) continue
      const lower = segment.toLowerCase()
      if (TABLE_LEVEL_KEYWORDS.some(kw => lower.startsWith(kw))) continue
      const colMatch = segment.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?/)
      if (colMatch) columns.add(colMatch[1].toLowerCase())
    }

    tables.set(tableName, columns)
  }

  return tables
}

// ─── Source scanning ─────────────────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

function listSourceFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

// Column-bearing method calls we understand, mapped to how to extract the
// column name(s) from their argument list.
const SINGLE_STRING_ARG_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'contains',
  'order', 'is', 'containedBy', 'overlaps', 'textSearch',
]

// Extracts (table, column) references from a single chained-call window of
// source text that starts at a `.from('table')` call.
function extractRefsFromWindow(table, windowText, refs, tableRefs) {
  tableRefs.add(table)

  // .select('a, b, c')
  const selectRe = /\.select\(\s*(['"`])([^'"`]*)\1/g
  let m
  while ((m = selectRe.exec(windowText)) !== null) {
    const cols = m[2].split(',').map(s => s.trim()).filter(Boolean)
    for (const raw of cols) {
      if (raw === '*') continue
      if (raw.includes('(')) continue // embedded foreign-table select — not this table's column
      // Handle "alias:column" and "column::cast" and trailing modifiers.
      const base = raw.split(':').pop().split('(')[0].trim()
      const colMatch = base.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?/)
      if (colMatch) refs.add(`${table}.${colMatch[1].toLowerCase()}`)
    }
  }

  // .eq('col', ...), .order('col'), etc.
  for (const method of SINGLE_STRING_ARG_METHODS) {
    const re = new RegExp(`\\.${method}\\(\\s*(['"\`])([^'"\`]*)\\1`, 'g')
    while ((m = re.exec(windowText)) !== null) {
      refs.add(`${table}.${m[2].toLowerCase()}`)
    }
  }

  // .insert({...}) / .update({...}) / .upsert({...}, ...)
  const objMethodRe = /\.(insert|update|upsert)\(\s*(\[)?\s*\{([^}]*)\}/g
  while ((m = objMethodRe.exec(windowText)) !== null) {
    const objBody = m[3]
    const keyRe = /(?:^|[{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g
    let km
    while ((km = keyRe.exec(objBody)) !== null) {
      refs.add(`${table}.${km[1].toLowerCase()}`)
    }
  }
}

function extractRefsFromFile(content) {
  const refs = new Set()       // "table.column"
  const tableRefs = new Set()  // "table" (every table referenced, even via *)

  const fromRe = /\.from\(\s*(['"`])([a-zA-Z_][a-zA-Z0-9_]*)\1\s*\)/g
  let m
  const positions = []
  while ((m = fromRe.exec(content)) !== null) {
    positions.push({ index: m.index, end: fromRe.lastIndex, table: m[2] })
  }

  for (let i = 0; i < positions.length; i++) {
    const { end, table } = positions[i]
    const nextFromIndex = i + 1 < positions.length ? positions[i + 1].index : content.length
    const hardCap = end + 500
    const windowEnd = Math.min(nextFromIndex, hardCap, content.length)
    const windowText = content.slice(end, windowEnd)
    extractRefsFromWindow(table, windowText, refs, tableRefs)
  }

  return { refs, tableRefs }
}

// ─── Allowlist ───────────────────────────────────────────────────────────────

function loadAllowlist(path) {
  const allowed = new Set()
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return allowed // no allowlist file is fine — empty allowlist
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    allowed.add(line.toLowerCase())
  }
  return allowed
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2))

  let ddlText
  try {
    ddlText = readFileSync(opts.ddl, 'utf8')
  } catch (err) {
    console.error(`error: could not read DDL file '${opts.ddl}': ${err.message}`)
    process.exit(2)
  }

  const tableColumns = parseDdlColumns(ddlText)
  if (tableColumns.size === 0) {
    console.error(`error: parsed zero tables from '${opts.ddl}' — DDL parser or file is likely wrong`)
    process.exit(2)
  }

  const allowlist = loadAllowlist(opts.allowlist)

  const files = listSourceFiles(opts.dir)
  const violations = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const { refs, tableRefs } = extractRefsFromFile(content)

    for (const table of tableRefs) {
      if (!tableColumns.has(table)) {
        const key = `${table}.*`
        if (!allowlist.has(key) && !allowlist.has(table)) {
          violations.push({ file, kind: 'unknown-table', table, column: null })
        }
      }
    }

    for (const ref of refs) {
      const [table, column] = ref.split('.')
      const columns = tableColumns.get(table)
      if (!columns) continue // already reported above as unknown-table
      if (!columns.has(column) && !allowlist.has(ref)) {
        violations.push({ file, kind: 'unknown-column', table, column })
      }
    }
  }

  if (violations.length > 0) {
    console.error(`check-column-refs: ${violations.length} violation(s) found (scanned '${opts.dir}' against '${opts.ddl}'):\n`)
    for (const v of violations) {
      if (v.kind === 'unknown-table') {
        console.error(`  ${v.file}: .from('${v.table}') — table does not exist in 0001 DDL`)
      } else {
        console.error(`  ${v.file}: '${v.table}.${v.column}' — column does not exist on table '${v.table}' in 0001 DDL`)
      }
    }
    console.error(`\nIf this is a known/accepted case, add it to ${opts.allowlist} (one 'table.column' per line, commented with the reason).`)
    process.exit(1)
  }

  console.error(`check-column-refs: OK — scanned '${opts.dir}' against '${opts.ddl}' (${tableColumns.size} tables), no unallowlisted violations`)
  process.exit(0)
}

main()

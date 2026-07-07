#!/usr/bin/env bash
# scripts/schema-diff.sh
#
# Post-repair equivalence check (ARCHITECTURE §2.1.5 N4 / spec DoD item 4):
# diffs a `pg_dump --schema-only` of one Postgres database against another,
# after normalizing away lines that legitimately differ between environments
# (comments, ownership, search_path SETs, dump timestamps) but do not reflect
# a real schema difference.
#
# Usage:
#   scripts/schema-diff.sh <a> <b>
#
# Each of <a> and <b> may be EITHER:
#   - a libpq connection string / URI (postgres://... or postgresql://...),
#     in which case `pg_dump --schema-only` is run against it, OR
#   - a path to an existing schema-only .sql dump file, used as-is.
#
# Exit status:
#   0  — schemas are equivalent (empty diff after normalization)
#   1  — schemas differ (diff is printed to stdout)
#   2  — usage / tooling error (bad args, pg_dump missing, file not found)
#
# Intended callers:
#   - The repair rehearsal harness (tests/repair-rehearsal.test.mjs), comparing
#     a scratch DB with repair_prod.sql applied against a shadow DB built from
#     supabase/migrations/0001_schema.sql.
#   - The operator, at runbook step 3 (BUILD_PLAN §3a), comparing real prod
#     post-repair against the CI 0001 shadow DB.
#
# This script does not itself decide *how* the shadow DB or scratch DB is
# built — callers are responsible for provisioning both sides.

set -euo pipefail

usage() {
  echo "usage: $0 <connection-string-or-dump-file> <connection-string-or-dump-file>" >&2
  exit 2
}

if [[ $# -ne 2 ]]; then
  usage
fi

A="$1"
B="$2"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Normalize a schema-only dump: drop comment lines, ownership/grant noise,
# session-setup SETs, and blank lines, so only structural DDL is compared.
normalize() {
  local infile="$1"
  local outfile="$2"
  grep -v -E \
    -e '^--' \
    -e '^SET ' \
    -e '^SELECT pg_catalog\.set_config' \
    -e '^ *$' \
    -e '^COMMENT ON ' \
    -e 'ALTER .* OWNER TO ' \
    -e '^GRANT ' \
    -e '^REVOKE ' \
    "$infile" > "$outfile" || true
}

# Resolve one side: either dump it (connection string) or use the file as-is.
resolve() {
  local input="$1"
  local outfile="$2"

  if [[ "$input" == postgres://* || "$input" == postgresql://* ]]; then
    if ! command -v pg_dump >/dev/null 2>&1; then
      echo "error: pg_dump not found on PATH, but '$input' looks like a connection string" >&2
      exit 2
    fi
    pg_dump --schema-only --no-owner --no-privileges "$input" > "$outfile"
  else
    if [[ ! -f "$input" ]]; then
      echo "error: dump file not found: $input" >&2
      exit 2
    fi
    cp "$input" "$outfile"
  fi
}

RAW_A="$WORKDIR/a.raw.sql"
RAW_B="$WORKDIR/b.raw.sql"
NORM_A="$WORKDIR/a.norm.sql"
NORM_B="$WORKDIR/b.norm.sql"

resolve "$A" "$RAW_A"
resolve "$B" "$RAW_B"
normalize "$RAW_A" "$NORM_A"
normalize "$RAW_B" "$NORM_B"

if diff -u "$NORM_A" "$NORM_B"; then
  echo "schema-diff: empty diff — schemas are equivalent" >&2
  exit 0
else
  echo "schema-diff: schemas DIFFER (see diff above)" >&2
  exit 1
fi

#!/usr/bin/env bash
# scripts/ci-local-precheck.sh
#
# Fast, dependency-free subset of CI, meant to run in a pre-push hook so the
# cheap regressions never reach main (builders branch off main; keep it green).
#
# This runs ONLY the pure-Node CI checks — no Docker, no Postgres — so it is
# reliable everywhere and finishes in seconds. It is deliberately NOT a full
# replica of CI: the migrations/auth/rls DB suites and the content seeder run
# server-side in GitHub Actions (and locally via CIVIC_TEST_DB_URL + the pg
# stub, see CLAUDE.md). Treat a green run here as "the fast gates pass," not
# "CI will be green" — the DB layer is still only proven in Actions.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
run() {
  local label="$1"; shift
  printf '  • %s … ' "$label"
  if out=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAIL"
    echo "$out" | sed 's/^/      /' | tail -20
    fail=1
  fi
}

echo "local pre-push checks (pure-Node CI subset):"
run "nuance calibration harness"      node tests/nuance/calibration.test.js
run "column-reference gate"           node scripts/check-column-refs.mjs
run "column-refs negative test"       node tests/column-refs-negative.test.mjs
run "xp_awards seed assertion"        node tests/xp-awards-seed.test.mjs
run "content schema validation"       npm run --silent content:validate
run "content pipeline fixtures"       npm run --silent content:test

if [ "$fail" -ne 0 ]; then
  echo "✗ local pre-push checks failed — push blocked. Fix, or bypass with 'git push --no-verify'."
  exit 1
fi
echo "✓ fast checks pass. NB: DB/RLS/auth suites + content seeding run in Actions — watch the run."
exit 0

# Audit 002 — Architecture v2 (Opus adversarial re-audit)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor as 001 (context retained) · **Subject:** docs/ARCHITECTURE.md v2
**Verdict: NOT HARDENED — 0 blockers, 3 majors, 7 minors**

## Resolution check on audit-001 findings
- B1 → PARTIAL (mechanism exists; paired-data half undermined by N1/N2)
- M2, M3, M4, M7, m1–m6 → RESOLVED (verified real, not cosmetic; §4.1 inventory grep-verified complete; "27 debug statements" verified exact)
- M5 → SUBSTANTIALLY RESOLVED (residual N5)
- M6 → PARTIAL (account path fixed; v2 opened ungated guest collection — N3)

## New findings

| # | Class | Title |
|---|---|---|
| N1 | MAJOR | Guests have no day-30 submission RPC — prose promises a mechanism absent from the authoritative interface |
| N2 | MAJOR | Sample math's recapture-cohort size unstated; derived from plan's own targets the true acquisition bar is ~300 users, not 150–200 |
| N3 | MAJOR | Age gate covers accounts only; v2's anonymous baseline created server-side collection of minors' political opinions with no age assertion |
| N4 | MINOR | Migration repair: birth_year NOT NULL unsatisfiable for legacy users; no post-repair prod-vs-shadow schema diff |
| N5 | MINOR | P0 has no internal cut line; never-cut list ≈ all of P0 |
| N6 | MINOR | Structured scoring still gameable; must state nuance quiz carries no XP/reward |
| N7 | MINOR | Signup trigger failure modes (username collision, missing metadata) unhandled |
| N8 | MINOR | Anon quota bypassable by regenerating anon_id; IP limits needed on both anon RPCs; admin exclusion for polluted rows |
| N9 | MINOR | Column-level UPDATE restriction on profiles asserted but mechanism unnamed |
| N10 | MINOR | Email channel half-specified (needs provider Edge Function + unsubscribe; recipients are minors) |

Response in ARCHITECTURE.md v3 changelog.

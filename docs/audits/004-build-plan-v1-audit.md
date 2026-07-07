# Audit 004 — Build Plan v1 (Opus adversarial audit)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor (architecture context retained) · **Subject:** docs/BUILD_PLAN.md v1
**Verdict: NOT HARDENED — 0 blockers, 3 majors, 9 minors**

## Coverage walk
All 14 §3 RPCs, schema, trust, instrument, observability, P1/P2 features map to chunks; r1–r8 transcriptions individually verified present. Exceptions became findings.

## Findings

| # | Class | Title |
|---|---|---|
| P-1 | MAJOR | Operator (the declared binding constraint) has no day budget; reconstructed midpoint load ≈ 27–30 operator-days vs 25 available — >100% before rework |
| P-2 | MAJOR | B2 reintroduces client-supplied time (±1-day clamp, gameable) contradicting hardened §3.2; adds `complete_level3_quiz` absent from the authoritative RPC list; B2 not on adversarial-review list |
| P-3 | MAJOR | P0 total is 51 bd, not "~42" — the stated figure omits the H content track; slack is ~32%, not ~40% |
| P-4 | MINOR | §4.5 routing reducer has no chunk (home: D3; P1 deep links depend on it) |
| P-5 | MINOR | Prod-repair runbook: no owner, timing, backup step; builders' prod-credential posture unstated |
| P-6 | MINOR | Acquisition window silently widened to "Sept 5–15"; Sept 15 joiners can't complete the metric window |
| P-7 | MINOR | Unstated cross-chunk dependencies (B1←H1 seeds; F1-r8←B5; E2←F1/B4/C2; D3↔F1) |
| P-8 | MINOR | Events allowlist freezes Jul 11 but is designed in G1 (weeks 3+) — premature freeze guaranteed |
| P-9 | MINOR | Smoke flow #1 unassigned; "E3" referenced in P1-2 doesn't exist as a chunk id |
| P-10 | MINOR | §8.2 in-product admin-visibility disclosure has no DoD home |
| P-11 | MINOR | P1-8 modifies frozen `check_streak` post-freeze; must be marked an interface amendment with regression rerun |
| P-12 | MINOR | C1 "≥122 bits entropy" DoD untestable as written; testable form is CSPRNG-by-inspection + format/uniqueness test |

## What held up under attack (auditor)
P1 arithmetic; P0 exit criteria checkability (physical-iPhone check endorsed); day-30-UI timing argument re-verified; r1–r8 complete; go/no-go coherent incl. r7; C2-against-stubs decoupling; chunk template + escalation rule as the right Sonnet control.

Response in BUILD_PLAN.md v2 changelog.

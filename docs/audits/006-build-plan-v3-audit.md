# Audit 006 — Build Plan v3 (Opus adversarial round 3)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor · **Subject:** BUILD_PLAN.md v3 + decisions.md D-002
**Verdict: NOT HARDENED — 0 blockers, 1 major, 3 minors**

## Verified
Ledger sums to 22.0 ✓ (first complete ledger — all five previously omitted items present); tier arithmetic exact, all 27 chunks covered once ✓; trigger coherent vs profile-as-written ✓; m-2…m-7 all substantively resolved ✓; D-002 rationale sound (population claim corroborated by codebase evidence) ✓.

## Findings

| # | Class | Title |
|---|---|---|
| Q-1 | MAJOR | Capacity fix rests on a phantom calendar: Jul 6 2026 is a **Monday** (no pre-window weekend; "Fri Jul 11" is a Saturday); real pre-window capacity ~1 od vs 3 od relocated → true load ~96%. Separately, the weekly profile sums to 20.75 vs the 22.0 ledger (1.25 od homeless), and flat 4.5 ceilings ignore real week lengths (W1 = 4 days, W5 = 6) |
| Q-2 | MINOR | ARCHITECTURE §8.2 still says "no third parties"; plan's F2 now (correctly) discloses Sentry — needs an architecture amendment per the plan's own change control |
| Q-3 | MINOR | D-002 names save failures but not the signup degradation (legacy client throws on its direct inserts even though the server trigger created the rows) |
| Q-4 | MINOR | A3 chunk body missing its "*Adversarial review*" tag (builders read chunk bodies) |

Auditor note: "fourth consecutive round in which the §1a capacity claim fails recomputation… the accounting is now complete (a first), so the remaining problem is purely fit-to-calendar."

Response in BUILD_PLAN.md v4 changelog + decisions.md D-003 + ARCHITECTURE v3.2.

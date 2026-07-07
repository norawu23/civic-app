# Audit 005 — Build Plan v2 (Opus adversarial round 2)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor · **Subject:** BUILD_PLAN.md v2 + decisions.md D-001 + ARCHITECTURE v3.1
**Verdict: NOT HARDENED — 0 blockers, 1 major, 6 minors**

## Resolution check
P-2…P-12 substantively resolved. D-001 gaming analysis independently stress-tested and held (worst case: one-time single-day phase borrow + traveler-equivalent boundary choice; no lapsed-streak resurrection; streaks carry no XP). P-1's arithmetic verified internally correct — but incomplete (M-1). P-3 totals re-summed ✓ (52 bd, ~30% slack). Tier-3 integrity question examined: no exploit constructible through client chunks past the RPC/RLS wall — tiering sound for integrity.

## Findings

| # | Class | Title |
|---|---|---|
| M-1 | MAJOR | Operator ledger achieves 80% by omission (prod-repair execution, neutrality-pass orchestration, exit-criteria verification, go/no-go, P1 spec authoring ≈ +2–4 od → ~88–96%); week-1 planned at 95% violates the plan's own >90% relief trigger; 3-od reserve double-booked against content rework |
| m-2 | MINOR | §1 handoff paragraph lists 4 adversarial chunks; D-001 made it 5 — stale where builders read it |
| m-3 | MINOR | D-001 propagated to B2 only: `tz_offset_minutes` missing from A1 DoD; client-refresh missing from C2 scope |
| m-4 | MINOR | A3 (RLS suite) belongs in Tier 1 — one builder writes both policies and the tests that pass them |
| m-5 | MINOR | G3/Sentry is a privacy chunk reviewed as hygiene; default breadcrumbs can leak minors' content to a third party; contradicts F2's "no third parties" copy |
| m-6 | MINOR | Week-2 prod repair breaks cloud saves for the deployed legacy client until P1-1 — coexistence window needs an explicit decision |
| m-7 | MINOR | `src/data-layer/events.js` has no owning chunk (C2 vs G1 ambiguity) |

Response in BUILD_PLAN.md v3 changelog + decisions.md D-002.

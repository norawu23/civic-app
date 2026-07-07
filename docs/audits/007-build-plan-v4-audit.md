# Audit 007 — Build Plan v4 (Opus adversarial round 4)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor (context across all 7 rounds) · **Subject:** BUILD_PLAN.md v4 + decisions.md (D-002 amendment, D-003) + ARCHITECTURE v3.2
**Verdict: HARDENED — no blockers, no unaddressed majors**

## Q-1 verification (the round-3 major)
Calendar independently re-derived (Jan 1 2026 = Thursday): Jul 6 = Monday ✓, freeze = Fri Jul 10 in all three references ✓, W1 = 4 days / W5 = 6 days / total 25 ✓. Ledger re-summed 22.0 ✓; weekly profile sums to ledger exactly, each row's itemization internally exact ✓; every week ≤ real-capacity ceiling ✓. Batch 1a/1b split verified against need-by dates (B specs can't precede the Friday freeze; A2/A3 need A1 merged → Mon Jul 13 arrival is exactly on time). Weekend commitment ruled honest: named real dates, bounded 2 od, non-recurring (verified absent elsewhere), front-loaded, and a missed session is a defined trigger event with a pre-decided consequence. **RESOLVED.**

Q-2, Q-3, Q-4: all verified RESOLVED.

## Residual minors (fixed in v4.1 immediately after this audit)
- f-1: ARCHITECTURE §8.2 body text still said "no third parties" (superseded by the v3.2 header note but not edited in place)
- f-2: plan Basis line cited v3.1
- f-3: weekly "Main items" labels park ~0.85 od of committed spec/review work under "reserve" — relabel "reserve + spillover"; both declared invariants (sum-to-ledger, under-ceiling) hold exactly

## Auditor's closing summary
"The capacity case — the defect that survived three rounds in successively smaller forms — now consists of a complete ledger, laid onto the actual 2026 calendar… summing exactly, with its one uncomfortable fact (0.5 od of total headroom) stated rather than engineered away… The three residual minors are one-line edits with no bearing on feasibility, coverage, or integrity."

## Loop record (plan)
- v1 → audit 004: 0 blockers, 3 majors, 9 minors
- v2 → audit 005: 0 blockers, 1 major, 6 minors
- v3 → audit 006: 0 blockers, 1 major, 3 minors
- v4 → audit 007: **HARDENED**

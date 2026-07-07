# Audit 003 — Architecture v3 (Opus adversarial round 3)

**Date:** 2026-07-06 · **Auditor:** same Opus-class auditor (context retained across rounds) · **Subject:** docs/ARCHITECTURE.md v3
**Verdict: HARDENED — no blockers, no unaddressed majors**

## Resolution check
All ten audit-002 findings (N1–N10) verified RESOLVED substantively. Auditor independently re-checked the §5.1.4 arithmetic (0.072F + 0.0168F ≈ 0.089F → ~281 users ✓), the day-30-UI timing argument (first users Sept 1 + 28 days = Sept 29 ✓), and the spec §9 XP table (nuance quiz carries no XP — no spec conflict ✓).

## Residual minors — transcribed into BUILD_PLAN.md as definition-of-done items

| # | Item | Build-plan home |
|---|---|---|
| r1 | `anon_id` must be crypto-random ≥122-bit (bearer credential); tested | Chunk C1 (guest envelope) |
| r2 | Post-link identity rules: anon RPCs reject linked anon_ids; paired-delta views dedup (prefer authed row) | Chunks B4 (nuance RPCs), G2 (views) |
| r3 | `needs_profile_completion` column in DDL; trigger rejects/voids under-13 birth years server-side | Chunk A2 (auth trigger) |
| r4 | Age-gate block persists client-side for the device after an under-13 answer | Chunk F1 (age gate) |
| r5 | Anon rate limits calibrated for classroom bursts (school NAT); RPC-rejection monitoring; explicit tested parameter | Chunk B4 |
| r6 | iOS Safari 7-day storage eviction: acknowledge in §5.1.4, prompt PWA install for guests, treat guest-path rate as first assumption to reprice | Chunks C1, E2; §5.1.4 note |
| r7 | `delete_account` must land before soft launch if descoped to P1 (privacy page promises it) | Schedule constraint, P1 ordering |
| r8 | Legacy account answering re-prompt with under-13 year → account + data deletion (actual-knowledge exposure) | Chunk F1 |

## Constraint check (auditor)
Sept 1 live: aggressive but internally consistent. Paired data by mid-Oct: mechanism complete both ends, both cohorts; bar honest (~300 users). Solo owner: admin workload bounded. Spec coverage: all 10 features architected and phased.

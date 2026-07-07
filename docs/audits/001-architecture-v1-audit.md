# Audit 001 — Architecture v1 (Opus adversarial audit)

**Date:** 2026-07-06 · **Auditor:** Opus-class, neutral adversarial · **Subject:** docs/ARCHITECTURE.md v1
**Verdict: NOT HARDENED — 1 blocker, 6 majors, 6 minors**

## Codebase claims verified by auditor
1. ✅ TRUE — All XP/progress writes are client-composed (useProgress.js).
2. ✅ TRUE (worse than stated) — 001_init.sql is *actively wrong* vs code, not merely incomplete; live DB was hand-edited away from it.
3. ⚠️ OVERSTATED — "Keep the UI layer": OpinionBuilderScreen computes XP and writes evolved_takes directly; QuizScreen computes score. Kept screens embed data-layer logic.
4. ✅ TRUE — Streak logic uses device clock for all users.

## Findings

| # | Class | Title |
|---|---|---|
| B1 | BLOCKER | Nuance pipeline cannot deliver the 30-day dataset: guests excluded from baseline; baseline deferred past first session; no day-30 sample mechanism |
| M2 | MAJOR | Baseline-migration strategy leaves broken 001_init.sql in place; fresh envs provision unusable schema |
| M3 | MAJOR | "Keep the UI layer" understates scope; data logic embedded in kept screens; call signatures can't stay same |
| M4 | MAJOR | Guest→account migration contradicts server-authoritative design (snapshot vs event-replay mismatch) |
| M5 | MAJOR | Timeline vs scope aggressive; offline-queue+integrity+migration triad on critical path, underspecified |
| M6 | MAJOR | No age gate; minors' political-opinion data + unverified classroom teachers = legal exposure |
| M7 | MAJOR | Written-answer nuance scoring rests on gameable heuristic with unscalable manual backstop |
| m1 | MINOR | Initial progress row creation unspecified under RPC-only writes |
| m2 | MINOR | "One streak freeze per month" not enforceable from schema |
| m3 | MINOR | "New topics = no code changes" contradicted by hardcoded config |
| m4 | MINOR | events anon INSERT rate-limiting not achievable in pure RLS |
| m5 | MINOR | Server-side quiz grading: threat model should be stated (answers ship client-side regardless) |
| m6 | MINOR | Baseline-timing deviation from spec should be a recorded, conscious change |

Full audit text preserved in git history of this file's first commit; response in ARCHITECTURE.md v2 changelog.

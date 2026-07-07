# Chunk spec E1 — Nuance rubric + golden set harness

**Workstream:** WS-E (nuance instrument) · **Estimate:** 1 bd + operator time · **Review tier:** 2 (standard)
**Issued:** 2026-07-06 (batch 1a) · **Basis:** ARCHITECTURE.md v3.2 §5.1.3; BUILD_PLAN.md §3 E1
**Start:** Tue Jul 7 · **Blocks B4 merge** (calibration must be green before B4 lands, W2/W3)
**Operator dependency:** hand-scoring of the 20 golden examples happens Sat–Sun Jul 11–12 (§1a). You build the harness against provisional fixtures; the operator's scores replace them Monday Jul 13.

## Objective

Write `docs/NUANCE_RUBRIC.md` — the public, mechanical scoring rubric for nuance sessions — and build the golden-set calibration harness: 20 fixture examples plus a CI job that runs them against the server scoring function and fails on any mismatch. This is the calibration gate B4's scoring implementation must pass before merge.

## In-scope files

- `docs/NUANCE_RUBRIC.md` (new)
- `tests/nuance/golden-set.json` (new — 20 fixtures)
- `tests/nuance/calibration.test.js` (new — harness)
- `tests/nuance/reference-scorer.mjs` (new — JS reference implementation, see below)
- `.github/workflows/ci.yml` (extend — `calibration` job only)

## Interfaces consumed

- Scoring rules, verbatim from ARCHITECTURE §5.1.3 (do not reinterpret):
  - Yes/No tap = **1 point**
  - "It's complicated" = **2 points**
  - Both structured fields (*"Your position"*, *"The strongest point on the other side"*) completed non-trivially — each **≥ 40 chars** and not near-duplicates of each other by **trigram similarity** = **3 points**
- `answers` jsonb shape (frozen Jul 10 with the B4 signatures): `[{question_id, response_type: 'tap'|'complicated'|'structured', position?, other_side?}]`
- B4's SQL function is the eventual system under test; until it exists the harness runs against the reference scorer (see toggle below).

## Interfaces exposed

- **Fixture format** (consumed by B4's DoD and by CI):
  ```json
  { "id": "gs-01", "answers": [ ... ], "expected_score": 3,
    "rationale": "one-line why", "provisional": true }
  ```
  `provisional: true` marks builder-authored placeholders; the operator's Jul 11–12 pass replaces content and deletes the flag. **CI fails if any `provisional` fixture remains after Jul 13.**
- **Trigram-similarity threshold**: propose a concrete threshold (e.g. similarity > 0.6 = near-duplicate) in the rubric, with 3 boundary fixtures demonstrating it. The operator ratifies the number at review; B4 implements the same threshold in SQL (`pg_trgm`).
- `reference-scorer.mjs`: pure function `score(answers) → int`, the executable form of the rubric. B4's SQL must agree with it on all 20 fixtures — discrepancy between reference and SQL is a B4 bug or a rubric ambiguity to escalate, never silently resolved.
- Harness mode toggle: `CALIBRATION_TARGET=reference|rpc` — `reference` runs now; `rpc` (against local Supabase `submit_nuance_session`) is wired but skipped until B4 lands, then becomes the required CI mode.

## Definition of done

- [ ] `NUANCE_RUBRIC.md` states the three scoring levels, the 40-char rule, the trigram rule with its threshold, worked examples for every score, and the documented limitation (structure ≠ semantic quality; the claim is "willingness and ability to articulate both sides")
- [ ] Rubric documents the gibberish path: low-effort text still scores mechanically; the `excluded` flag + 10% admin spot-check absorbs it (N6/N8) — the scorer itself makes no quality judgment
- [ ] 20 fixtures covering: all three score levels · both boundary sides of 40 chars (39/40/41) · near-duplicate pair just above and just below the trigram threshold · "complicated" tap · empty `other_side` on a structured attempt (scores 2, not 3 — position alone ≠ both sides) · gibberish that mechanically scores 3
- [ ] Reference scorer passes all 20; CI `calibration` job red on any mismatch
- [ ] RPC-mode harness wired (skipped) with a TODO referencing B4
- [ ] Handoff note lists every fixture the builder found ambiguous under the rubric — these are exactly what the operator adjudicates while hand-scoring Jul 11–12

## Required tests

- The calibration harness itself is the test; additionally:
- Unit tests on `reference-scorer.mjs`: each rule in isolation, plus the 40-char and trigram boundaries
- A deliberately wrong fixture (fixture expecting 3 for a bare tap) in a negative test proves the harness fails loudly, then is removed
- Fixture-schema validation: every golden-set entry parses and carries all required keys

## Out of scope (do not touch)

- The SQL scoring implementation and rate limits (B4)
- The baseline quiz UI, framing copy, and skip tracking (E2)
- Hand-scoring content — you author *provisional* fixtures only; the operator owns final scores
- `nuance_sessions` schema or any migration (A1)
- Day-30 anything (RPCs B4, UI P1-2)
- Admin spot-check tooling (G2)

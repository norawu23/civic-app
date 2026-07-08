# Chunk spec B4 — Nuance RPCs + scoring

**Workstream:** WS-B (RPC layer) · **Estimate:** 3 bd · **Review tier:** 1 (integrity — adversarial second pass; this is the measurement instrument)
**Issued:** 2026-07-08 (batch 2) · **Basis:** docs/specs/WS-B-signatures.md (FROZEN, D-010 + D-011 — incl. ruling 2, the column-grant masking migration, and ruling 4, replay-idempotency); ARCHITECTURE.md v3.2 §3 (N8 abuse controls), §5.1.2–§5.1.3; docs/NUANCE_RUBRIC.md + docs/specs/E1-rubric-golden-set.md (merged — your scoring must match); BUILD_PLAN.md §3 B4 `[r2]` `[r5]`; migrations 0001–0003; D-005 §4 (threshold proposal-and-ratify); **D-012** (batch-2 rulings)
**Start:** Mon Jul 13 (W2) · Depends on: **A1/A2/A3 merged**; **E1 merged** (calibration harness — blocks your merge, not your start). **The operator's Jul 11–12 hand-scoring lands Mon Jul 13:** final golden-set fixtures replace the provisional ones and the trigram threshold ratifies (D-005 §4). Build against the current proposal (**0.55**); expect at most a one-constant change. · Consumers: C2 (wrappers), E2 (baseline UI), P1-2 (day-30 UI), G2 (sole score read path after your masking migration)

## Objective

Implement the three nuance RPCs in `0007_rpc_nuance.sql` with server-side rubric scoring (`pg_trgm`), the ≥28-day day-30 precondition, IP + anon-id rate limits sized for classroom bursts `[r5]`, linked-anon-id rejection `[r2]`, pre-checked idempotent resubmission (no raw 23505 may ever surface — D-011 ruling 4), and the **`nuance_sessions` column-grant masking migration** that makes the ratified no-score-shown stance structural (D-011 ruling 2).

## Migration ownership

**`supabase/migrations/0007_rpc_nuance.sql` — owned exclusively by B4 (D-005 §1).** Contains: `pg_trgm` install, scoring function, the two parameter-slot functions, `nuance_rate_limits` table, the three RPCs, and the masking grant change.

## In-scope files

- `supabase/migrations/0007_rpc_nuance.sql` (new)
- `tests/rpc/b4-nuance.test.mjs` (new)
- `tests/nuance/calibration.test.js` (**extend only as E1's TODO directs** — wire `CALIBRATION_TARGET=rpc` mode against your live `submit_nuance_session`; the fixtures and reference scorer are E1's, read-only)
- `.github/workflows/ci.yml` (extend — a new `rpc-nuance` job **only**, plus flipping the `calibration` job to run rpc mode once your migration is in the chain)

## Interfaces consumed (frozen — do not redesign)

- **Signatures, verbatim from WS-B-signatures.md §4/B4:**
  - `submit_nuance_session(kind text, answers jsonb)` → S2 `{accepted: true}`. Grant: `authenticated`.
  - `submit_nuance_baseline_anon(anon_id text, answers jsonb)` → S2 `{accepted: true}`. Grant: **`anon` only** (D-011 — tightened; do not add `authenticated`).
  - `submit_nuance_day30_anon(anon_id text, answers jsonb)` → S2 `{accepted: true}`. Grant: **`anon` only**.
  - `kind ∈ {'baseline','day30'}` (D-010 — two values; the 0001 CHECK agrees). All three return the identical information-free ack — **no score, ever, on any path** (ratified by owner 2026-07-08).
- Contract §1/§6: grant wall incl. PUBLIC revoke; error codes `not_authenticated`, `invalid_params`, `invalid_answers`, `rate_limited`, `anon_id_linked`, `baseline_missing`, `baseline_too_recent`. **Resubmission of an existing (identity, kind) is an idempotent success**, never an error (D-011 ruling 4).
- **`answers` shape (D-008, frozen):** `[{question_id, response_type: 'tap'|'complicated'|'structured', position?, other_side?}]`; on `'tap'`, `position` holds literal `'yes'`/`'no'`. The `invalid_params` / `invalid_answers` boundary (D-011): `answers` not a jsonb array at all → `invalid_params`; well-formed array whose **content** violates the shape (bad `response_type`, missing `question_id`, tap without yes/no `position`, duplicate `question_id`, length outside 1–12, serialized size > 8 KB) → `invalid_answers`.
- **NUANCE_RUBRIC.md scoring (merged; do not reinterpret):** tap = 1 · complicated = 2 · structured with both fields ≥ 40 chars **and** not near-duplicates = 3 · **a failed structured attempt scores 2, not 1**. Length = `char_length()` on the field **as stored, untrimmed** (the rubric's documented choice — do not add `trim()`; Postgres `char_length` counts code points, which is the rubric's intent). Near-duplicate ⇔ `similarity(position, other_side) > threshold`, `pg_trgm` semantics. Session `score` = sum over the array.
- 0001 `nuance_sessions` DDL: identity CHECK, `UNIQUE NULLS NOT DISTINCT (user_id, anon_id, kind)`, `score NOT NULL`, `elapsed_days`, `excluded`.
- B4 consumes **none** of B1's snapshot helpers (S2 acks carry no snapshot).

## Interfaces exposed

**Parameter slots (D-012 §9)** — two single-definition SQL functions so ratified/tuned values change in one place, mirroring the reference scorer's named constants (D-005 §4):

```sql
nuance_trgm_threshold() returns real     -- 0.55 at authoring; the D-005 §4
                                         -- ratified value lands Mon Jul 13 —
                                         -- changing it post-ratification is a
                                         -- decisions.md event
nuance_rate_limit_per_hour() returns int -- 60 (BUILD_PLAN [r5], classroom-burst sized)
```

**Scoring:** `nuance_score(answers jsonb) returns int` — internal (execute revoked), implements the rubric exactly; install `pg_trgm` via `create extension if not exists pg_trgm with schema extensions;` and call `extensions.similarity()` **schema-qualified** (the contract pins `search_path = public, pg_temp`, which does not include `extensions`). If your SQL disagrees with `tests/nuance/reference-scorer.mjs` on any golden-set fixture, **escalate — never silently resolve** (rubric "Known ambiguities" 1–3 name the likely culprits: trimming, grapheme clusters, trigram fidelity).

**`nuance_rate_limits` (new table, D-012 §9):** `(ip text, window_start timestamptz, count int, primary key (ip, window_start))` — hourly windows; RLS enabled, zero policies (server-internal). IP from `current_setting('request.headers', true)::json->>'x-forwarded-for'` (first hop); a missing header falls into a shared `'unknown'` bucket (fail-closed-ish, never fail-open). Counting rides the two **anon** RPCs only (the authed RPC has identity + the unique constraint; contract: `rate_limited` is anon-only).

**Check order (normative — same skeleton for all three RPCs, items skipped where n/a):**

1. Param type checks (`invalid_params`): `kind` in the frozen pair (authed RPC); `anon_id` non-empty text, UUID-format (anon RPCs); `answers` an array.
2. `answers` content validation (`invalid_answers`, boundary as above).
3. **`anon_id_linked`** `[r2]` (anon RPCs): any `nuance_sessions` row with this `anon_id` and `user_id IS NOT NULL` → reject.
4. **Duplicate pre-check → idempotent success:** existing row for (identity, kind) — `(uid, NULL, kind)` authed; `(NULL, anon_id, kind)` anon — → return `{accepted: true}`, **no write, no scoring, no rate-limit consumption** (a lost-ack retry must never be rate-limited into a failure).
5. **`rate_limited`** (anon RPCs): increment-and-check the IP window against `nuance_rate_limit_per_hour()`.
6. **Day-30 preconditions** (both day-30 paths, authed `kind='day30'` included): locate the identity's baseline row — authed: earliest `kind='baseline'` row with `user_id = uid` (a linked-anon baseline from import counts; that is the point of §4.6 linking); anon: `(NULL, anon_id, 'baseline')`. None → `baseline_missing`; younger than 28 days → `baseline_too_recent`. `elapsed_days := floor(extract(epoch from now() - baseline.created_at) / 86400)`.
7. Score + insert (`score`, `elapsed_days` on day-30 rows) + ack.

**Masking migration (D-011 ruling 2 — rides this file, after the RPCs):**

```sql
revoke select on public.nuance_sessions from authenticated;
grant select (id, user_id, anon_id, kind, answers, excluded, created_at)
  on public.nuance_sessions to authenticated;
```

`score` and `elapsed_days` are excluded; own-row `answers`/`kind`/`created_at` stay readable (§5.1.5 "then vs now"). Consumer impact you must document in your handoff note: (a) any client `select *` on this table now errors — C2 must select explicit columns; (b) the grant is role-level, so **admins lose direct score SELECT too** — G2's admin views must be SECURITY DEFINER, which D-011 already designates as the sole score path. A3's policies are untouched (this is a grant change layered on 0003, not a policy edit).

## Definition of done

- [ ] `0007` applies cleanly on 0001→0006 from empty; full-chain migrations job green
- [ ] All three RPCs match the frozen signature table exactly — including the **`anon`-only** grants on the two anon RPCs (+ PUBLIC revoke everywhere; test: an authed caller invoking an anon RPC hits the grant wall)
- [ ] **Calibration green in rpc mode:** every golden-set fixture scores identically through the live `submit_nuance_session` and the reference scorer; CI `calibration` job flipped per E1's TODO. Any mismatch is escalated, not patched
- [ ] Threshold and rate limit exist **only** in their slot functions; the ratified Jul 13 threshold value is in place at merge
- [ ] Resubmission battery: authed baseline ×2, anon baseline ×2, day-30 ×2 → second call acks with **no** new row, no error, no 23505 in logs; UNIQUE constraint never raises through the RPC
- [ ] Burst simulation `[r5]`: 30 submissions/10 min/1 IP (distinct anon_ids) all pass; 200 in the hour → `rate_limited` after the 60th; replays within a hot window still ack (order pin 4-before-5)
- [ ] `anon_id_linked`: an anon_id linked via a simulated import (row with `user_id` set) is rejected on both anon RPCs
- [ ] Day-30: no baseline → `baseline_missing`; baseline 27 days old → `baseline_too_recent`; 28 days → accepted with `elapsed_days = 28`; authed day-30 against an import-linked baseline works
- [ ] Score/elapsed_days invisible: after the masking migration, an own-row authed `select score` fails with permission denied while `select kind, answers, created_at` succeeds; no RPC return contains a score under any input
- [ ] `rpc-nuance` CI job green; SKIP-not-fail without Docker

## Required tests

- Scoring unit-level (via a definer test wrapper or direct calls as owner): each rubric rule in isolation — tap/complicated/structured; 39/40/41-char boundary; near-duplicate just above/below threshold (gs-09/gs-10 land correctly); failed structured attempt → 2; empty `other_side` → 2; gibberish pair → 3 (gs-11, documented limitation)
- Full golden set through the RPC (the calibration harness is the vehicle — fresh identity per fixture)
- `invalid_params` vs `invalid_answers` boundary: non-array vs bad-content fixtures on both sides, incl. `kind='session'` (the D-010-rejected third value) → `invalid_params`
- Rate limits: burst table above + window rollover (manipulate `window_start` directly); missing `x-forwarded-for` header → shared bucket still limits
- Idempotency, linked-id, day-30 preconditions per DoD (manipulate `created_at` via psql to simulate the 28-day clock — never sleep)
- Masking: column-grant assertions both directions; admin role also denied direct `score` SELECT

## Out of scope (do not touch)

- Golden-set fixture **content** and the reference scorer (E1's, operator-owned as of Jul 13); the rubric document itself
- Baseline/day-30 UI, framing copy, skip tracking (E2, P1-2); reminder emails (P1-3)
- G2's admin views and the `excluded` toggle — you only guarantee the column-grant reality they build on
- `import_guest_snapshot`'s anon-row linking (B5 — it writes `user_id` onto your rows; you only read the result in tests)
- Any change to the D-008 `answers` shape or the two-value `kind` domain (frozen)
- 0001–0006, 0008; A3 policy edits (your masking change is grants-only)

## Decisions log

Signatures are D-010/D-011 (FROZEN; anon-only grants, two-value `kind`, replay-idempotency, and the masking migration are recorded rulings). New pins this spec executes: **D-012** §9 (parameter-slot functions; `nuance_rate_limits` table; `pg_trgm` in the `extensions` schema, schema-qualified calls; the exact masked column list; check-order incl. duplicate-before-rate-limit). The threshold value itself ratifies via D-005 §4 on Jul 13. Conflicts — including any SQL-vs-reference scoring disagreement — escalate (D-013+), never a silent edit.

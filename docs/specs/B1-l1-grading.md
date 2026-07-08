# Chunk spec B1 — L1 grading RPCs

**Workstream:** WS-B (RPC layer) · **Estimate:** 2 bd · **Review tier:** 2 (standard)
**Issued:** 2026-07-08 (batch 2) · **Basis:** docs/specs/WS-B-signatures.md (FROZEN, D-010 + D-011); ARCHITECTURE.md v3.2 §3, §3.1, §5.8; BUILD_PLAN.md §3 B1 + cross-dependency sheet; migrations 0001–0003 (merged); D-005 §1/§2; **D-012** (batch-2 rulings: flag-map semantics, helper ownership)
**Start:** Mon Jul 13 (W2) · Depends on: **A1/A2/A3 merged** (0001–0003), **H1 merged** (`content:seed` — your tests need seeded `quiz_answer_keys`/`topics_catalog`; run `npm run content:seed` against your local stack, per the cross-dependency sheet) · Consumers: C2 (io.js wrappers), D1 (quiz/lesson screens), **B2/B3/B5 (the shared helpers in your migration — see Interfaces exposed)**

## Objective

Implement `complete_flashcards` and `complete_quiz` in `0004_rpc_grading.sql`: server-side grading against `quiz_answer_keys`, XP from `xp_awards`, idempotent flag writes to `progress`, and the next-topic unlock (which fires on L3-quiz completion and therefore lives in this chunk, not B2's). This migration also carries the three **shared internal helpers** every other WS-B progress-writing chunk consumes.

## Migration ownership

**`supabase/migrations/0004_rpc_grading.sql` — owned exclusively by B1 (D-005 §1).** No other chunk may touch it; you may not touch 0001–0003 or 0005–0008.

## In-scope files

- `supabase/migrations/0004_rpc_grading.sql` (new)
- `tests/rpc/b1-grading.test.mjs` (new — creates the `tests/rpc/` directory)
- `tests/lib/supabase-stack.mjs` (**consume only**)
- `.github/workflows/ci.yml` (extend — a new `rpc-grading` job **only**, per the per-chunk job convention; job-append merge conflicts are hand-resolved by the operator, as with A2/A3)

## Interfaces consumed (frozen — do not redesign)

- **Signatures, verbatim from WS-B-signatures.md §4/B1** (any deviation is a decisions.md event, not an edit):
  - `complete_flashcards(topic_id text, level int)` → S1 `{snapshot, xp_awarded}`. Grant: `authenticated`.
  - `complete_quiz(topic_id text, level int, answers int[])` → S1 `{snapshot, xp_awarded, n_correct: int}`. Grant: `authenticated`.
- Return/error conventions: contract §1 (SECURITY DEFINER, `set search_path = public, pg_temp`, `returns jsonb`, replay = success with `xp_awarded: 0`), §2 (snapshot shape), §6 (error codes: `not_authenticated`, `invalid_params`, `unknown_topic`, `locked_topic`, `invalid_answers`).
- `quiz_answer_keys(topic_id, level, answers int[])` + `topics_catalog(topic_id, position, level_count)` — seeded by H1's `content:seed`; `xp_awards` rows `quiz = 50`, `quiz_perfect_bonus = 25`, `flashcards = 50` (0001).
- **D-012 §1 flag-map semantics** (the concrete form of the contract's §2 "registry-generated `DEFAULT_PROGRESS` shape"):
  - `progress.topics` is a **sparse** jsonb map: `{ "<topic_id>": { "unlocked": bool, "currentLevel": int|null, "levels": { "1"|"2"|"3": { "flashcardsComplete": bool, "quizComplete": bool, "quizScore": int|null } } } }`. Absent keys mean defaults (locked / not complete); a fresh row is `'{}'` and stays valid. No RPC eagerly hydrates the full map; writes create only the keys they set.
  - A topic is **unlocked** iff its `topics_catalog.position = 0` (first registry topic — always unlocked) **or** `topics -> topic_id ->> 'unlocked' = 'true'`.
  - `flashcardsComplete` means "the card/reading portion of this level is done" (L1 flashcards; L2/L3 cards — B2 writes those levels). `quizComplete`/`quizScore` exist only on quiz-bearing levels (1 and 3 in P0).

## Interfaces exposed

**The two RPCs above**, plus three internal helpers other chunks build on. Helper signatures are **frozen by this spec** (D-012 §8); B2/B3/B5 call them and must not redefine them. `revoke execute … from public, anon, authenticated` on all three (they are server-internal; RPC bodies run as owner and are unaffected).

```sql
progress_snapshot(p_user uuid) returns jsonb
-- The contract §2 shape, exactly: total_xp, streak, streak_freezes,
-- last_login_date ('YYYY-MM-DD' or null), tz_offset_minutes, topics,
-- opinion_builders, schema_version, updated_at (ISO 8601). Built from the
-- caller's progress row; never includes id / streak_freeze_awarded_at /
-- imported_from_guest.

topic_unlocked(p_topics jsonb, p_topic_id text) returns boolean
-- The D-012 §1 predicate above. Assumes the topic exists in topics_catalog
-- (callers raise unknown_topic first).

xp_for(p_action text) returns int
-- SELECT from xp_awards; RAISES on a missing action (a missing action is an
-- integrity bug, never a silent 0).
```

**Grant-wall convention (applies to every function in this file, and every WS-B migration):** `revoke execute … from public;` then `grant execute … to authenticated;` (exactly the contract-listed audience). Without the revoke, Postgres's default PUBLIC execute would let anon reach the function body, contradicting the contract §6 note that the grant wall fires first.

**RPC behavior pins:**

- `complete_flashcards`: `level` must be a flashcard-bearing level per the content catalog — **P0: `1` only**; any other value → `invalid_params`. Checks in order: auth guard → param types → `unknown_topic` → `locked_topic` → replay check (`levels.'1'.flashcardsComplete` already true → return snapshot + `xp_awarded: 0`, **no writes**) → set the flag, `total_xp += xp_for('flashcards')`, `updated_at = now()`.
- `complete_quiz` grades **all** quiz levels (P0: 1 and 3; D-001 — there is no `complete_level3_quiz`). Checks in order: auth guard → `answers` is a non-null, non-empty int[] (else `invalid_params`) → `unknown_topic` → `locked_topic` → key lookup: no `quiz_answer_keys` row for (topic, level) → `invalid_params` (level outside the frozen domain for this topic) → `array_length(answers) ≠ array_length(key)` → `invalid_answers`; any element outside `0..3` → `invalid_answers` → grade `n_correct`.
- **Replay** (`quizComplete` already true): re-grade the submitted vector, return fresh `n_correct` with `xp_awarded: 0`, and write **nothing** — stored `quizScore` is never overwritten, no unlock re-fires. (Lost-ack retries send the same vector, so the fresh `n_correct` is identical; a deliberate re-take changes nothing server-side.)
- **First completion writes**, one transaction: `quizComplete = true`, `quizScore = n_correct`; XP = `xp_for('quiz')` + `xp_for('quiz_perfect_bonus')` if `n_correct` = key length. Level-transition parity with the legacy client (D-012 §1): level 1 → `currentLevel := 2`; level 3 → `currentLevel := 3` **and unlock the next topic** in `topics_catalog.position` order (`unlocked: true, currentLevel: 1` on that topic's entry; no-op if already unlocked or this is the last topic).
- **No per-question correctness vector is ever returned** (contract §4/B1) and no intra-topic *sequence* is enforced beyond the unlock check (quiz-before-flashcards is a UI concern; order can't change total mintable XP).

## Definition of done

- [ ] `0004` applies cleanly on `0001→0002→0003` from empty; full chain green in the migrations CI job
- [ ] Both RPCs match the frozen signature table exactly (names, param names/order/types, `returns jsonb`, grants) — checked against WS-B-signatures.md §5 at review
- [ ] All three helpers present, execute revoked; anon calling either RPC gets a **permission error** (grant wall), not a body error
- [ ] Replay of each RPC never re-awards (`xp_awarded: 0`, no row changes — asserted by comparing the full progress row before/after)
- [ ] L3-quiz completion unlocks exactly the next registry topic; last topic completes without error; replay does not re-unlock
- [ ] Snapshot returned by both RPCs validates against the contract §2 field list (integration test asserts key set + types, incl. `xp_awarded` present)
- [ ] Error codes raised via `raise exception using message = '<code>'` with no interpolated values in `message`; `detail` carries context, never user content
- [ ] `rpc-grading` CI job green; tests SKIP (exit 0) when Docker/psql absent, per the established convention

## Required tests (integration, `tests/lib/supabase-stack.mjs` + `content:seed`)

- Happy path both RPCs: flags set, XP correct (50 / 50+25 perfect), `n_correct` correct, snapshot shape valid
- Replay: flashcards ×2, quiz ×2 (same vector), quiz replay with a *different* vector (fresh `n_correct`, stored `quizScore` unchanged, 0 XP)
- Locked topic → `locked_topic`; unknown topic → `unknown_topic`; first registry topic callable with `topics = '{}'`
- `invalid_params`: `level` 2/0/99 on flashcards; quiz level with no key row; null/empty `answers`
- `invalid_answers`: wrong vector length; element = 4; element = −1
- Unlock chain: complete topic-1 L3 quiz → topic 2 unlocked, topic 3 still locked; `complete_flashcards` on topic 2 now succeeds
- Score bounds: `n_correct` ∈ [0, key length]; perfect bonus only at exactly key length
- Grant wall: anon call → permission denied (not `not_authenticated`)

## Out of scope (do not touch)

- `complete_level2` / `complete_level3_cards` / `check_streak` (B2, 0005) — including all streak logic
- OB, nuance, import, events, deletion RPCs (B3–B5)
- Any RLS policy or 0001–0003 edit; `quiz_answer_keys` **content** (H1 seeds it)
- Client code: io.js wrappers, zod schemas, screens (C2/D1)
- The `xp_awards` action list (frozen reference data, D-005 §2)

## Decisions log

Signatures are D-010/D-011 (FROZEN). This spec adds no signature changes. New pins it relies on are **D-012**: §1 (flag-map shape/sparse semantics, unlocked predicate, unlock-on-L3-quiz, `currentLevel` parity), §8 (helper trio lives in 0004, execute-revoke convention). A genuine conflict with the frozen contract is an escalation → decisions.md (next: D-013), never a silent edit.

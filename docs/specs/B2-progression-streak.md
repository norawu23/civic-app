# Chunk spec B2 — Progression + streak RPCs

**Workstream:** WS-B (RPC layer) · **Estimate:** 2 bd · **Review tier:** 1 (integrity — adversarial second pass; carries streak integrity per D-001)
**Issued:** 2026-07-08 (batch 2) · **Basis:** docs/specs/WS-B-signatures.md (FROZEN, D-010 + D-011); ARCHITECTURE.md v3.2 §3, §3.2; **D-001** (server-time streak, stored tz offset); BUILD_PLAN.md §3 B2; migrations 0001–0003 (merged); D-005 §2; **D-012** (batch-2 rulings)
**Start:** Mon Jul 13 (W2) · Depends on: **A1/A2/A3 merged**, **B1's 0004 helpers** (consume as frozen; if 0004 hasn't merged when you start local runs, vendor B1's spec-appendix helper SQL into a scratch migration — ship only calls) · Consumers: C2 (login bootstrap = `check_streak`), D* (streak UI reads `streak_event`/`freeze_awarded`)

## Objective

Implement `complete_level2`, `complete_level3_cards`, and `check_streak` in `0005_rpc_progression_streak.sql`. The first two are flag-only progression writes (they award **zero XP** — D-012 §2). `check_streak` is the integrity-critical one: server-time-only day boundary (D-001), tz-offset clamp-and-persist, and the full streak/freeze transition table — which the freeze deliberately left to this spec (the `streak_event` enum is frozen; its semantics are defined here).

## Migration ownership

**`supabase/migrations/0005_rpc_progression_streak.sql` — owned exclusively by B2 (D-005 §1).**

## In-scope files

- `supabase/migrations/0005_rpc_progression_streak.sql` (new)
- `tests/rpc/b2-progression-streak.test.mjs` (new)
- `tests/lib/supabase-stack.mjs` (**consume only**)
- `.github/workflows/ci.yml` (extend — a new `rpc-progression` job **only**)

## Interfaces consumed (frozen — do not redesign)

- **Signatures, verbatim from WS-B-signatures.md §4/B2:**
  - `complete_level2(topic_id text)` → S1 `{snapshot, xp_awarded}`. Grant: `authenticated`.
  - `complete_level3_cards(topic_id text)` → S1 `{snapshot, xp_awarded}`. Grant: `authenticated`.
  - `check_streak(tz_offset_minutes int)` → S1 `{snapshot, xp_awarded: 0, streak_event, freeze_awarded: boolean}`. Grant: `authenticated`.
  - `streak_event ∈ {'started','same_day','extended','freeze_spent','reset'}` — frozen enum; transition semantics below.
- Contract §1 conventions (SECURITY DEFINER, search_path pin, jsonb returns, grant wall incl. PUBLIC revoke), §2 snapshot, §6 errors (`not_authenticated`, `invalid_params`, `unknown_topic`, `locked_topic`; **out-of-range `tz_offset_minutes` is NOT an error — clamp, per contract §6 "Not errors"**).
- B1's 0004 helpers (frozen): `progress_snapshot(uuid)`, `topic_unlocked(jsonb, text)`, `xp_for(text)`.
- **D-001:** user-local date derives from server `now()` + the stored/clamped offset. The device clock is never an input. Replaying/shifting offsets must never resurrect a lapsed day.
- **D-012 §1 flag-map semantics** (sparse map, unlocked predicate — see B1's spec for the full transcription). **D-012 §3 offset sign convention:** the stored value and the param mean **minutes east of UTC** (`local = UTC + offset`; India = +330, US-Pacific in July = −420). C2 derives it as `-new Date().getTimezoneOffset()`. Your date math must use this convention: `user_local_today = ((now() at time zone 'utc') + make_interval(mins => v_offset))::date` — computed explicitly in UTC so the session TimeZone setting can never matter.
- **D-012 §2:** `xp_awards` has **no action rows** for L2/L3-cards completions — confirmed complete at A1 review (D-005 §2) and matching the legacy client (its XP table carries only flashcards/quiz/bonus/OB values). Both progression RPCs therefore return `xp_awarded: 0` on every call, first completion included. Do not add `xp_awards` rows.

## Interfaces exposed

**`complete_level2` / `complete_level3_cards`:** auth guard → `unknown_topic` → `locked_topic` → set `topics.<t>.levels.'2'.flashcardsComplete = true` (L2) / `levels.'3'.flashcardsComplete = true` (L3 cards), creating keys as needed (sparse writes; D-012 §1: `flashcardsComplete` = "card/reading portion done" on every level). `currentLevel` is **not** touched (legacy-parity: only quiz completions move it — B1). Idempotent: flag already true → snapshot + `xp_awarded: 0`, no writes. `updated_at = now()` on real writes.

**`check_streak(tz_offset_minutes)` — the transition table (normative):**

On **every** call, first: `v_offset := clamp(tz_offset_minutes, -840, 840)` (out-of-range never errors); persist `tz_offset_minutes := v_offset`; compute `today` per the D-012 §3 formula above. Let `last` = stored `last_login_date`, `gap` = `today - last` in days. Exactly one row applies:

| # | Condition | Writes (beyond offset + `updated_at`) | `streak_event` | `freeze_awarded` |
|---|---|---|---|---|
| 1 | `last IS NULL` | `streak := 1`, `last_login_date := today` | `started` | `false` |
| 2 | `gap <= 0` (same local day, **or** an offset shift moved `today` backwards) | none — never decrement, never move `last_login_date` backwards | `same_day` | `false` |
| 3 | `gap = 1` | `streak := streak + 1`, `last_login_date := today` | `extended` | milestone rule |
| 4 | `gap = 2 AND streak_freezes = 1` | `streak_freezes := 0`, `streak := streak + 1`, `last_login_date := today` (the freeze covers exactly the one missed day) | `freeze_spent` | milestone rule |
| 5 | anything else (`gap ≥ 2` uncovered) | `streak := 1`, `last_login_date := today` — an unspent freeze is **kept**, not consumed (it can't cover ≥ 2 missed days) | `reset` | `false` |

**Milestone rule** (evaluated after the row-3/4 increment): if the new `streak` is a multiple of 7 **and** `streak_freezes = 0` (post-spend) **and** (`streak_freeze_awarded_at IS NULL` **or** `streak_freeze_awarded_at <= today - 28`) → `streak_freezes := 1`, `streak_freeze_awarded_at := today`, return `freeze_awarded: true`. The 28-day comparison is this spec's operationalization of §3.2's "1 month" cap (calendar-month arithmetic is ambiguous across month lengths; 28 is the strictest consistent reading). Note `freeze_spent` + `freeze_awarded: true` **can co-occur** (spend drops `streak_freezes` to 0; the incremented streak may hit a multiple of 7) — this is correct, test it.

`xp_awarded` is constantly `0` (streaks award no XP; the field exists so C2 keeps one S1 zod schema — D-011). The returned snapshot reflects all writes, so `check_streak` doubles as the login bootstrap read (D-008 §4).

**Why row 2 is the security-load-bearing line (adversarial reviewers start here):** the maximum offset swing is ±840 min ≈ a 28 h window around server-now. Because `last_login_date` is stored and never moves backwards, and `gap <= 0` is a no-op, no offset choreography can (a) revive a lapsed day, (b) extend twice for the same user-local date, or (c) farm freezes faster than real days pass — the exploit ceiling is choosing *when* within the window one's day ticks over, which D-001 explicitly accepts (same power as a traveler).

## Definition of done

- [ ] `0005` applies cleanly on 0001→0004 from empty; full-chain migrations job green
- [ ] All three RPCs match the frozen signature table exactly (names, params, `returns jsonb`, `authenticated` grant + PUBLIC revoke)
- [ ] Transition table implemented exactly as written; every row + the milestone rule covered by a test
- [ ] Offset is clamped and persisted on **every** call (incl. `same_day` no-ops) — asserted by reading the column back
- [ ] Offset-manipulation cannot resurrect a lapsed day or double-extend (the D-001 test battery below)
- [ ] Both progression RPCs: flag-only, idempotent, `xp_awarded: 0` always, `total_xp` never changes
- [ ] `xp_awarded: 0` and both addendum fields present on every `check_streak` return
- [ ] `rpc-progression` CI job green; SKIP-not-fail without Docker

## Required tests (integration; manipulate `last_login_date`/`streak_freeze_awarded_at` directly via psql to simulate days — never sleep)

- Rows 1–5 each: fresh user → `started`; second call same day → `same_day` (no writes); next-day → `extended`; one-day miss with freeze → `freeze_spent` (freezes 0, streak +1); one-day miss without freeze → `reset`; two-day miss with freeze → `reset` **and freeze retained**
- Milestone: streak 6 → 7 awards (`freeze_awarded: true`, `awarded_at` set); streak 13 → 14 with `awarded_at` 10 days ago → **no** award (28-day cap); with `awarded_at` 30 days ago → awards; already holding a freeze at a multiple of 7 → no award; `freeze_spent` landing on a multiple of 7 with stale `awarded_at` → both `freeze_spent` and `freeze_awarded: true`
- **D-001 adversarial battery:** extend at offset +840, immediately re-call at −840 (local date moves back) → `same_day`, nothing changes; call at −840 then +840 within one server-day where that crosses one boundary → at most one `extended` per user-local date; lapsed day (gap 2, no freeze) cannot be turned into `extended` by any offset in ±840; offset 841 / −10000 / 0 → clamped values persisted, no error
- Sign convention: offset +330 vs −420 produce the correct user-local dates around a UTC midnight boundary (fixture with server now near 00:30 UTC)
- Progression RPCs: happy path (flag set, XP 0), replay (no writes), `unknown_topic`, `locked_topic`, grant wall (anon → permission denied)
- L2 and L3-cards flags land on the correct level keys and coexist with B1-written L1/L3-quiz flags without clobbering (jsonb deep-merge check)

## Out of scope (do not touch)

- `complete_quiz` and the next-topic unlock (B1, 0004 — L3 *quiz* grades there per D-001)
- Any XP award or `xp_awards` row (D-012 §2: these RPCs award nothing)
- The client offset refresh (C2 owns calling `check_streak` on app load) and all streak UI
- Streak-freeze *purchase/UI* semantics (P1-8 is a named post-freeze amendment — not yours)
- 0001–0004 and 0006–0008; RLS policies

## Decisions log

Signatures are D-010/D-011 (FROZEN; the `tz_offset_minutes` param and `freeze_awarded` field are recorded amendments). This spec's transition table is the contract-anticipated completion of the frozen enum. New pins: **D-012** §2 (zero XP for L2/L3-cards), §3 (offset sign convention, C2 mirror). The 28-day month operationalization is spec-level. Conflicts → escalate (D-013+), never edit.

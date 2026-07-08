# Chunk spec F1 — Age gate

**Workstream:** WS-F (trust & legal) · **Estimate:** 2 bd · **Review tier:** 1 (integrity — adversarial second pass; `[m-4]`-class safety chunk)
**Issued:** 2026-07-11 (batch 1b) · **Basis:** ARCHITECTURE.md v3.2 §8.1 (age gate before ALL capture), §2.1.5 (legacy-NULL re-prompt), §2.3 (birth_year settable only while NULL); BUILD_PLAN.md §3 F1 + cross-dependency sheet; **D-008 §2** (the `< 14` threshold F1 must mirror); `[r4]`, `[r8]`
**Start:** W3–W4 · Depends on: **A2 merged** (server backstop + the shared threshold), **A3 merged** (birth_year-while-NULL UPDATE policy), **B5** (`delete_account` — merge after it or stub behind a flag), **D3** (age-gate insertion point — adjacent merge window). Blocks: **E2** (baseline capture must sit behind the gate).

## Objective

Put a neutral birth-year screen ahead of **all** server-side capture — guest baseline (E2) and account signup alike — that blocks under-14 users app-wide, persists the block across reloads, transmits/stores **no** birth year for guests, and re-prompts legacy accounts whose `profiles.birth_year IS NULL`. The client threshold is the single source that must provably match A2's server gate (D-008 §2), so a user who passes the client gate is never rejected server-side.

## In-scope files

- `src/lib/ageGate.js` (new — **the one definition** of the threshold + pure helpers; A2's SQL is the server twin, proven equal by shared boundary fixtures)
- `src/lib/ageGate.test.js` (new — unit + the A2-mirror boundary table)
- `src/screens/AgeGateScreen.jsx` (new — neutral year input + friendly block state)
- `src/screens/AgeGateScreen.test.jsx` (new — RTL smoke: input, pass, block)
- Boot/welcome wiring: integrate at **D3's age-gate insertion point** if D3 has merged; otherwise gate the existing `App.jsx` welcome flow (the seam, not a rewrite of routing — routing is D3's)
- Legacy re-prompt: the post-login `birth_year IS NULL` check + prompt (lives with the auth/boot flow; F1 owns the gate logic, not the `useAuth` rebuild)
- `tests/e2e/age-gate.spec.*` (new — Playwright: no guest birth year on the wire; block survives reload) — guarded/self-skipping like the other E2E specs until the Playwright harness lands

## Interfaces consumed (frozen — do not redesign)

- **D-008 §2 threshold:** underage `⇔ current_year − birth_year < 14`. **A2's trigger uses the identical arithmetic** (`extract(year from now())::int - birth_year < 14`); F1's `ageGate.js` is the client mirror. This equality is the load-bearing safety property — it is tested, not assumed (see Required tests).
- **A2 signup metadata contract:** the account path forwards the collected year as `supabase.auth.signUp({ …, options: { data: { username, birth_year } } })`; A2's trigger stores it. (The `signUp` wrapper itself is C2's `useAuth` rebuild — F1 supplies the validated `birth_year` value and the guarantee it reaches `options.data`, it does not re-own the auth hook.)
- **A3 policy:** setting a legacy account's birth year is a direct `profiles` UPDATE (`update({ birth_year }).eq('id', uid)`), permitted by A3's own-row UPDATE policy + column trigger **only while the column is NULL**. F1 relies on that; it never needs elevated writes.
- **B5 `rpc.delete_account()`** for the `[r8]` under-14-on-re-prompt path. Per the cross-dependency sheet, F1 merges after B5 **or** calls it behind a feature flag that flips on when B5 lands.

## Interfaces exposed (frozen after merge; ratified in the Jul 10 freeze)

- **`ageGate.js`:** `failsAgeGate(birthYear, now = new Date())` → boolean (`now` injectable for tests, never hardcode 2026); `MIN_AGE_BY_YEAR = 14`. No other module hardcodes the number.
- **Persistence — one key, outcome-only:** `localStorage['civic_age_gate']` ∈ `{'passed','blocked'}`. `'passed'` records only the **gate outcome**, never the year (§8.1: a guest "leaves no age record, only the gate outcome"). `'blocked'` is the device-persistent block (`[r4]`). This key is **separate** from C1's `civic_progress` envelope, so clearing guest progress never clears the block. Boot order: `blocked` → block screen; `passed` → proceed; absent → AgeGateScreen.
- **Session-only year:** the validated year is held in memory (React state/context) for the current session so the account path can pass it to `signUp` without re-prompting; it is **never** written to localStorage or the guest envelope, and is discarded on the guest path.
- **Block copy is age-honest:** the message states "CIVIC is for people 14 and up" (the gate blocks under-14 by year, so it must not claim "13") — friendly, non-accusatory, no field to retry into (§8.1 "friendly message; the attempt is not stored").

## Definition of done

- [ ] AgeGateScreen renders before any capture on a fresh client (no `civic_age_gate` key): guest baseline (E2) and signup are both unreachable until the gate passes
- [ ] Under-14 year → block screen; `civic_age_gate='blocked'` written; **the year itself is never stored** (assert localStorage + envelope contain no birth year)
- [ ] Block **survives a full reload** (`[r4]`): reopening the app on a `blocked` device shows the block screen without re-prompting
- [ ] Guest pass → `civic_age_gate='passed'`, year discarded; **E2E proves no outbound network request carries the guest birth year** (the headline `[r4]`/§8.1 assertion — intercept all requests, assert none contains the year)
- [ ] Account pass → the in-session year reaches `signUp` as `options.data.birth_year`; A2's trigger stores it (integration-verified against the merged trigger)
- [ ] Legacy re-prompt: a signed-in user with `profiles.birth_year IS NULL` is prompted at next login before the app proceeds (§2.1.5); a ≥14 answer sets `birth_year` via the A3-permitted UPDATE and proceeds
- [ ] `[r8]` under-14 on re-prompt → calls `rpc.delete_account()` (or the feature-flagged stub if B5 not yet merged), signs the user out, and lands on the block screen — account + data deleted, not merely blocked
- [ ] `failsAgeGate` is the only place the threshold lives; no duplicate `14`/`13` literal in screens or wiring

## Required tests

- **A2-mirror boundary table (the safety-critical unit test):** the exact birth-year boundary cases A2's under-13 trigger test uses — e.g. `{current−13 → fails, current−14 → passes, current−15 → passes}` with a fixed injected `now` — produce the identical verdict in `failsAgeGate`. Any future drift between the SQL and JS thresholds reddens here.
- Unit: `failsAgeGate` across the boundary, plus NULL/blank/non-numeric/out-of-range (1900–2100) year inputs
- RTL smoke: AgeGateScreen input → pass path and block path render correctly
- E2E (Playwright, guarded): (a) no guest birth year on any request; (b) block persists across reload
- Integration: account-path year reaches the merged A2 trigger and lands on `profiles.birth_year`
- Legacy re-prompt: NULL → ≥14 sets the column; NULL → under-14 triggers the deletion path (stub asserted if B5 flag off)

## Out of scope (do not touch)

- The `useAuth`/`useProgress` rebuild and the `signUp` wrapper internals (C2) — F1 supplies the value + guarantee, not the hook
- The route reducer / app shell (D3 owns routing and the insertion *slot*; F1 fills it)
- The baseline quiz UI and its copy (E2) — F1 only guarantees the gate precedes it
- Server-side birth-year handling (A2 trigger, A3 column trigger) — merged; F1 consumes, never edits
- `delete_account` itself (B5) — F1 calls it, does not implement it
- Privacy/terms copy (F2)

## Decisions log

F1 carries **D-008 §2** as a hard constraint: its client threshold is the mirror of A2's server gate (`< 14`), proven by the shared boundary table above. No new rulings are introduced by this chunk; any change to the threshold is a decisions.md event touching both A2 and F1 (and their shared fixtures) together.

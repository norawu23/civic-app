# CIVIC — Operator Decision Log

Interface changes and ambiguity rulings, per BUILD_PLAN §1 escalation protocol.

---

## D-001 — Streak day-boundary: server time + stored timezone offset (2026-07-06)

**Context:** ARCHITECTURE v3 §3.2 hardened `check_streak` to server time (device clocks untrusted). BUILD_PLAN v1 chunk B2 deviated — client-supplied local date with a ±1-day server clamp — without invoking this log. Audit 004 (P-2) correctly flagged the clamp as gameable: a user who missed a day can perpetually claim the boundary day.

**Decision:** `check_streak` uses **server time exclusively**. User-local midnight is derived from a `tz_offset_minutes` value stored on `progress`, refreshed on every app load from the client (clamped to ±14 h). The server computes the user-local date as `now() + tz_offset` — the device clock is never an input.

**Gaming analysis:** manipulating the offset shifts a user's date boundary by at most ±14 h *relative to server now*. Because the server clock is monotonic and the last-credited local date is stored, replaying or shifting offsets cannot resurrect a day that has already lapsed — the maximum exploit is choosing *when* within a ~28 h window one's day ticks over, which is the same power a legitimate traveler has. Accepted.

**Also resolved:** `complete_level3_quiz` is removed from B2 — the authoritative interface grades all levels through `complete_quiz(topic_id, level, answers)` per ARCHITECTURE §3. B2 is added to the adversarial-review set (it carries streak integrity).

**Architecture impact:** amendment note added to ARCHITECTURE.md (v3.1).

---

## D-002 — Legacy-client coexistence window during prod repair (2026-07-06)

**Context:** `repair_prod.sql` (week 2) moves the live DB to the v3 schema + RPC-only RLS while the currently deployed Vercel client still does direct `progress` upserts and `evolved_takes` inserts. Those writes will fail — silently, given the legacy error handling — until the new client deploys at P1-1 (audit 005, m-6).

**Decision:** **Accepted.** Cloud saves for signed-in users on the legacy client are knowingly broken from the week-2 repair until the P1-1 deploy (~Jul 14 → ~Aug 11). Rationale: the current registered-user population is a handful of internal/test accounts; no external users exist before the Sept 1 launch; guest localStorage persistence is unaffected. A static "maintenance — progress syncing paused" banner is deployed to the legacy client on repair day (one-line change, no data-layer work) so the window is disclosed rather than silent.

**Revisit if:** any real external user signs up before P1-1 — then the repair is re-timed to land with the new client instead.

**Amendment (audit 006, Q-3):** the window also degrades **signup** on the legacy client — after the repair, A2's server trigger creates the profile/progress rows, then the legacy client's own direct inserts fail against RPC-only RLS and its code throws, so a new signup shows an error despite the account existing. Accepted under the same rationale; this is precisely the symptom the revisit trigger watches for.

---

## D-003 — Privacy page discloses the error-reporting processor (2026-07-06)

**Context:** ARCHITECTURE §8.2 listed "no third parties" among privacy-page contents. Audit 005 (m-5) established that Sentry is a third-party processor receiving error payloads from a minors' opinion app; plan chunk G3 now scrubs PII/content with a tested `beforeSend`, and F2 discloses the processor. Audit 006 (Q-2) flagged the resulting plan/architecture divergence.

**Decision:** the privacy page's claim becomes: no user data is sold or shared for marketing; **one third-party processor (Sentry) receives error reports, scrubbed of personal information and user-written content before transmission** (enforced + tested in G3). ARCHITECTURE §8.2 amended (v3.2).

---

## D-004 — Content track re-scoped to review/refresh; pre-named second descope (2026-07-06)

**Context:** an independent blind comparison review (fresh model instance, no authorship context; step 5 of the planning process) verified programmatically that **all five topic JSONs in `src/data/` are complete** — the plan's H2–H5 authoring premise was inherited from PRODUCT.md, which is wrong on this point (and on target audience). The review also identified server-side L1-quiz grading as the one integrity investment the code evidence doesn't justify at this scale, and found a tier-compliance violation in existing content (FactCheck.org cited; on neither source tier).

**Decision:**
1. H2–H5 become review/refresh chunks (schema validation, source-tier compliance incl. the FactCheck.org replacement, L3 currency pass): 1 bd each. WS-H 10 → 6 bd; P0 52 → 48 bd (~36% slack). Recovered days are banked, not reallocated — operator bandwidth remains the binding constraint and is unchanged by this decision.
2. The Aug 1 go/no-go gains a pre-named *second* descope: server-side L1 grading reverts to client-written lesson progress behind own-row RLS (corrected migration + deny tests retained). The never-cut list is unchanged and restated.
3. PRODUCT.md is left as-is per the owner's instruction, but is flagged: **not a reliable planning input** (content status, target audience, and bonus-threshold claims are contradicted by the repo and spec).

**Provenance note:** this amendment originates from the blind review, not the audit loop — recorded here because post-hardening plan changes must pass through the decision log (BUILD_PLAN §1).

---

## D-005 — Batch-1a interface rulings (2026-07-06)

**Context:** issuing the batch-1a chunk specs (A1, C1, E1, H1 — docs/specs/) required four interface decisions the plan and architecture left open. Ratified by the owner 2026-07-06 on the operator's recommendation; recorded here per BUILD_PLAN §1 ("all interface decisions logged").

**Decisions:**

1. **Migration file ownership.** `0001_schema.sql` (A1) contains all P0 tables + constraints + indexes, with RLS **enabled on every table and zero policies** (default-deny from the first migration). `0002_*` is reserved for A2 (auth trigger + `username_available`), `0003_*` for A3 (policies + column-restriction trigger); each later chunk appends its own numbered migration. P1 tables (`level3_content`, `level3_quiz`, `push_subscriptions`) ship with their P1 features, not in 0001. Rationale: clean per-chunk file ownership (no two builders in one migration file) and a deny-all default so a schema-only deploy can never leak.

2. **`xp_awards` seeded in 0001** as reference data, values carried from the current client's XP table (`flashcards 50`, `quiz 50`, `quiz_perfect_bonus 25`, `opinion_builder 100`, `opinion_builder_bonus 200`). The complete action list is confirmed at A1 review against the RPC set — any action an RPC awards that is missing from the seed is an A1 review finding, not a later hotfix.

3. **Unlock-order registry extracted to `src/data/registry.js`** (H1). Single ordered list of topic ids; `topics_catalog.position` seeds from it (per ARCHITECTURE §5.8 "content + one registry line"). C2 consumes the same registry when it generates `DEFAULT_PROGRESS`; the constant leaves `useProgress.js` in H1's chunk so the content pipeline never depends on a hook file scheduled for demolition.

4. **E1 trigram threshold set by proposal-and-ratify.** The E1 builder proposes a concrete near-duplicate threshold with boundary fixtures on both sides; the operator ratifies the number during the Jul 11–12 hand-scoring session; B4 implements the identical threshold in SQL (`pg_trgm`). The ratified value becomes part of the frozen rubric — changing it post-freeze is a decisions.md event.

**Architecture impact:** none — all four operate below the level of ARCHITECTURE §2/§3 interfaces. The Jul 10 freeze ratification incorporates 1–3; 4 lands with the rubric on Jul 13.

---

## D-006 — Real prod schema differs from all assumptions; repair authored + rehearsed (2026-07-07)

**Context:** the owner supplied the live prod connection string; the operator took a read-only schema-only `pg_dump` (prod is Postgres **17.6**). Live prod does **not** match `001_init.sql` (the stale repo migration) **nor** the A1 builder's `repair_prod.sql` skeleton, which was authored against that stale file. This is the single most important finding of the A1 chunk and validates BUILD_PLAN §2.1's insistence on deriving the repair from a live dump, not from the repo.

**Actual prod state (public schema):**
- `profiles` — 5 rows (internal/test accounts). Already has `avatar_id int` (NOT the emoji `avatar text` the skeleton assumed). Columns nullable, no length/range checks, no `birth_year`, no `needs_profile_completion`.
- `progress` — **0 rows**. Already `id = auth.users` PK (no surrogate key, no `progress_data` jsonb blob the skeleton assumed). `last_login_date` is `text`. Missing six v3 columns incl. `tz_offset_minutes`.
- `evolved_takes` — **0 rows**. `id` is `uuid` (target: `bigint identity`); missing `is_custom`/`is_imported`.
- 11 legacy direct-write RLS policies. Missing entirely: `nuance_sessions`, `xp_awards`, `quiz_answer_keys`, `topics_catalog`, `events`.

**Decision:**
1. `repair_prod.sql` re-authored by the operator from the real dump. Strategy: drop+recreate all three legacy tables (profiles' 5 rows preserved via backup+reinsert — recreation is required to match 0001's column *order*, which ALTER cannot achieve); create the 5 missing tables + `xp_awards` seed + indexes. Legacy policies fall with their tables → 0001's zero-policy default-deny (the D-002 legacy-write break, by design).
2. **Rehearsed locally to the empty-diff gate:** real prod dump → apply repair → `pg_dump` diff vs a fresh 0001 shadow = **empty** (exit-criterion 3 satisfied in rehearsal; re-run against real prod in week 2).
3. **Overlength-username repair (flagged, owner to ratify):** one of the 5 accounts has a 21-char username (an email address), violating 0001's 3–20 check. The repair rewrites any such username to the email local-part where it fits (identity-preserving) else a deterministic `user_<id-prefix>` placeholder, and sets `needs_profile_completion=true`. The specific account identity is **deliberately kept out of version control** (it is real user PII); it was surfaced to the owner directly in-session for ratification. If it is a real beta tester whose display name matters, the owner may contact them or choose a different handle before the week-2 run.

**Security note:** the prod DB password was shared in-session and should be **rotated** (Supabase dashboard → Database → Reset password) after week-2 repair. Only read-only `--schema-only` operations were performed against prod; no writes.

**Provenance:** operator finding during A1 completion; the repair executes against prod only in week 2 per BUILD_PLAN §3a (backup first).

---

## D-007 — Content-lint CI gating is deadline-based, not immediate (2026-07-07)

**Context:** H1's `content:lint` correctly ERRORS on `factcheck.org` (the known D-004 source-tier violation). The H1 builder wired the `content` CI job to red immediately on that error. But factcheck.org is not replaced until H2 (Taxes) and H5 (Climate Change) run their compliance passes across weeks 1–4 — so an immediately-red content job would violate "all red = no merge" (§2) and **block every other chunk's merge (C2, D*, B*, …) for ~3 weeks**.

**Decision (operator, CI-gating policy):** the `content` job's lint step is advisory (`continue-on-error`), and the job only REDS on lint errors **on or after a content-compliance deadline of 2026-07-31** (end of week 4, matching the H2–H5 cadence). Before the deadline the violation is emitted as a loud GitHub `::warning::` annotation but is non-blocking. This is the same forcing-function pattern as E1's provisional-fixture gate: visible now, hard-failing at the deadline. Implemented purely in `.github/workflows/ci.yml` (env `CONTENT_COMPLIANCE_DEADLINE`); H1's linter is unchanged (its detection is correct — `npm run content:lint` still exits 1 locally, which is the right signal for a human).

**Consequence for the H-track:** H2 and H5 MUST remove every factcheck.org citation (replacing with tier-1/2 sources) before 2026-07-31, or CI turns red and blocks merges from that date. This deadline is now a hard H-track constraint, not just a review nicety.

---

## D-008 — Batch-1b interface rulings (A2 auth trigger + A3 RLS) (2026-07-07)

**Context:** authoring the A2 (`0002_auth.sql`) and A3 (`0003_policies.sql`) chunk specs (docs/specs/) required five interface decisions the architecture and plan left open. Recorded per BUILD_PLAN §1 ("all interface decisions logged"); these signatures are incorporated into the **Fri Jul 10 interface freeze**. Ratified by the owner 2026-07-07 on the operator's recommendation, ahead of the freeze.

**Decisions:**

1. **`username_available` is case-sensitive (exact match).** The pre-flight RPC uses the identical comparison as `0001`'s plain-text `username UNIQUE` index — case-variant handles (`Nora`/`nora`) may coexist, and a "yes" from pre-flight can never then collide in the trigger. Rationale: username is not a login credential (login is email+password), so case-collision impersonation is a low concern at this scale, and case-insensitive uniqueness would require reopening the merged `0001` index (a `lower(username)` unique index) — not justified. citext / case-folding is an explicit non-goal.

2. **Under-13 gate uses the 14-target rule `current_year − birth_year < 14` (blocks under-14 by year), NOT the spec's original `< 13`.** Because §8.1 collects birth **year only**, the gate must round to a year boundary; `< 13` would admit the sliver of actual-12-year-olds born late in the boundary year (born `current_year − 13`, birthday not yet passed) — precisely the under-13 data §8.1 forbids storing. `< 14` **guarantees zero under-13 storage** despite year-granularity and matches the stated 14–18 audience; its only cost is turning away genuine 13-year-olds, who are below target. The architecture's "standard 13+ posture" language is the legal *floor*, not a mandate to set the gate exactly at 13. **F1's client age gate MUST mirror this exact expression** so a user never passes the client gate then gets rejected server-side. (A2 spec amended `< 13` → `< 14`.)

3. **Placeholder username format = `left('user_' || replace(id::text,'-',''), 20)`** for trigger-fallback accounts (collision / missing metadata). Deterministic, effectively unique (60 bits of UUID), fits the 3–20 CHECK exactly (5 + 15), and is consistent with the `user_<id-prefix>` convention D-006 already chose for the overlength-username prod repair. D3's profile-completion screen prompts replacement.

4. **`xp_awards`, `quiz_answer_keys`, `topics_catalog` remain default-deny (no client SELECT policy).** `quiz_answer_keys` is non-negotiable (grading secret, §3.1). `xp_awards` and `topics_catalog` are denied because the client never needs a direct read — XP display comes from the RPC-returned progress snapshot (§3), and unlock order comes from `src/data/registry.js` (D-005 §3) + content JSON. Keeps the client's DB read surface minimal (own profiles/progress/evolved_takes/nuance_sessions + admin-all + RPC returns). Reversible in a one-line future migration if a screen ever needs a direct read.

5. **`needs_profile_completion` is cleared solely by A3's `BEFORE UPDATE` column-restriction trigger, on the first username change while the flag is set** — `if OLD.needs_profile_completion and NEW.username <> OLD.username then NEW.needs_profile_completion := false`. No dedicated `complete_profile` RPC (not in the §3 list), and the flag is never directly client-writable (preserving A3's column-restriction guarantee). The rule deliberately does **not** pattern-match the `user_%` placeholder, so a user who legitimately picks a `user_`-prefixed name still gets un-flagged. (A3 spec amended to this wording.)

**Architecture impact:** none — all five operate below the level of ARCHITECTURE §2/§3 interfaces. A2 and A3 are Tier-1 adversarial-review chunks (W2); the adversarial pass re-checks decisions 2 (age arithmetic + F1 mirror) and 5 (flag can't be flipped to escalate) specifically. Cross-chunk consumers: **F1** (decision 2 formula mirror — a hard constraint on F1's DoD), **D3** (decisions 3 + 5, profile-completion screen), **C2/io.js** (decision 4, read surface).

---

## D-009 — A2/A3 adversarial-review rulings + merge (2026-07-08)

**Context:** A2 (`0002_auth.sql`) and A3 (`0003_policies.sql`) went through their Tier-1 adversarial second pass (independent Opus reviewers, no spec-authorship context, reproduced against a real Postgres 15). A3 passed all nine charter items with zero confirmed holes. A2 passed the core properties but the review surfaced one fail-open that had to be fixed before merge. Both chunks merged to `main` 2026-07-08 (A2 = 0002 first, then A3 = 0003; the `ci.yml` `auth`+`rls` job-append conflict was hand-resolved to keep both jobs). Full `0001→0002→0003` chain verified applying-from-empty + a combined trigger/RLS smoke (cross-user deny, escalation pin, RPC-only progress write, anon lockout).

**Decisions / changes ratified at merge:**

1. **Under-13 gate is FAIL-CLOSED on a present-but-unparseable `birth_year` (A2 review F1).** The original trigger swallowed any non-integer year (`"2013.5"`, `"2013abc"`, `"0x7DD"`, `"2_013"`, a JSON boolean) to NULL via `exception when others`, which **skipped the under-13 gate and created the account** — a fail-open on the §8.1 child-safety control. Ruling: a `birth_year` that is present and non-empty but does not cast to `int` now `RAISE`s and aborts the signup (nothing persists); only a genuinely absent/empty year proceeds as NULL. **Refines the D-008 §2 signup-metadata contract: F1's client gate must send a clean integer birth_year (or omit it) — a non-integer is now server-rejected, not silently accepted.** Out-of-range-but-integer years (e.g. `"31"`) keep the spec's documented degrade-to-NULL behavior (they still clear the age gate arithmetically, then fail the 1900–2100 CHECK sanitize) — unchanged.

2. **Whitespace-only username → fallback/placeholder (A2 review F3).** A `username` that is empty after `trim()` (e.g. `"   "`) is treated as blank and routed to the placeholder + `needs_profile_completion=true` path, not stored verbatim. Non-empty usernames are **not** otherwise trimmed or normalized — the D-008 §1 freeze is case-sensitive *exact* match, so `" alice "` stays distinct from `"alice"` and `username_available` stays byte-exact. Only the empty-after-trim case changed.

3. **Placeholder-collision retry (A2 review F2, robustness).** The fallback placeholder derives from only the first 15 hex of the id (60 bits); a pre-squatted matching placeholder could collide on the `username` UNIQUE index and — before the fix — propagate an uncaught `unique_violation`, stranding the auth row (violating [r3]/[N7]). The fallback insert is now wrapped in an `exception when unique_violation` retry with fresh `gen_random_uuid()` entropy. Negligible probability, but restores the "never strand an auth row" guarantee unconditionally.

4. **`restrict_profile_update()` trigger `search_path` pinned to `''` (A3 review nit).** Non-exploitable (SECURITY INVOKER, pure NEW/OLD field assignment, no schema-qualified lookups) but pinned for consistency with `is_admin()` and defense-in-depth on the privilege-escalation wall.

**Architecture impact:** none — all four operate below the §2/§3 interface level. Cross-chunk consumer note: **F1** must honor decision 1 (send a clean integer or omit `birth_year`; mirror the `< 14` expression from D-008 §2). Both migrations are now on `main`; the merge was local only (not pushed).

---

## D-010 — WS-B signature freeze: return contract, error convention, amendments (2026-07-08)

**Context:** authoring the WS-B RPC signature contract (`docs/specs/WS-B-signatures.md`) for the **Fri Jul 10 interface freeze**, per the batch-2 freeze brief. ARCHITECTURE §3 froze names and (mostly) params but hand-waved every return as "the updated progress snapshot" and defined no error convention. This entry records what the contract freezes and the two places it deliberately amends §3.

**Decisions:**

1. **Frozen return contract.** One canonical `progress_snapshot` type (the client-relevant `0001.progress` columns: `total_xp, streak, streak_freezes, last_login_date, tz_offset_minutes, topics, opinion_builders, schema_version, updated_at` — excluding `id`, internal `streak_freeze_awarded_at`, and analytics-only `imported_from_guest`), defined once in `io.js` zod and returned by every progress-writing RPC inside a uniform envelope `{snapshot, xp_awarded, ...addendum}`. Idempotency is observable: a replay succeeds with `xp_awarded: 0`, never errors. `complete_quiz` adds `n_correct` only — **no per-question correctness echo** (protects the §3.1 grading path). `check_streak` adds `streak_event ∈ {started, same_day, extended, freeze_spent, reset}` and doubles as the login bootstrap read (D-008 §4). Explicit shapes over nulls throughout (acks, `{n, gated: true}`).

2. **Nuance-silent, structurally.** RATIFIED by owner 2026-07-08: **no score is shown after the nuance questionnaire** — all three nuance RPCs return `{accepted: true}` and nothing else, so the score has no client-facing return path to regress through. Rationale: zero-reward framing (§5.1.3/N6); a visible score invites gaming and pollutes the 30-day delta. Scores are readable solely via G2 admin views.

3. **`get_ob_comparison` → B3.** In §3's list but assigned to no chunk; folded into B3 (complete + compare are one feature — bars render on OB completion, §5.2). Return frozen as `{n, gated: true}` under n<10, else `{n, gated: false, cold: {yes, no}, evolved: [{take, count}], custom_count}` — counts not percentages, custom-take text never returned. B3 grows slightly; accepted.

4. **Error convention (the §3 gap).** RPC failure = Postgres exception: `raise exception using message = '<snake_case_code>', detail = '<human context>'`. The `message` is exactly one token from the frozen 16-code registry in the contract §6; `io.js` maps it via one zod enum (unknown → `internal`); screens consume typed errors only. Success bodies never carry an `error` key; `detail` never carries user-written content. Registry additions are decisions.md events.

5. **AMENDMENT — `check_streak(tz_offset_minutes int)`** (§3 had zero params). D-001 requires the stored offset to be "refreshed on every app load," but A3's RLS leaves no direct write path to `progress`, and the streak day-boundary must be evaluated against the *fresh* offset, not a stale one. The offset therefore rides the streak check itself: clamped server-side to ±840, persisted, then the user-local date is derived from server `now()`. Closes an interface gap the zero-param signature could not satisfy.

6. **AMENDMENT — `submit_nuance_session.kind ∈ {'baseline','day30'}`**, not the freeze brief's three-value set including `'session'`. The merged `0001` CHECK admits exactly two values, the `unique (user_id, anon_id, kind)` constraint structurally precludes a repeatable third kind, and no third session type exists in §5.1's design — the brief's third value was an error. Widening later is an additive migration + decisions.md event.

7. **C2 rides the contract** — no separate C2 spec in this batch (ratified 2026-07-08). Batch 3 (D1–D3, E2, F2, G1–G3) remains W3, gated on C2.

**Architecture impact:** §3's RPC list is amended by decisions 5 and 6 (param-level only; no new/removed RPCs). Items 5 and 6 were authored on operator authority against the Jul 10 deadline and flagged to the owner for ratification at the freeze. Cross-chunk consumers: **C2** (stubs + zod from the contract), **B1–B5** (implement to it; W2 specs may not alter it), **G2** (sole nuance-score read path), **E1** (threshold ratifies separately per D-005 §4 — untouched by these signatures).

---

## D-011 — WS-B signature contract: adversarial-review rulings (2026-07-08)

**Context:** the owner directed an independent adversarial review of the WS-B signature contract (Opus reviewer, no authorship context, verified against merged `0001–0003`, ARCHITECTURE, D-001–D-009, C1 spec, BUILD_PLAN §3). Verdict: NOT READY — 1 BLOCKER + 3 MAJOR (all CONFIRMED) + 6 MINOR/NIT. All findings adjudicated and folded into the contract same-day; this entry records the rulings. The contract remains the freeze deliverable; these amendments ratify with it on Fri Jul 10.

**Rulings (contract updated accordingly):**

1. **BLOCKER — `import_guest_snapshot` input = the ENTIRE C1 envelope v2** `{v, anon_id, created_at, state}`, not the `state` alone. `anon_id` is a top-level envelope field (C1 spec) and carries the §4.6 baseline-linking that preserves the 30-day nuance clock; "input is the state" would have silently severed it. B5 reads `snapshot.anon_id` + `snapshot.state.*` and ignores `state.total_xp` (XP always derived server-side).

2. **MAJOR — the "no client-facing score path" claim was FALSE as stated.** Merged `0003`'s `nuance_sessions_select_own` + Supabase default table grants expose `score`/`elapsed_days` to the row owner via plain SELECT, independent of the ack-only RPC returns. Ruling: contract now states the caveat honestly, and **B4's chunk gains a migration replacing the table-wide SELECT grant on `nuance_sessions` with a column-list grant excluding `score` and `elapsed_days`** (own-row `answers`/`kind`/`created_at` stay readable for §5.1.5). After it, the ratified no-score stance is structural on both paths.

3. **MAJOR — `complete_opinion_builder` gains a leading `topic_id text` param** (amends ARCHITECTURE §3's four-param signature). `evolved_takes.topic_id` is NOT NULL, no OB→topic mapping exists server-side, and OB ids don't embed topic ids (`tax-ob-01` vs `taxes`) — the §3 signature could not populate the column or run the unlock check. Client always has the topic in hand. Companion dependency flagged: B3 needs a server-side **OB registry** (small B3 migration + H1-seeder extension) to validate `ob_id`/ordering — without it, forged ob_ids mint unbounded XP.

4. **MAJOR — lost-ack retries reclassified as idempotent successes** (was: errors, contradicting §4.4's naive-retry posture). Nuance resubmission of an existing (identity, `kind`) → `{accepted: true}`, no write; repeat import after success → S1 with `xp_awarded: 0`, checked before the `progress_not_empty` refusal. `duplicate_submission` and `already_imported` removed from the error registry (now 14 codes). B4/B5 must pre-check rather than let unique-constraint `23505`s surface as `internal`.

5. **MINORs:** `not_authenticated` annotated defensive-only (grant wall fires first; session expiry is a client-side auth-state concern) · `invalid_params` vs `invalid_answers` boundary drawn (type/arity vs content/length — never overlap) · `xp_awarded` now present on ALL S1 returns incl. `check_streak` (constant 0) so C2 keeps one zod schema · `check_streak` adds `freeze_awarded: boolean` (award co-occurs with `extended`, so it can't be an enum value) · `topics`/`opinion_builders` flag-map shape pinned to the registry-generated `DEFAULT_PROGRESS` shape (= C1 envelope `state` shape) · anon nuance RPC grants tightened to `anon` only · `get_ob_comparison` on unknown `ob_id` → `{n: 0, gated: true}` (non-enumerating), `unknown_ob` reserved for `complete_opinion_builder` · `complete_flashcards.level` domain = flashcard-bearing levels per content catalog (P0: `1` only).

**Review clean passes (for the record):** snapshot column set exactly matches `0001.progress` with justified exclusions; the D-010 amendments (`check_streak` param, two-value `kind`) were independently confirmed correct against the merged sources; §5 inventory consistent with §4 prose; RAISE-token error mechanism confirmed viable through PostgREST/supabase-js; no return-shape leaks (quiz key path, custom-take text, n-gate all clean).

**Architecture impact:** §3's RPC list amended by ruling 3 (param-level). New schema-side work assigned: B4 column-grant migration (ruling 2), B3 OB registry + H1 seeder extension (ruling 3). Cross-chunk consumers: **C2/C3** (envelope-not-state import input; retry semantics), **E2** (retry semantics), **G2** (score-masking makes its admin views the sole score path), **H1** (seeder extension).

**RATIFIED by owner 2026-07-08** — ahead of the Jul 10 date, covering the full WS-B signature contract and every D-010 + D-011 ruling, explicitly including the `complete_opinion_builder(topic_id, …)` amendment to ARCHITECTURE §3 and the B4 `nuance_sessions` column-grant masking migration. The contract is FROZEN as of this ratification; Jul 10 remains the formal freeze date for the rest of the batch (C1 envelope, D-008 `answers` shape, D-005 §1–3).

---

## D-012 — Batch-2 (WS-B chunk spec) interface rulings (2026-07-08)

**Context:** authoring the five WS-B chunk specs (B1–B5, docs/specs/) against the frozen signature contract forced a set of below-signature but cross-chunk interface pins the contract deliberately delegated ("exact transition semantics are the W2 spec's job") or left unstated. No frozen name, param, return shape, grant, or error code is altered; the 14-code registry is unchanged. Authored on operator authority same-day as the contract ratification; **flagged for owner ratification** with the batch. Recorded per BUILD_PLAN §1.

**Rulings:**

1. **Progress flag-map semantics made concrete** (the contract §2's "registry-generated `DEFAULT_PROGRESS` shape", transcribed from the legacy client + merged C1 `guest.js`): `topics` is a **sparse** map `{topic_id: {unlocked, currentLevel, levels: {"1"|"2"|"3": {flashcardsComplete, quizComplete, quizScore}}}}`; absent keys = defaults; a fresh row's `'{}'` is valid; no RPC eagerly hydrates (C2's client-side `DEFAULT_PROGRESS` supplies display defaults). `flashcardsComplete` means "card/reading portion done" on every level (L1 flashcards, L2 cards, L3 cards). `opinion_builders` values are `{completed: bool}` **only** — take text lives in `evolved_takes`. Server-side **unlocked predicate**: `topics_catalog.position = 0` OR the topic's `unlocked` flag. The **next-topic unlock is written by `complete_quiz(topic, 3)`** (B1), matching the legacy client; `currentLevel` keeps legacy parity (quiz completions move it; card completions don't). No intra-topic sequence is server-enforced beyond the unlock check and B3's required-before-optional rule — ordering can't change total mintable XP.

2. **`complete_level2` and `complete_level3_cards` award zero XP.** The merged `xp_awards` seed (D-005 §2, confirmed complete at A1 review) has no action for either, and the legacy client awards nothing for them. Both RPCs are flag-only writers returning `xp_awarded: 0` on every call. No `xp_awards` rows are added.

3. **`tz_offset_minutes` sign convention:** the stored column and the `check_streak` param mean **minutes east of UTC** (`local = UTC + offset`; IST = +330, PDT = −420). C2 derives it as `-new Date().getTimezoneOffset()` (the JS accessor is sign-inverted). Server date math computes explicitly in UTC (`(now() at time zone 'utc') + make_interval(...)`) so session TimeZone never matters. The B2 streak transition table (in the B2 spec) is the contract-anticipated completion of the frozen `streak_event` enum, incl. the monotonic `gap <= 0 → same_day` no-op and freeze-spend-only-on-exactly-one-missed-day.

4. **OB registry:** `ob_catalog(ob_id PK, topic_id FK, required, position, standard_options text[])`, B3's migration + `content:seed` extension (executes D-011 ruling 3), default-deny RLS. `standard_options` (the preset take texts) closes a hole the freeze's S3 gating assumed away: without server-side preset validation, a take submitted `is_custom=false` with arbitrary text would surface **user-written text** through the comparison's preset `evolved` buckets. Live path: non-preset text with `is_custom=false` → `invalid_params`. Import path: downgraded to custom (tolerates envelope drift; grants no XP a truthful `is_custom=true` wouldn't). **Required-before-optional violations raise `locked_topic`** (detail-annotated) — the registry's "not yet unlocked for this user (state-transition check)" reading; no 15th code is added.

5. **`evolved_takes` gains `excluded boolean not null default false`** (B3's 0006) and `get_ob_comparison` filters `excluded = false` from P0 — aligning the RPC with ARCHITECTURE §3/N8's "every cited aggregate filters excluded" (comparison bars are on that list; 0001 only carried the flag on `nuance_sessions`). P1-5 becomes pure client work. Admin toggle UI remains G2/P1.

6. **Events interface** (executes BUILD_PLAN `[P-8]`, due at the freeze): the 25-name allowlist is enumerated and frozen in the B5 spec (additions are decisions.md events). The frozen `log_event(name, props)` signature carries no `anon_id` param, so **guest identity rides `props.anon_id`** (UUID-validated, lifted into `events.anon_id`, stripped from stored props); authed callers' identity is `auth.uid()`. Quota: 500/identity/UTC-day, parameter-slot function. **`delete_account` anonymizes events (`user_id → NULL`) rather than deleting them** — honoring 0001's "event rows must survive account deletion for aggregate analytics" while removing identity; everything else (profiles, progress, evolved_takes, nuance_sessions incl. linked-anon rows) hard-cascades via the `auth.users` delete.

7. **Import mechanics:** the §4.6 "progress row at default state" one-shot condition is defined as `total_xp = 0 ∧ topics = '{}' ∧ opinion_builders = '{}' ∧ no evolved_takes rows` — **streak columns excluded**, because C2's login bootstrap (`check_streak`) legitimately touches them before C3 imports. `snapshot.anon_id` must be UUID-format (it links minors' opinion rows; `[r1]`'s CSPRNG bearer property is the guessing defense). Linking updates only `user_id IS NULL` rows; rows linked to another account are silently skipped (shared-device tolerance; G2's `[r2]` dedup absorbs the rest). OB XP derives **only from valid take entries** (a bare `completed` flag imports but mints nothing); the quiz perfect bonus derives from `quizScore =` the real answer-key length. Hard derivation ceiling: 4,000 XP.

8. **Migration ownership + shared helpers:** B1 → `0004_rpc_grading.sql`, B2 → `0005_rpc_progression_streak.sql`, B3 → `0006_rpc_opinion_builder.sql`, B4 → `0007_rpc_nuance.sql`, B5 → `0008_rpc_import_events_deletion.sql` (D-005 §1 one-owner-per-file; assignments recorded in each spec). B1's 0004 additionally carries the three shared internal helpers (`progress_snapshot(uuid)`, `topic_unlocked(jsonb, text)`, `xp_for(text)`) consumed by B2/B3/B5 as frozen. **Grant-wall convention:** every WS-B function `revoke execute … from public` before granting the contract-listed audience — without it Postgres/Supabase default EXECUTE grants would let anon reach authed RPC bodies, contradicting the contract §6 "grant wall fires first" note; internal helpers are revoked from all client roles.

9. **B4 mechanics:** `pg_trgm` installs into the `extensions` schema (calls schema-qualified — the contract pins `search_path = public, pg_temp`); the trigram threshold and rate limit live in single-definition parameter-slot functions (`nuance_trgm_threshold()`, `nuance_rate_limit_per_hour()` = 60 `[r5]`) so the D-005 §4 Jul 13 ratification is a one-constant change; rate-limit counters live in a new default-deny `nuance_rate_limits(ip, window_start, count)` table; the masking grant's exact column list is `id, user_id, anon_id, kind, answers, excluded, created_at` (never `score`/`elapsed_days`). Consequence made explicit: the role-level grant means **admins also lose direct score SELECT** — G2's views must be SECURITY DEFINER, which D-011 already designates as the sole score path. Duplicate pre-check runs **before** rate-limit consumption so lost-ack retries are never rate-limited into failures.

**Architecture impact:** none at the §2/§3 interface level (no RPC/param/return/grant/error change). Schema-side additions within chunk-owned migrations: `ob_catalog` + `evolved_takes.excluded` (B3), `nuance_rate_limits` (B4). Cross-chunk consumers: **C2** (rulings 1, 3, 6 — sparse-map reconciliation, offset derivation, explicit-column nuance selects), **C3** (ruling 7 default-state definition), **G1** (ruling 6 allowlist), **G2** (rulings 6, 9), **E2/P1-2** (allowlist day-30 names pre-frozen).

**RATIFIED by owner 2026-07-08** — rulings 1–9 as written, with one rider and one verification note:

- **Rider on ruling 6 (binds F2):** the P0 privacy page's deletion copy must plainly disclose anonymized event retention — deleting an account erases everything identifying (profile, progress, takes, sessions) but anonymous usage counts (events with `user_id → NULL`) are kept for aggregate statistics. One added sentence in F2's plain-language deletion promise; no schema or RPC change. ARCHITECTURE §8.2's privacy-page content list is amended accordingly.
- **Ruling 7 ceiling verified at ratification:** 4,000 = 5 topics × 200 (L1 flashcards 50 + L1 quiz 50+25 perfect + L3 quiz 50+25 perfect; L2/L3 cards mint 0 per ruling 2) + 10 OBs (2 per topic in content JSON) × 300 (100 + 200 custom bonus). Checked against the merged `xp_awards` seed, `registry.js` (5 topics), and per-topic `opinionBuilders` arrays. The ceiling **equals** the legitimate maximum — structural derivation cap, no honest-guest shortfall; B5's forged-envelope test asserts exactly 4,000.
- **Ruling 2 confirmed as a deliberate product choice**, not only legacy parity: quiz completion pays, passive card completion doesn't. Adding card XP later = one `xp_awards` seed row + two RPC touches + re-derivation of the ruling-7 ceiling.

Nuance-threshold ratification (D-005 §4, Jul 13) remains separate and untouched.

## D-013 — E1 trigram near-duplicate threshold ratified at 0.55 (2026-07-08)

Executes D-005 §4's proposal-and-ratify, ahead of the Jul 13 date. The operator, having completed the golden-set hand-scoring pass (all 20 fixtures ratified, commit 202b7ab), ratifies the E1 builder's proposed threshold.

1. **Value: 0.55, strict `>` comparison.** `position` and `other_side` are near-duplicates iff their pg_trgm-style trigram similarity is **greater than** 0.55 — a pair measuring exactly 0.55 is NOT a duplicate. The value lives in exactly two single-definition constants that must always agree: `TRIGRAM_NEAR_DUPLICATE_THRESHOLD` (`tests/nuance/reference-scorer.mjs`) and B4's `nuance_trgm_threshold()` parameter-slot function (D-012 §9). Per D-005 §4 the ratified value is now part of the frozen rubric — changing it is a decisions.md event.

2. **Boundary pins:** gs-09 (similarity 0.5683 → near-duplicate → 2 pts) and gs-10 (0.5297 → distinct → 3 pts) are the permanent regression fixtures for the exact line. Their synthetic construction (rubric ambiguity 4) is accepted for what they are — threshold pins, not naturalistic answers; a naturalistic supplement may be added later without a decision event as long as the threshold and the pins stand.

3. **Basis, and the caveat accepted with it:** ratified on golden-set evidence, not corpus analysis (none can exist pre-launch — rubric ambiguity 5). Across all realistic fixtures, genuinely distinct argument pairs measure 0.03–0.32, light rewording measures 0.84, copy-paste 1.0; 0.55 sits in the empty band between honest and duplicate behavior with wide margin on both sides. Post-launch revision with real user text is expressly permitted — via a new decision entry.

4. **Fidelity guard restated:** the JS trigram implementation is unverified against live `pg_trgm` (rubric ambiguity 3). Any B4 SQL-vs-reference disagreement on any golden-set fixture escalates per the E1 spec — never silently resolved; B4's DoD already requires agreement on all 20.

NUANCE_RUBRIC.md status updated from PROVISIONAL to RATIFIED in the same commit. Rubric ambiguities 1 (whitespace trimming) and 2 (code-point counting, gs-18) remain open for separate rulings; they do not block B4 start.

## D-014 — Nuance instrument UI constraint: undisclosed thresholds, frozen form (2026-07-08)

Owner ruling arising from the D-013 ratification discussion. Binds **E2** (baseline quiz UI, batch 3) and **P1-2** (day-30 session UI); recorded now so it's standing when those chunks are spec'd in W3.

1. **The scoring thresholds are never disclosed in-product.** No character counter, no minimum-length hint, no "write more" nudge, and (restating D-010) no score display. The 40-char and 0.55-trigram rules stay invisible so the score cannot be aimed at: a visible bar would measure compliance with a UI instruction rather than unprompted willingness to articulate both sides (Goodhart), and would hand skeptics the objection that the 30-day improvement is "users learning the form's requirements."

2. **The structured capture form is frozen across sessions.** Identical fields, labels, input sizing, and framing copy at baseline and day 30 — and unchanged across the measurement window once real baselines exist. Any change to the capture form after first launch is a decisions.md event, because it breaks before/after comparability of the instrument.

3. **Fairness posture recorded:** users never see nuance scores, a short genuine attempt falls to 2 (the "It's complicated" tier), not 1, and the 10% admin spot-check (N6/N8) is the designated evidence channel for revisiting `MIN_STRUCTURED_FIELD_CHARS = 40` post-launch — a one-constant decisions.md change plus re-cutting the 39/40/41 boundary fixtures, taken on observed answers, not speculation.

## D-015 — E1 text-measurement rulings: no normalization, code points (2026-07-08)

Owner ratification closing NUANCE_RUBRIC.md known-ambiguities 1 and 2 — the last open E1 items. Shared principle, continuous with D-013/D-014: **the scorer measures text exactly as stored** — every normalization step is a fresh opportunity for the JS reference and B4's SQL to silently disagree, and everything normalization would catch is already the admin spot-check's job (N6/N8).

1. **Whitespace is untrimmed (ambiguity 1).** The ≥40 rule measures the field as stored; neither implementation trims (`trim()`, `btrim()`, or any stripping) before counting. Deciding "trim first" would itself create divergence — JS `trim()` and Postgres `trim()` disagree on what whitespace *is* (tabs, NBSP, etc.). Padding-to-40 requires knowing a threshold D-014 bars from disclosure, earns nothing user-visible, and is glaring in the spot-check. **B4 DoD gains a padded-input agreement test** (no golden-set fixture isolates this; the set is hard-pinned at 20).

2. **Code points are the unit of length (ambiguity 2); no Unicode normalization.** `Array.from(str).length` in JS ≡ `char_length()` in a UTF-8 Postgres — the only length definition both engines implement natively and identically. Grapheme clusters (ZWJ sequences, modifiers) are expressly NOT the unit; text gaming the difference is gibberish-tier, i.e. spot-check territory. **B4 DoD gains the gs-18 verification**: `char_length()` of forty U+1F642 returns exactly 40 through the live SQL, converting the rubric's "unverified" note into a tested fact when B4 lands.

Rubric ambiguities 1–2 annotated as ratified; B4 spec DoD amended with both tests. With D-013/D-014/D-015, every E1 open item is closed — B4 implements against a fully pinned rubric.

## D-016 — Batch-1a formal freeze record (for Fri Jul 10) — AUTHORED 2026-07-08, RATIFICATION PENDING

BUILD_PLAN names Fri Jul 10 as the batch-1a interface freeze. Nearly everything on the freeze list was ratified early (D-008 through D-015); this entry consolidates the complete list with as-built evidence so Friday's sign-off is a single act. Prepared by the operator 2026-07-08.

**Already frozen by prior ratifications — no Friday action:**
- E1 in full: golden set hand-scored (202b7ab), trigram 0.55 (D-013), instrument UI constraint (D-014), measurement pins (D-015).
- `answers` jsonb shape `{question_id, response_type, position?, other_side?}` — frozen with the WS-B signature contract, ratified D-010/D-011.
- All 13 WS-B RPC signatures + the 14-code error registry (D-010/D-011, frozen early 2026-07-08).

**Confirmed as-built, incorporated into the freeze by this entry (D-005 §1–3):**
1. **Migration ownership** — executed: `0001` (A1) / `0002` (A2) / `0003` (A3) merged, full-chain verified on real PG15 (D-009); `0004`–`0008` assigned one-per-chunk to B1–B5 (D-012 §8).
2. **`xp_awards` seeded in 0001** — completeness confirmed at A1 review; the derived 4,000-XP ceiling re-verified against the seed at D-012 ratification.
3. **Unlock registry at `src/data/registry.js`** — merged (H1); `topics_catalog.position` seeds from it; C2 binds to it for `DEFAULT_PROGRESS` (D-012 §1).

**Newly frozen by this entry — C1 guest envelope v2** (the one freeze-list item not previously ratified):
- localStorage key `civic_envelope_v2`; envelope `{v: 2, anon_id, created_at, state: {total_xp, topics (flags only, no XP inside), opinion_builders, evolved_takes: [{opinion_builder_id, topic_id, cold_take, evolved_take, is_custom}], baseline_done}}`. `anon_id` from `crypto.randomUUID()` ONLY, minted once, lazily if unavailable at creation `[r1]`.
- Module API: `loadEnvelope` / `saveEnvelope` / `getAnonId` / `migrateV1` / `clearEnvelope`, plus the `validateEnvelope` helper export. Backup keys `civic_progress_v1_backup` and `civic_envelope_v2_corrupt_backup`; legacy `civic_progress` cleared only by C3 after confirmed import.
- As-built verified against the C1 spec at freeze prep (2026-07-08): API surface, storage keys, randomUUID-only generation, and quarantine paths all match; 21/21 tests green on re-run. The spec's "final shape to operator by EOD Thu Jul 9" deliverable is satisfied by the merged implementation.
- Consumers bound: C2 (reads), C3/B5 (import consumes the FULL envelope incl. top-level `anon_id` — D-011 §1), E2 (`getAnonId` for baseline). Post-freeze changes are decisions.md events.

**§3a runbook consolidation (no new decisions — surfacing already-ratified items into the step list):** precondition (0) = the D-006 §3 username ruling is ratified before the run; post-steps (5) rotate the prod DB password immediately after the repair (D-006 security note) and (6) deploy the D-002 "progress syncing paused" banner to the legacy client on repair day.

**The only two Friday actions:**
1. **Rule on D-006 §3 (overlength username):** accept the default identity-preserving rewrite (email local-part where it fits, else deterministic `user_<id-prefix>`, plus `needs_profile_completion = true`), or direct a specific handle / contact the tester first. Precondition for the week-2 repair.
2. **Sign below.**

**RATIFIED by owner 2026-07-__ :** _______________  (D-006 §3 username ruling: _______________)

## D-017 — CI was never green: three root causes fixed; external-DB test mode is now the convention (2026-07-08)

**Finding (operator):** all six GitHub Actions runs since the first push had failed — the Docker-dependent jobs (`migrations`, `rls`, `auth`) were red from run 1. Nobody had seen it because every A1–A3 suite was verified locally against plain PG15, and **no pre-CI environment ever had Docker** (each suite's own header says so): GitHub Actions was the first time this code actually executed. `content` and `calibration` were genuinely green throughout; the migrations themselves were never the problem (`content` applies the full chain and seeds against it).

**Root causes, each reproduced locally before fixing:**
1. **Port collision (jobs `migrations`, `rls`):** ci.yml started a shadow stack per job, then ran suites that self-provision a *second* CLI stack — both `supabase init` configs use the same default ports. The job author assumed the tests would target the running stack; the test author assumed self-provisioning. Never reconciled because never executed.
2. **Fixture collision with A2's trigger (both `rls` suites):** A3's fixtures direct-insert `profiles` rows for users just inserted into `auth.users` — but on the full-chain shadow, 0002's `on_auth_user_created` has already auto-created those rows → `duplicate key (profiles_pkey)`. A3's "0003 only depends on 0001" isolation assumption doesn't survive integration. Fix: delete the trigger-created rows, then insert the original fixtures unchanged.
3. **stdout parsing bug (`auth/username-available`):** the helper ran `psql -t -A -c "set role anon; select …"` and compared `stdout.trim()` to `'t'`/`'f'` — but `-t` does not suppress the `SET` command tag, so the value was always `"SET\nt"`. Failed on every stack, Docker or not. Fix: take the last output line (the technique the sibling suites already used).

**Conventions set (bind every future DB-suite CI job — B1–B5's rpc jobs included):**
- **`CIVIC_TEST_DB_URL`:** every DB suite consumes an externally provisioned database when this env var is set (`acquireDb()` in `tests/lib/supabase-stack.mjs`), and only self-provisions a Docker stack when it isn't. **One stack per CI job**, handed to every suite in that job via this variable.
- **`tests/lib/pg-local-stub.sql`:** a committed Supabase-environment stub (roles, schema-usage grants, `auth.users` + `auth.uid()`) that lets the full migration chain and every DB suite run against plain Postgres — no Docker. **Correction (D-018):** the first version of this file blanket-granted table privileges to the client roles, which masked a real missing-GRANT defect in 0003 (green locally, red in CI). It now grants schema usage only, mirroring the real stack, so migration grants are exercised rather than papered over.

**Verification:** all five suites green against fresh stub+chain PG15 databases via the new path — 96 checks, 0 failures (deny-all 4, auth/trigger 44, auth/username-available 8, rls/policies 29, rls/column-restriction 11); calibration harness unaffected. The ci.yml wiring itself is verified on the next push (this machine cannot run Docker or reach Actions logs).

## D-018 — Real access-control defect: RLS policies without base GRANTs (2026-07-08)

**Finding (operator, via the D-017 CI fix + gh-authed log access):** with CI's `rls` job finally reaching its assertions, the "RLS policy suite" step failed with `permission denied for table profiles` (and progress, evolved_takes, nuance_sessions) and Postgres's own hint: `GRANT SELECT ON public.profiles TO authenticated`.

**Root cause — a genuine bug, not a test artifact.** `0003_policies.sql` creates `for select to authenticated` (and `for update`) policies on the client-readable tables, but never grants the **base table privilege** those policies filter. In Postgres an RLS policy narrows access that a GRANT has already conferred; a policy alone grants nothing. So on the real Supabase stack — which does NOT auto-grant migration-created tables to the client roles — every authenticated client read of its own row is denied before RLS is even consulted. This would have broken the live app: per D-008 §4 the client reads its own profiles/progress/evolved_takes/nuance_sessions directly (RLS-scoped), not only via RPC.

**Why it was invisible until now (three-layer mask):**
1. The A2/A3 local "verified on real PG15" runs (D-009) almost certainly used a stub that blanket-granted the client roles — the same shortcut the first D-017 stub took — so the missing grant never surfaced.
2. The D-017 CI-fix stub (`tests/lib/pg-local-stub.sql`) `ALTER DEFAULT PRIVILEGES … GRANT ALL`-ed, reproducing that blind spot; its first run reported 29/29 green while real CI was red.
3. The suite's anon-denial and write-denial assertions are tolerant of `permission denied`, so a *missing* grant reads as a *correct* deny there — only the positive own-row reads exposed it.

**Fix:**
- `0003_policies.sql` now grants the minimal intended matrix: `SELECT` to `authenticated` on profiles, progress, evolved_takes, nuance_sessions, events (every table with a `to authenticated` SELECT policy); `UPDATE` to `authenticated` on profiles only (the sole client-writable table; the column-restriction trigger further limits columns). **`anon` receives nothing** (all anon interaction is SECURITY DEFINER RPCs); the three reference tables stay default-deny (D-008 §4); no INSERT/DELETE to any client role (RPC-only writes). This implements the already-ratified access matrix — it does not widen it; without it the control is simply non-functional. nuance_sessions gets full SELECT here; B4's 0007 masking migration replaces it with the score/elapsed_days-excluding column grant (D-011 §2 / D-012 §9), unchanged by this fix.
- `tests/lib/pg-local-stub.sql` corrected to grant **schema usage only** (no blanket table/sequence/function grants), so it mirrors the real stack's privilege posture. This is what lets the suites reproduce a real grant defect instead of hiding it.

**Verified (reproduce-then-repair, faithful stub):** on the corrected stub WITHOUT the 0003 grants, `rls/policies` reproduces CI's exact `permission denied for table profiles` failures; WITH them, all five DB suites pass 96/96 (deny-all 4, auth/trigger 44, auth/username-available 8, rls/policies 29, rls/column-restriction 11). CI confirmation on the next push.

**Follow-up flagged:** because A2/A3's original verification shared the masking blind spot, their green status covered trigger/policy *logic* but not the base-grant layer. No other missing-grant is known (the other tables are intentionally ungranted), but B1–B5's builders inherit the corrected stub and the D-017 `CIVIC_TEST_DB_URL` convention, so their RPC grant-walls will now be exercised faithfully.

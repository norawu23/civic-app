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

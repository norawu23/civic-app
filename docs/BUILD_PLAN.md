# CIVIC — Build Plan v4 (Opus Operator / Sonnet Builders)

**Status:** HARDENED v4.2 — audits 004–007 (docs/audits/); round-4 verdict: no blockers, no unaddressed majors. v4.1 applies audit-007's three editorial minors (f-1 architecture §8.2 body text, f-2 basis version, f-3 reserve labeling). **v4.2 (decision D-004, from the independent blind comparison review):** content for all five topics was verified to already exist in `src/data/` — H2–H5 are re-scoped from authoring to review/refresh (WS-H 10→6 bd, P0 52→48 bd); a first *additional* descope beyond the Aug 1 list is pre-named (server-side L1 grading); the plan's earlier "four topics need authoring" premise came from PRODUCT.md and was wrong.
**v4 changelog (responses to audit 006):** Q-1 → §1a laid onto the real 2026 calendar (Jul 6 is a Monday; freeze corrected to Fri Jul 10; W1=4 days, W5=6; pre-window work re-cut to what today actually holds + one named, bounded weekend session whose absence is itself a trigger event; weekly profile now sums to the 22.0 ledger exactly with per-week 90% ceilings from real day counts). Q-2 → D-003 + ARCHITECTURE v3.2 (privacy page discloses Sentry). Q-3 → D-002 amended (signup degradation named). Q-4 → A3 chunk body tagged for adversarial review.
**v3 changelog (responses to audit 005):** M-1 → §1a rebuilt (complete ledger incl. all five omitted items; 3 od moved pre-window; weekly profile with every week ≤ 90%; coherent two-part trigger; content-rework allowance separated from the reserve). m-2 → §1 handoff paragraph lists the six adversarial chunks. m-3 → D-001 propagated to A1 DoD + C2 scope + dependency sheet. m-4 → A3 moved to Tier 1. m-5 → G3 moved to Tier 2 with PII-scrub DoD; F2 copy discloses the error processor. m-6 → decision D-002 (accepted coexistence window + disclosure banner). m-7 → `events.js` assigned to C2, consumed by G1.
**Basis:** docs/ARCHITECTURE.md v3.2 (HARDENED, audits 001–003 + amendments D-001, D-003). Residual audit minors r1–r8 are transcribed into chunk definitions of done below and marked `[rN]`.
**Dates:** plan authored Jul 6. P0 complete Aug 10 (go/no-go Aug 1) · launch Sept 1 · day-30 harvest through Oct 15 · application writeup Oct 15–29 (ED Nov 1).

**v2 changelog (responses to audit 004):** P-1 → §1a (operator-day budget, tiered review, ≤80% utilization shown). P-2 → decision D-001 + ARCHITECTURE v3.1 (server-time streak with stored tz offset; `complete_level3_quiz` removed; B2 added to adversarial-review set). P-3 → §3 totals corrected (52 bd incl. content track and D3 routing; slack restated ~30%). P-4 → D3 scope + estimate. P-5 → §3a prod-repair runbook. P-6 → §5 acquisition bar held at Sept 5; late joiners excluded from primary cohort. P-7 → §3 cross-dependency sheet. P-8 → events allowlist = operator week-1 deliverable. P-9 → smoke #1 assigned to D1; "E3" reference fixed. P-10 → D2 DoD disclosure line. P-11 → P1-8 marked frozen-interface amendment. P-12 → C1 entropy DoD reworded testably.

---

## 1. Roles and protocol

**Operator (Opus-class).** Owns integration. Issues chunk specs, reviews every diff, runs integration tests, merges. Never delegates a merge. Makes all interface decisions; logs them in `docs/decisions.md`.

**Builders (Sonnet-class).** One chunk at a time, in an isolated worktree. Deliver: code + tests + self-review notes. Never touch schema outside their chunk, never add dependencies without operator approval, never merge.

**Chunk spec template (operator → builder).** Every chunk is issued as: objective (2–3 sentences) · in-scope files · interfaces consumed (frozen signatures) · interfaces exposed · definition-of-done checklist · required tests · explicit out-of-scope list. Sonnet builders do excellent work against tight specs and drift on vague ones; the template is the control.

**Handoff (builder → operator).** Diff + passing test output + self-review notes (what I'm least sure about). Operator gate: full diff read → run chunk tests + affected integration tests → DoD checklist → merge. **Integrity-critical chunks (A2, A3, B2, B4, B5, F1) get a second, adversarial review pass** before merge.

**Interface freeze.** RPC signatures, guest-envelope schema, and the events allowlist freeze **Fri Jul 10** (end of week 1 — real calendar). Post-freeze changes require an operator decision log entry and a version note in ARCHITECTURE.md.

**Concurrency cap: ≤ 3 builders in flight.** Operator review bandwidth is the binding constraint; more parallelism produces an integration queue, not speed.

**Escalation.** A builder blocked > half a day on ambiguity stops and asks; the operator's ruling goes in `docs/decisions.md`. No silent interpretation of unclear specs.

---

## 1a. Operator-day budget (P-1 → audit 005 M-1 → audit 006 Q-1: laid onto the real 2026 calendar)

The operator is the binding constraint, so their time is budgeted like the builders'. **Real calendar:** the plan is authored **Mon Jul 6**; the P0 window is Jul 7 – Aug 10 = **25 working days**, but the weeks are uneven — W1 (Tue Jul 7 – Fri Jul 10) has **4** days and W5 (Aug 3–7 + Mon Aug 10) has **6**.

**Pre-window and weekend work — explicit and bounded, not assumed:**
- **Today, Mon Jul 6 (~1 od real capacity):** spec batch 1a — the four chunks builders start tomorrow (A1, C1, E1, H1) — plus kickoff logistics. That is all today can hold.
- **One named weekend session, Sat–Sun Jul 11–12 (2 od):** golden-set hand-scoring (1 od — E1's harness needs it before B4 merges in W2/W3, not before W1) and spec batch 1b (A2, A3, B1–B5 — pure transcription of the interfaces frozen Fri Jul 10). This is a single, front-loaded, named commitment by a solo founder against a hard deadline — not a recurring assumption; no other weekend work appears anywhere in the budget. **If this session doesn't happen, that is itself a part-(a) trigger event on Monday Jul 13.**

**Tiered review:**
- **Tier 1 (integrity: A2, A3, B2, B4, B5, F1):** full-diff + adversarial second pass — 6 × 0.5 = **3.0 od**
- **Tier 2 (standard: A1, B1, B3, C1, C2, C3, D3, E1, E2, F2, G1, G2, G3):** test output + DoD + targeted diff — 13 × 0.25 = **3.25 od**
- **Tier 3 (low-risk client/content: D1, D2, H1–H6):** DoD + spot-check; H1 validator + CI do the mechanical checking; integrity holds because no client chunk can mint XP past the RPC/RLS wall (audit 005 confirmed) — 8 × 0.1 = **0.8 od**

**Complete in-window ledger (everything the operator does, Jul 7 – Aug 10):**

| Item | od |
|---|---|
| Reviews (tiers above) | 7.0 |
| Spec batches 2–3 (16 remaining P0 chunks × ~1.5 h) | 3.0 |
| P1 spec authoring (10 chunks — must precede Aug 11, so inside this window) | 2.0 |
| Interface-freeze ratification (transcription from §3, not design) | 1.0 |
| Events allowlist enumeration `[P-8]` | 0.5 |
| Content adjudication (0.5 × 5 topics) | 2.5 |
| Content rework allowance (2 topics × 1 revision cycle — separate from the reserve, per the plan's own bottleneck risk) | 1.0 |
| Neutrality-pass orchestration (harness scripted once in H1; operator triggers + reads) | 0.5 |
| Prod-repair runbook execution (§3a: backup, apply, diff) | 0.5 |
| Aug 1 go/no-go assessment | 0.25 |
| Aug 10 exit-criteria verification (incl. physical-iPhone pass + preview E2E) | 0.75 |
| Reserve: escalations, merge conflicts, integration debugging | 3.0 |
| **Total** | **22.0** |

**In-window weekday total: 22.0 od / 25 days = 88% average.** (The 3 od outside the window — 1 today, 2 on the named weekend — are accounted above, not hidden.)

**Weekly planned profile — real day counts, 90% ceilings, sums to the ledger:**

| Week (real dates) | Days | Ceiling (90%) | Planned od | Main items |
|---|---|---|---|---|
| W1 Tue Jul 7 – Fri Jul 10 | 4 | 3.6 | 3.10 | freeze ratification 1.0 · allowlist 0.5 · reviews (A1, C1) 0.5 · spec batch 2 start 0.5 · reserve + spillover 0.6 |
| W2 Jul 13–17 | 5 | 4.5 | 4.50 | prod repair 0.5 · spec batch 2 finish 1.0 · Tier-1 reviews A2+A3 1.0 · Tier-2 reviews 0.5 · H2 adjudication 0.5 · rework 0.25 · reserve + spillover 0.75 |
| W3 Jul 20–24 | 5 | 4.5 | 4.50 | Tier-1 reviews B2+B4+B5 1.5 · Tier-2 reviews 0.75 · spec batch 3 0.75 · H3 adjudication 0.5 · rework 0.5 · reserve + spillover 0.5 |
| W4 Jul 27–31 | 5 | 4.5 | 4.50 | Tier-1 review F1 0.5 · Tier-2/3 reviews 1.0 · go/no-go 0.25 · P1 specs 1.0 · H4 adjudication 0.5 · rework 0.25 · reserve + spillover 1.0 |
| W5 Aug 3–7 + Mon Aug 10 | 6 | 5.4 | 5.40 | exit-criteria verification 0.75 · P1 specs 1.0 · remaining Tier-2/3 reviews 1.15 · H5+H6 adjudication 1.0 · neutrality orchestration 0.5 · reserve + spillover 1.0 |

**Sum: 3.10 + 4.50 + 4.50 + 4.50 + 5.40 = 22.00 od = the ledger, exactly.** Every week ≤ its real-capacity 90% ceiling; total ceiling headroom is 0.5 od (22.5 − 22.0) — tight, which is the honest statement of this schedule, and why the trigger below exists. The full per-item weekly itemization lives in the operator's tracking sheet; the two invariants it must preserve are (1) columns sum to the ledger and (2) no week above its ceiling.

**Relief-valve trigger (unchanged, now coherent against a real calendar):** fires when (a) any week's *actual* exceeds its *planned* od by more than 1.0 — including a missed Jul 11–12 weekend session — or (b) any week's actual exceeds 95% of its real capacity. Firing means: invoke the Aug 17 extension at that week's end (not waiting for Aug 1) and apply the go/no-go descope list.

**Merge discipline:** one batched merge window per day (not continuous context-switching). H2 content review sits in W2 by design, not W1.

---

## 2. Test taxonomy and CI gates

| Layer | Owner | Scope |
|---|---|---|
| Unit | builder | scoring function, envelope logic, reducers, pure helpers |
| Integration | builder + CI | every RPC against local Supabase (`supabase start`); **every RLS policy has a deny-path test** |
| Calibration | CI | 20-example golden set vs the nuance scoring function (E1) |
| E2E (Playwright) | P0: 3 smoke flows · P1: full suite | smoke = guest full topic, signup + import, nuance baseline |

**CI gates (all red = no merge):** migrations-from-empty build · content schema validation + seeding · lint · no-`console.*` check (prod build strips; source must be clean) · full test suite.

---

## 3. P0 chunks (Jul 7 – Aug 10)

Dependency spine: **A1 → A2/A3 → B* → C2 → C3/D* → integration**. C1, E1, F2, H* have no upstream code dependencies and start day 1.

### WS-A — Database foundation (sequential; blocks all RPC work)

**A1 — Migration squash + prod repair.** `0001_schema.sql` (full v3.1 schema incl. `needs_profile_completion` `[r3]` and `progress.tz_offset_minutes` per D-001 `[m-3]`), `repair_prod.sql`, post-repair `pg_dump --schema-only` diff script vs CI shadow DB, CI migrations-from-empty job.
DoD: shadow == repaired prod (empty diff) · CI red on code references to columns absent from migrations. *3 builder-days.*

**A2 — Auth trigger + `username_available`.** `on_auth_user_created` creates profiles + progress; exception handler → placeholder username + `needs_profile_completion=true` `[r3]` · server-side rejection/voiding of birth years implying < 13 `[r3]` · pre-flight `rpc.username_available`.
DoD tests: username collision, missing metadata, under-13 payload, double-fire idempotency. *2 bd. Adversarial review.*

**A3 — RLS suite + column restriction.** Policies per §2.3 matrix · BEFORE UPDATE trigger on profiles (username/avatar_id writable; birth_year settable only while NULL) `[N9]`.
DoD: deny-path integration test per policy per table, incl. cross-user reads, guest writes, non-admin admin-view access. *2 bd. Adversarial review.*

### WS-B — RPC layer (after A1; parallel; signatures frozen Fri Jul 10)

**B1 — L1 RPCs.** `complete_flashcards`, `complete_quiz` — server grading against content tables, `xp_awards` lookup, idempotent. Tests: replay never re-awards, locked-topic rejection, score bounds. *2 bd.*

**B2 — Progression RPCs.** `complete_level2`, `complete_level3_cards`, `check_streak` (L3 quiz grades through `complete_quiz` per the authoritative §3 list — decision D-001). Streak day boundary per D-001: **server time only**, user-local midnight derived from stored `tz_offset_minutes` (client-refreshed, clamped ±14 h); device clock never an input. Tests: unlock chain, streak increment/reset/same-day, offset-manipulation cannot resurrect a lapsed day, offset clamp edges. *2 bd. Adversarial review.*

**B3 — Opinion Builder RPC.** `complete_opinion_builder` — validates shape, writes `evolved_takes` + progress in one transaction. Tests: double-submit, 50-char bonus threshold, required-before-optional ordering. *2 bd.*

**B4 — Nuance RPCs + scoring.** `submit_nuance_session`, `submit_nuance_baseline_anon`, `submit_nuance_day30_anon` (≥ 28-day baseline precondition, server `elapsed_days`) · scoring per rubric · IP + anon_id rate limits **calibrated for classroom bursts: 60 submissions/hour/IP, parameterized and tested** `[r5]` · reject anon_ids already linked to a user `[r2]` · `excluded` honored downstream.
DoD tests: golden-set calibration green, burst simulation (30 submissions/10 min/1 IP passes; 200 fails), linked-id rejection, day-30 before day 28 rejected. *3 bd. Adversarial review.*

**B5 — Import + events + deletion.** `import_guest_snapshot` (flags-only, derived XP, one-shot, `imported=true`), `log_event` (allowlist + quota), `delete_account` (full cascade).
DoD tests: forged-XP clamp to catalog max, second import rejected, delete leaves zero rows across all tables, event off-allowlist rejected. *2 bd. Adversarial review.*

### WS-C — Client data layer

**C1 — Guest envelope v2.** Versioned schema · anon_id generated by `crypto.randomUUID()` (CSPRNG — the `[r1]` bearer-credential requirement), **enforced by code inspection at review plus a format + uniqueness test**; no homegrown generators · legacy `civic_progress` migration · **PWA install prompt in guest flow** (iOS Safari 7-day storage eviction mitigation `[r6]`). No upstream deps — starts day 1. *2 bd.*

**C2 — useProgress/useAuth rebuild.** RPC-calling data layer, snapshot reconciliation, retry-on-error (NO offline queue), typed error surface for screens · **tz-offset refresh on every app load** (clamped ±14 h, per D-001 `[m-3]`) · **owns `src/data-layer/events.js`** (the `log_event` transport G1's instrumentation points call `[m-7]`). Builds against stub responses until B* lands, then swaps. Unit + integration tests. *3 bd.*

**C3 — Signup migration flow.** Import call on first login, envelope cleared only on confirmed success, failure UX (retry banner — never silent loss). E2E smoke #2. *1 bd.*

### WS-D — Screen surgery (after C2; parallel per chunk)

**D1 — Quiz/Lesson/Level3 screens.** Remove client grading + XP math; render server results; loading/error states. **Owns E2E smoke #1 (guest full topic)** `[P-9]`. *2 bd.*
**D2 — OpinionBuilder/Profile/Admin screens.** RPC + view access only; delete direct table code. DoD includes the §8.2 in-product disclosure — "Visible to you and the CIVIC team" — at the evolved-take writing point `[P-10]`. *2 bd.*
**D3 — App shell + routing.** The §4.5 route reducer replacing `currentScreen` (stack + params, `?route=` boot parsing — P1 deep links depend on it `[P-4]`), age-gate insertion point, welcome rework, `needs_profile_completion` screen, delete all 27 debug statements, vite prod-strip plugin. *3 bd.*

### WS-E — Nuance instrument

**E1 — Rubric + golden set.** `docs/NUANCE_RUBRIC.md`, 20 hand-scored examples (operator hand-scores; builder harnesses), CI calibration job. Blocks B4 merge. Day 1 start. *1 bd + operator time.*
**E2 — Baseline quiz UI.** First-session flow (guest + authed), two-field structured capture, zero-reward framing copy, guest install-prompt tie-in `[r6]`. E2E smoke #3. *2 bd.*
(Day-30 UI is deliberately P1 — cannot be exercised before ~Sept 29.)

### WS-F — Trust & legal

**F1 — Age gate.** Birth-year screen before ANY server-side capture · guest year used client-side only, never transmitted · device-persistent block after under-13 answer `[r4]` · legacy NULL re-prompt at login · re-prompt under-13 answer → account + data deletion flow `[r8]`.
DoD: E2E proves no network call carries guest birth year; block survives reload. *2 bd. Adversarial review.*
**F2 — Privacy + terms pages.** Plain language, minors-appropriate; deletion promise text conditional on `delete_account` being live `[r7]` · **discloses the error-reporting processor (Sentry) honestly — no "no third parties" claim** `[m-5]`. Operator legal-tone review. *1 bd.*

### WS-G — Observability

**G1 — Funnel.** Event instrumentation points, SQL funnel views, AdminScreen funnel panel + **assumptions-vs-actuals table** for every §5.1.4 rate. *2 bd.*
**G2 — Nuance admin.** Paired-delta views with dedup rule (**prefer authed row when a user has both linked-anon and authed rows of the same kind** `[r2]`), excluded-flag toggle, aggregate panel. *2 bd.*
**G3 — Sentry + release hygiene (Tier 2 — privacy chunk, not hygiene `[m-5]`).** Error reporting, source maps, release tags. DoD: `beforeSend` PII scrubber; breadcrumbs stripped of request bodies and user content; no evolved-take or nuance text can reach Sentry — **with a test that asserts scrubbing on a synthetic event carrying user content**. *1 bd.*

### WS-H — Content track (parallel from day 1; operator is content editor)

**H1 — Content pipeline.** JSON schema validator, CI seeding check, sourcing-tier linter (Tier-1/2 domain allowlist; warn on unknown). *1 bd.*
**H2–H5 — Taxes, Gerrymandering, Gun Rights, Climate Change (review/refresh — content already exists, D-004).** All four topic JSONs are complete in `src/data/` (verified by the independent review: 10 flashcards, 5+5 quiz, L2 cards, 5 sourced L3 cards, both OBs each). Per-topic work is: H1 schema validation · **source-tier compliance pass** (known violation: FactCheck.org is cited and is on neither Tier 1 nor Tier 2 — replace with allowlisted sources) · L3 currency pass (60–90-day rule) · fixes arising from review. One topic/week, weeks 1–4.
DoD per topic (unchanged in substance): schema-valid · operator review against §6 standards (strongest-version-of-both-sides test, 14-year-old reading level, no-tell rule) · **independent neutrality pass by a separate model instance with no authorship context** · L3 sources resolve and are Tier 1/2 straight news. *1 bd each + operator review.*
**H6 — Immigration refresh.** L3 currency pass (60–90-day rule) before launch, week 5. *1 bd.*

**P0 totals (corrected P-3, re-scoped D-004): 48 builder-days** — WS-A 7 + WS-B 11 + WS-C 6 + WS-D 7 + WS-E 3 + WS-F 3 + WS-G 5 + WS-H 6 (H2–H5 at 1 bd each as review/refresh, not authoring). The content track draws on the same builder pool and counts. 48 bd / 5 weeks = 9.6 bd/week against the 15 bd/week ceiling → **~36% slack**. The 4 bd recovered by D-004 are banked as schedule slack, not reallocated — the binding constraint is operator bandwidth (§1a), which D-004 leaves unchanged (adjudication and neutrality passes were always review-side work).

### Cross-dependency sheet (P-7 — beyond the main spine)
- B1 integration tests need **H1** answer-key seeding → H1 lands before B1's test phase (week 1 ordering already provides this; now explicit)
- F1's `[r8]` deletion flow calls **B5** `delete_account` → F1 merges after B5 or stubs the call behind a feature flag
- E2 needs **F1** (gate precedes capture), **B4** (RPCs), **C2** (data layer) → E2 is week-3 work, as scheduled
- D3's age-gate insertion point pairs with **F1** → same builder or adjacent merge windows
- D-001 is cross-cutting `[m-3]`: **A1** carries the `tz_offset_minutes` column, **B2** the server logic, **C2** the client refresh — all three DoDs reference D-001
- "Starts day 1" claims (C1, E1, F2, H1) are verified true only in the build direction; their *consumers* carry the ordering.

### Prod-repair runbook (P-5)
**Owner: the operator — builders never hold prod credentials.** The operator supplies the A1 builder a schema-only dump of prod for repair authoring. Timing: `repair_prod.sql` runs against prod at the **start of week 2** (after A1 merges + CI shadow verification). Steps: (1) full `pg_dump` backup of prod, stored off-platform; (2) apply repair in a transaction; (3) run the post-repair schema diff vs the 0001 shadow — empty diff required; (4) on any failure, restore from the step-1 dump and reopen A1. Exit criterion 3 references this runbook.

**Legacy-client coexistence window `[m-6]` — decision D-002:** from the week-2 repair until the P1-1 deploy, the currently deployed legacy client's cloud saves fail by design (direct-table writes vs the new RPC-only RLS). Accepted: no external users exist pre-launch; guest localStorage is unaffected; a static "progress syncing paused" banner ships to the legacy client on repair day. Revisit trigger: any real external signup before P1-1 → re-time the repair to land with the new client.

### P0 exit criteria (all must hold on Aug 10)
1. Every P0 chunk merged, CI fully green.
2. Three E2E smoke flows pass against a preview deploy.
3. `repair_prod.sql` applied; post-repair diff empty.
4. RLS deny-path suite green.
5. All five topics seeded and schema-valid; four new topics operator-reviewed + neutrality-passed.
6. Age-gate and privacy flows verified on a physical iPhone (the actual target device).
7. Zero `console.*` in source; Sentry receiving events from preview.

### Aug 1 go/no-go (pre-decided, from §10)
If the RPC core + data layer are not merged and green by Aug 1: `delete_account` and `complete_level3_cards` slip to P1 (with `[r7]` launch-ordering constraint), anonymous-comparison prep drops to P2, Web Push is cut, P0 extends to Aug 17, soft-launch prep compresses to two weeks.

**First additional descope if that still isn't enough (D-004):** server-side grading of L1 quizzes — B1 reverts to client-written lesson progress behind own-row RLS (with the corrected migration and deny-path tests retained). This is the one slice of the integrity layer the code evidence doesn't justify at ~300 hand-recruited users: it protects only client-visible XP on secondary metrics, while the primary metric (nuance) is independently server-scored and reward-free.

**Never moves, under any descope: age gate, privacy pages, nuance/baseline pipeline, guest import, funnel instrumentation.**

---

## 4. P1 chunks (Aug 11 – Sept 1)

| # | Chunk | Notes | Est |
|---|---|---|---|
| P1-1 | Prod deploy + soft-launch checklist | Vercel + Supabase prod project, env separation, domain. **`delete_account` must be live before the first external user** `[r7]` | 2 bd |
| P1-2 | Day-30 UI + banner | consumes the day-30 RPCs shipped in P0 (B4) | 2 bd |
| P1-3 | Email re-engagement | Resend via Edge Function, day-28/35 sends, unsubscribe link, minors-appropriate tone, scheduled via pg_cron | 2 bd |
| P1-4 | Web Push | 7pm streak reminder, milestone notifications | 2 bd |
| P1-5 | Anonymous comparison | n ≥ 10 gate, `excluded=false` filter | 1 bd |
| P1-6 | L3-in-Supabase + admin editor | content updates without deploys | 3 bd |
| P1-7 | Social share card | canvas render → Web Share API | 2 bd |
| P1-8 | Streak freeze | **frozen-interface amendment** `[P-11]`: modifies `check_streak` post-freeze — requires a decisions.md entry, ARCHITECTURE version note, and full B2 regression rerun, not a greenfield chunk | 1 bd |
| P1-9 | IndexedDB offline queue | replaces retry-on-error | 2 bd |
| P1-10 | Playwright full suite | expands the 3 smoke flows | 2 bd |

~19 bd over 3 weeks — same cap, same slack. Cut order if compressed (from §10): P1-7 → P1-4 → P1-9 → P1-6.

**Launch: Sept 1.**

---

## 5. Post-launch (Sept – Oct)

- **Owner-led acquisition** — the plan's largest non-engineering risk: **~300 first-session users by ~Sept 5** (§5.1.4 chain — the bar holds at Sept 5, not later `[P-6]`; users joining after ~Sept 15 cannot complete the 28-day window before the Oct 15 snapshot and are excluded from the primary metric cohort, though still counted in the funnel). Engineering support only: shareable link, install QR, classroom-burst rate limits already sized `[r5]`.
- Weekly assumptions-vs-actuals review (G1 panel); guest-path return rate is the first assumption to reprice `[r6]`.
- Day-30 harvest window through **Oct 15 metric snapshot**. Reporting tier auto-selected by n (≥25 full / 10–24 pilot / <10 design-narrative) — pre-declared, §5.1.4.
- Application writeup Oct 15–29. P2 items (new topics, classroom pending student-data policy, news digest) proceed only if ahead of schedule.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Operator review bandwidth (the real constraint) | Complete ledger §1a: 22 od / 25 (88%), 3 od moved pre-window; weekly profile ≤ 90% planned; tiered review with adversarial pass on 6 chunks (A2, A3, B2, B4, B5, F1); two-part unplanned-overrun trigger → Aug 17 valve |
| Content quality bottleneck | Content already exists (D-004) — risk is currency + tier compliance, not authoring; H-track starts day 1, one topic/week review cadence, independent neutrality pass, H6 buffer in week 5 |
| Schedule slip in P0 | Aug 1 go/no-go with pre-decided descope; day-30 surfaces already off the critical path |
| Acquisition shortfall | Pre-declared reporting tiers; funnel visible from day 1; bar stated honestly at ~300 |
| iOS guest storage eviction | Install prompt (C1/E2); guest rate repriced weekly; quantified as survivable in audit 003 |
| Sonnet builder drift | Tight chunk specs, frozen interfaces, out-of-scope lists, operator-only merges |
| Supabase/Resend free-tier ceilings | Volumes trivial at 300 users; Resend 100/day >> ~60 total day-28 emails |

# CIVIC — Architecture v3 (Hybrid Rebuild)

**Status:** HARDENED v3.2 — audits 001–003 (docs/audits/); round-3 verdict: no blockers, no unaddressed majors. Residual minors r1–r8 transcribed into BUILD_PLAN.md definitions of done. Amendments v3.1 (D-001) and v3.2 (D-003) applied via the decision log.

**v3.2 amendment (decision D-003):** §8.2's privacy-page contents change from "no third parties" to an honest disclosure: one third-party error-reporting processor (Sentry), receiving reports scrubbed of PII and user-written content (scrubbing enforced and tested — BUILD_PLAN G3).

**v3.1 amendment (decision D-001, docs/decisions.md):** §3.2 `check_streak` remains server-time-only; user-local midnight is derived from a `tz_offset_minutes` column on `progress` (client-refreshed, clamped ±14 h), never from a client-supplied date. `progress` gains `tz_offset_minutes int NOT NULL DEFAULT 0`. The RPC list in §3 is confirmed authoritative — `complete_quiz(topic_id, level, answers)` grades all levels; no `complete_level3_quiz` exists.
**Author:** Fable 5 session, 2026-07-06
**Basis decision:** Keep the presentation layer (screens, CivBear, design tokens, content JSON) *after extracting embedded data logic* (see §4.1 inventory). Rebuild the data layer (schema, sync, auth/progress hooks, integrity). Scope: full spec incl. all 10 "Features to Build Next," phased P0/P1/P2 with named cut lines.
**Hard constraints:** Live app with real teenage users by ~Sept 1, 2026. Paired 30-day nuance data by mid-October (target: ≥25 paired sessions). Application deadline Nov 1. Solo human owner; Opus-class operator directing Sonnet-class builders.

**v2 changelog (responses to audit 001):** B1 → §5.1 rebuilt (anonymous baseline at true first session, multi-channel day-30 recapture, explicit sample-size math). M2 → §2.1 (squash-and-repair migration strategy). M3 → §4.1 (screen surgery inventory; "kept" reclassified). M4 → §4.6 (bounded import RPC as documented trust exception). M5 → §10 (phased plan, offline queue cut from P0, named cut lines). M6 → §8 (age gate, minors' data posture, classroom deferred to P2 with student-data policy). M7 → §5.1.3 (structured two-field capture replaces free-text heuristic). m1–m6 → §2.2, §2 (progress), §5.8, §2 (events), §3.1, §5.1.1 respectively.

**v3 changelog (responses to audit 002):** N1 → §3 + §5.1.2 (guest day-30 RPC added to the authoritative interface). N2 → §5.1.4 (paired-session forecast rederived as an explicit assumption chain; acquisition bar reset to ~300; fallback thresholds defined). N3 → §8.1 (age gate moved ahead of ALL server-side capture including guest baseline; under-13 blocked app-wide; guest birth year never stored). N4 → §2.1.5 + §2.2 (birth_year nullable with forced re-prompt for legacy accounts; post-repair prod-vs-shadow schema diff gate). N5 → §10 (P0 go/no-go checkpoint Aug 1 with pre-decided descopes; day-30 UI moved to P1-week-1 by design since it cannot be needed before late Sept). N6 → §5.1.3 (nuance sessions carry zero XP/reward, stated; gibberish handling in spot-check protocol). N7 → §2.2 (pre-flight username RPC; trigger exception handling with deferred profile completion). N8 → §3 (IP-scoped limits on both anon RPCs; `excluded` flag + admin exclusion from cited aggregates). N9 → §2.3 (column restriction mechanism named: BEFORE UPDATE trigger). N10 → §5.1.4/§5.5 (Resend via Edge Function, unsubscribe link, minors-appropriate tone, explicit P1 scope).

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────┐
│  Client (React 18 + Vite PWA, Vercel)                      │
│  ┌──────────┐ ┌───────────┐ ┌──────────────────────────┐  │
│  │ Screens   │ │ CivBear   │ │ Data layer (REBUILT)     │  │
│  │ (kept*)   │ │ (kept)    │ │ store / io / guest /     │  │
│  │ *after    │ │           │ │ migrate / events         │  │
│  │  §4.1     │ └───────────┘ └──────────────────────────┘  │
│  │  surgery) │   service worker: shell cache + Web Push    │
│  └──────────┘                                              │
└────────────────────────┬───────────────────────────────────┘
                         │ supabase-js (anon key, RLS-scoped)
┌────────────────────────┴───────────────────────────────────┐
│  Supabase                                                  │
│  Postgres (schema v2, migrations reproducible from empty)  │
│  RPC functions = ONLY write path for XP/progress/takes     │
│  Row Level Security on every table                         │
│  Edge Functions: push scheduler, event quota proxy         │
│  Auth: email+password + DOB age gate (§8)                  │
└─────────────────────────────────────────────────────────────┘
```

Deployment: GitHub → Vercel auto-deploy (production + PR previews). Two Supabase projects: `dev` (previews/CI) and `prod`.

---

## 2. Database Schema v2

### 2.1 Migration strategy (fixes M2)

The existing `001_init.sql` is **wrong relative to both the code and the live DB** (old `progress_data` shape, no `is_admin`, no `evolved_takes`). Strategy:

1. **Squash:** delete `001_init.sql`. Author a new `0001_schema_v2.sql` that creates the complete v2 schema **from empty** — this is what dev/preview/CI environments run.
2. **Repair live prod:** author `repair_prod.sql` — a one-time, hand-reviewed reconciliation script derived from a live `pg_dump --schema-only` diff against v2 (adds missing tables/columns/policies, transforms any legacy rows). Applied manually once; then `supabase migration repair` marks prod as being at 0001.
3. **Verification gate:** CI provisions a clean shadow DB, applies migrations from empty, runs the app's schema contract tests (§6) against it. A fresh `supabase db push` on a new project must yield a working app — this is tested, not assumed.
4. All subsequent changes are numbered migrations; CI greps code for column references absent from migrations.
5. **Post-repair equivalence check (N4):** after `repair_prod.sql` runs, a `pg_dump --schema-only` of prod is diffed against the CI shadow DB built from `0001` — the repair is not considered done until the diff is empty (modulo comments/ownership). Legacy prod accounts predate `birth_year`: the column is **nullable**, and a NULL value forces a one-time birth-year prompt at next login before the app proceeds (gate applies retroactively; under-13 answers handled per §8.1).

### 2.2 Tables

```sql
profiles (
  id          uuid PK REFERENCES auth.users ON DELETE CASCADE,
  username    text UNIQUE NOT NULL CHECK (char_length(username) BETWEEN 3 AND 20),
  avatar_id   int  NOT NULL DEFAULT 1 CHECK (avatar_id BETWEEN 1 AND 6),
  is_admin    boolean NOT NULL DEFAULT false,
  birth_year  int,                   -- age gate (§8); year only; NULL = legacy row,
                                     -- forces re-prompt at next login (§2.1.5)
  created_at  timestamptz NOT NULL DEFAULT now()
)
-- Created by a SECURITY DEFINER on_auth_user_created trigger (fixes m1):
-- trigger inserts profiles + default progress row from auth.users metadata
-- (username + birth_year passed via signUp options.data). No client INSERT.
-- Trigger failure handling (N7): client calls rpc.username_available(name)
-- pre-flight; the trigger itself wraps inserts in an exception handler that,
-- on collision or missing metadata, creates the profile with a placeholder
-- username + NULL birth_year and sets needs_profile_completion=true, so signup
-- never strands an auth.users row — the app shows a profile-completion screen.

progress (
  id                       uuid PK REFERENCES auth.users ON DELETE CASCADE,
  total_xp                 int  NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  streak                   int  NOT NULL DEFAULT 1 CHECK (streak >= 0),
  last_login_date          date,
  streak_freezes           int  NOT NULL DEFAULT 0 CHECK (streak_freezes BETWEEN 0 AND 1),
  streak_freeze_awarded_at date,     -- enforces 1/month award cap (fixes m2)
  imported_from_guest      boolean NOT NULL DEFAULT false,  -- analytics honesty (§4.6)
  topics                   jsonb NOT NULL DEFAULT '{}',
  opinion_builders         jsonb NOT NULL DEFAULT '{}',
  schema_version           int  NOT NULL DEFAULT 2,
  updated_at               timestamptz NOT NULL DEFAULT now()
)

evolved_takes (
  id                  bigint PK GENERATED ALWAYS AS IDENTITY,
  user_id             uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  topic_id            text NOT NULL,
  opinion_builder_id  text NOT NULL,
  cold_take           text NOT NULL CHECK (cold_take IN ('yes','no')),
  evolved_take        text NOT NULL,
  is_custom           boolean NOT NULL DEFAULT false,
  is_imported         boolean NOT NULL DEFAULT false,   -- came via guest import
  xp_earned           int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opinion_builder_id)
)

nuance_sessions (
  id          bigint PK GENERATED ALWAYS AS IDENTITY,
  user_id     uuid REFERENCES auth.users ON DELETE CASCADE,  -- NULLABLE (fixes B1)
  anon_id     text,                  -- guest identity; CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
  kind        text NOT NULL CHECK (kind IN ('baseline','day30')),
  answers     jsonb NOT NULL,        -- structured: [{question_id, response_type, position?, other_side?}]
  score       int NOT NULL,          -- computed server-side (§5.1.3 rubric)
  elapsed_days int,                  -- day30 rows: actual days since baseline
  excluded    boolean NOT NULL DEFAULT false,  -- admin flag: omit from cited aggregates (N8)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, anon_id, kind)
)

level3_content / level3_quiz          -- as v1 (P1; JSON fallback retained)
push_subscriptions                    -- as v1 (P1)
classes / class_members               -- as v1 (P2 ONLY; see §8.3)
daily_digest                          -- as v1 (P2)

xp_awards (                           -- single source of truth for XP values
  action text PK, xp int NOT NULL
)

quiz_answer_keys (                    -- seeded by CI from content JSON (§3.1)
  topic_id text, level int, answers int[] NOT NULL,
  PRIMARY KEY (topic_id, level)
)

topics_catalog (                      -- seeded by CI from content JSON (fixes m3)
  topic_id text PK, position int NOT NULL, level_count int NOT NULL
)

events (
  id          bigint PK GENERATED ALWAYS AS IDENTITY,
  user_id     uuid, anon_id text,
  name        text NOT NULL,
  props       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
)
-- Anonymous writes ONLY via rpc.log_event (SECURITY DEFINER) which enforces a
-- per-identity daily quota (e.g., 500 events) and a name allowlist (fixes m4).
-- No direct table INSERT grant for anon.
```

### 2.3 RLS Policy Matrix

| Table | anon | authenticated user | admin |
|---|---|---|---|
| profiles | — | SELECT/UPDATE own — writable columns restricted to username, avatar_id by a BEFORE UPDATE trigger (N9); birth_year settable only when NULL | SELECT all |
| progress | — | SELECT own. No direct writes — RPC only | SELECT all |
| evolved_takes | — | SELECT own. INSERT via RPC only | SELECT all |
| nuance_sessions | INSERT via RPC only (anon baseline) | SELECT own; INSERT via RPC | SELECT all |
| level3_content/quiz | SELECT where is_live | SELECT where is_live | ALL |
| push_subscriptions | — | INSERT/DELETE own | — |
| classes/class_members | — | (P2 — policies specified with the feature) | SELECT all |
| daily_digest | SELECT | SELECT | ALL |
| events | via rpc.log_event only | via rpc.log_event only | SELECT all |

Admin checks use a `SECURITY DEFINER is_admin()` helper to avoid recursive RLS on `profiles`.

---

## 3. Server-Side Integrity Layer

Clients never write `progress`, `evolved_takes`, or `nuance_sessions` directly. All completion events go through Postgres RPCs (`SECURITY DEFINER`, keyed on `auth.uid()`):

```
rpc.complete_flashcards(topic_id, level)
rpc.complete_quiz(topic_id, level, answers int[])
rpc.complete_level2(topic_id)
rpc.complete_level3_cards(topic_id)
rpc.complete_opinion_builder(ob_id, cold_take, evolved_take, is_custom)
rpc.submit_nuance_session(kind, answers jsonb)          -- authed
rpc.submit_nuance_baseline_anon(anon_id, answers jsonb) -- guests (§5.1)
rpc.submit_nuance_day30_anon(anon_id, answers jsonb)    -- guests (N1): requires an
                                                        -- existing baseline row for
                                                        -- anon_id ≥28 days old;
                                                        -- computes elapsed_days
rpc.username_available(name text)                       -- signup pre-flight (N7)
rpc.import_guest_snapshot(snapshot jsonb)               -- one-time (§4.6)
rpc.check_streak()                                      -- server clock; freeze logic
rpc.get_ob_comparison(ob_id)                            -- aggregate, n≥10 gate
rpc.log_event(name, props)                              -- quota + allowlist
rpc.delete_account()
```

Every RPC: validates state transitions against `topics_catalog` (can't complete a locked topic), is idempotent (repeats never re-award XP), reads XP values from `xp_awards`, and returns the updated progress snapshot for client reconciliation.

**Anonymous-RPC abuse controls (N8):** both anon nuance RPCs enforce IP-scoped rate limits (via `request.headers` inspection in the function) *in addition to* per-anon_id uniqueness — a regenerated anon_id doesn't buy another submission from the same address in the window. Residual pollution risk is handled at the reporting layer: the `excluded` flag lets the admin remove suspect rows, and every cited aggregate (comparison bars, funnel views, nuance deltas) filters `excluded = false`.

### 3.1 Quiz grading threat model (fixes m5)

Stated plainly: quizzes are learning aids, not assessments. `correctIndex` ships in client JSON regardless, because the spec requires instant green/coral feedback. Server grading via `quiz_answer_keys` protects exactly one thing: **XP cannot be awarded without submitting the answer vector the server grades itself** — protecting the XP economy and engagement metrics, not answer secrecy. CI seeds `quiz_answer_keys` from content JSON so there is one authoritative key.

### 3.2 Streaks

`rpc.check_streak` uses server time (device clocks untrusted). Freeze award: at 7-day milestones, only if `streak_freeze_awarded_at` is null or > 1 month old (schema-enforced cap, fixes m2). Freeze spend: automatic inside the same RPC on a missed day.

---

## 4. Client Data Layer

```
src/data-layer/
  store.js    – single progress store (context + reducer)
  io.js       – ALL supabase calls; zod validates every response; RPC wrappers
  guest.js    – versioned localStorage envelope {v:2, state}; v1 upgrader
  migrate.js  – guest→account import (§4.6)
  events.js   – batched analytics emitter
```

### 4.1 Screen surgery inventory (fixes M3)

"Kept" screens are kept **after** extraction of embedded data logic. Verified inventory of screens that currently compute XP/score or call Supabase directly — all of this logic moves to the data layer, and call signatures **change**:

| Screen | Embedded logic to extract | New surface |
|---|---|---|
| OpinionBuilderScreen | XP computation (`bonusText.length >= 50 ? 200 : 100`); direct `evolved_takes` insert; session logging | emits `onComplete(coldTake, evolvedText, isCustom)`; data layer calls RPC and returns XP for display |
| QuizScreen | score accumulation feeding client XP path | emits `onQuizComplete(answers[])`; RPC grades |
| Level3Screen | same as QuizScreen | same pattern |
| LessonScreen | `onFlashcardsComplete` triggers client XP | unchanged signature; handler now calls RPC |
| ProfileScreen | direct profile fetch + avatar update + debug logging | profile ops move to io.js (direct table ops are fine here — own-row RLS — but centralized) |
| App.jsx | client-computed XP passed through `completeOpinionBuilder(obId, coldTake, xp, take)` | XP parameter removed from all call sites |
| AdminScreen | direct table reads + client join | reads via admin SQL views (§9) |

Estimate impact: ~7 files touched beyond the data layer itself; screens remain presentation-owned but are **not** untouched. The build plan must budget for this explicitly.

### 4.2 State principles

One state shape defined once in io.js zod schemas, versioned. Server is authoritative for logged-in users: reads at login + RPC-returned snapshots after each write; optimistic UI with rollback on error.

### 4.3 Guests

Identical state shape in a versioned localStorage envelope; v1→v2 upgrade function heals existing stranded users. Guests also carry a generated `anon_id` (for anonymous baseline + events).

### 4.4 Offline posture (revised per M5)

**P0 ships retry-on-error only** — idempotent RPCs make naive retry safe; failures surface a "couldn't save, retrying" toast. The IndexedDB replay queue is **deferred to P1** and is a pure enhancement (same RPC interface). School-Wi-Fi flakiness is mitigated in P0 by single-round-trip RPCs and retry.

### 4.5 Routing

Replace `currentScreen` string with an explicit route reducer (stack + params). Push/email deep-links use `?route=` parsed at boot. Full URL routing deliberately out of scope.

### 4.6 Guest→account import (fixes M4)

The v1 "replay through the same RPCs" design was internally inconsistent (guests store a snapshot, not an event log; grading inputs don't exist). Replaced with **`rpc.import_guest_snapshot(snapshot jsonb)` — a deliberate, bounded, documented trust exception:**

- Accepts completion **flags** and evolved takes only — never XP numbers.
- Server **derives** XP from the flags via `xp_awards` (a guest snapshot can never mint more XP than the content catalog allows: hard cap = sum of all completable actions).
- Validates structure (zod-equivalent CHECKs), topic ids against `topics_catalog`, evolved-take lengths and enum values; custom takes must meet the ≥50-char rule to earn the 200-XP derivation, else scored as standard.
- Callable **once per account**, only while the progress row is at default state; sets `imported_from_guest = true` and `is_imported = true` on takes so imported data is distinguishable in every metric the application cites.
- Anonymous nuance baselines are linked by `anon_id` in the same call (B1 §5.1), preserving the user's 30-day clock.
- Residual risk accepted and documented: a motivated guest can hand-craft completion flags. Bounded impact (catalog XP cap), flagged data, and the alternative (losing all guest progress) is worse for a guest-first funnel.

---

## 5. Feature Architectures

### 5.1 Nuance Quiz — the measurement instrument (fixes B1, M7, m6)

**5.1.1 Baseline at true first session (spec §10 compliance).** The baseline quiz is offered immediately after the Welcome screen, before topic selection, for **all** users including guests — framed as "Where do you stand right now?" onboarding (5 questions, ~90 seconds, skippable but skip is tracked). This matches the spec's "administered at first session" — v1's post-quiz deferral is withdrawn (m6 resolved: no deviation).

**5.1.2 Guests included — both ends of the pair (N1).** Guest baselines go through `rpc.submit_nuance_baseline_anon`; guest **day-30 sessions go through `rpc.submit_nuance_day30_anon`** — the RPC requires an existing baseline row for that `anon_id` at least 28 days old and records `elapsed_days`, so a retained guest who never creates an account still produces a complete pair via the in-app banner. Both RPCs are IP-and-anon_id rate-limited (§3). On signup, `import_guest_snapshot` links all the user's anon rows to `user_id`. The majority-guest funnel is captured at both measurement points, not just the first.

**5.1.3 Structured scoring, not free-text heuristics (fixes M7).** The "write your own" response is replaced by a **two-field structured form**: *"Your position"* and *"The strongest point on the other side."* Scoring becomes mechanical and defensible:
- Yes/No tap = 1 point
- "It's complicated" = 2 points
- Both structured fields completed non-trivially (each ≥ 40 chars, not near-duplicates of each other by trigram similarity) = 3 points
Rubric documented in repo (`docs/NUANCE_RUBRIC.md`) with a golden set of 20 hand-scored examples as calibration fixtures run in CI against the scoring function. Admin spot-checks a 10% sample — bounded work, not an unbounded review queue; the spot-check protocol includes flagging gibberish/low-effort text for the `excluded` flag (N6, N8). Limitation (structure ≠ semantic quality) is documented; the metric's claim is "willingness and ability to articulate both sides," which field completion directly operationalizes.

**No reward attached (N6):** nuance sessions earn **zero XP, no badge, no streak credit** — stated in-product ("this one's just for you"). With no incentive, mechanical gaming has no motive; the residual risk is boredom-typing, which the spot-check + exclusion path absorbs.

**5.1.4 Day-30 recapture — multi-channel, with the assumption chain stated (N2).**
- Window: any return session at ≥ 28 days triggers the day-30 quiz (banner takes over the Home CTA slot); actual `elapsed_days` recorded. Accepting 28–60 days maximizes n honestly (elapsed days reported with results).
- Channels: (a) **email** at day 28 + day 35 to account holders — sent via an Edge Function through Resend (free tier; Supabase's built-in SMTP covers auth mail only), every message carrying an unsubscribe link and written in minors-appropriate tone (N10); (b) Web Push where granted; (c) persistent in-app banner — reaches never-converted guests, who submit via the anon day-30 RPC (§5.1.2).
- **Paired-session forecast — explicit chain, every rate stated (N2).** Let F = first-session users:
  - Baselines: F × 80% capture = 0.80F
  - Account path: F × 30% signup (spec §11 target) × 80% baseline × ~30% day-30 completion (two emails + banner to a warm, identified cohort) ≈ **0.072F pairs**
  - Guest path: F × 70% guest × 80% baseline × ~5% organic return at day 28+ (D7 target is 20%; D30 realistically 4–6%) × ~60% banner completion ≈ **0.017F pairs**
  - Total ≈ **0.09F pairs** → for ≥25 pairs, **F ≈ 280–300 first-session users by ~Sept 5.** That is the real acquisition bar, roughly double v2's estimate — stated now, in July, because it is a recruiting problem no architecture can absorb.
  - Every rate above is instrumented from day 1 (`events` → funnel views on AdminScreen). Actuals replace assumptions weekly; a shortfall is visible by early September.
- **Fallback thresholds, pre-declared:** n ≥ 25 → report the metric as designed. 10 ≤ n < 25 → report as a pilot result with confidence caveats and the full funnel disclosed. n < 10 → the application narrative reports the instrument design + funnel honestly and leans on qualitative evolved-take evidence; the paired metric is not cited as validated. Honesty about a small n is a better application story than a fudged one.

**5.1.5 Profile & admin surfaces.** Profile: "Your thinking then vs now" with per-question response movement. Admin: aggregate baseline/day30 score distributions + paired-delta view.

### 5.2 Anonymous comparison
`rpc.get_ob_comparison(ob_id)` — SECURITY DEFINER aggregate; returns null under n<10; % yes/no + evolved-take distribution. Rendered as bars on OB completion (step 8 per spec).

### 5.3 Guest→account migration — §4.6.

### 5.4 Level 3 content in Supabase (P1)
`level3_content`/`level3_quiz` with `is_live`; AdminScreen editor tab; **JSON fallback retained** on fetch failure. L3 answer keys live server-side (unlike L1, L3 quiz can be graded fully server-side since content is already remote).

### 5.5 Push notifications (P1)
Web Push/VAPID via Edge Function cron: 7pm-local streak reminder (tz offset captured at subscribe), milestones (7/30/100), content alerts. iOS limits (16.4+, installed) acknowledged; **email is the primary re-engagement channel** (5.1.4), push is additive.

### 5.6 Social sharing (P1)
Client-side `<canvas>` share card; Web Share API + clipboard fallback. No server component.

### 5.7 Streak recovery — §3.2.

### 5.8 New topics (honest version, fixes m3)
Adding a topic = content JSON + one entry in the unlock-order registry; CI re-seeds `topics_catalog` and `quiz_answer_keys`; `DEFAULT_PROGRESS` topic map is **generated from the registry** (not hand-maintained — this generation change is part of the data-layer rebuild). No screen or RPC logic changes. "Content + one registry line," not "no code changes."

### 5.9 Classroom mode (P2 only — see §8.3)
Blocked on the student-data policy work, not just engineering. Teacher accounts admin-approved manually at this scale. Aggregates via SECURITY DEFINER function; individual takes never exposed to teachers.

### 5.10 Daily digest (P2)
Admin-authored rows; Home card when today's row exists. Partnership integration out of scope.

---

## 6. Testing Strategy

| Layer | Tool | Coverage bar |
|---|---|---|
| Migrations | CI: apply from empty to shadow DB; app schema-contract tests pass against it (§2.1.3) | every merge |
| RPCs + RLS | SQL tests via supabase CLI (`db test`): happy path, idempotency, locked-state rejection, forged-input rejection, cross-user denial per policy, import-once enforcement, quota enforcement | every RPC & policy |
| Data layer | Vitest: store reducer, guest envelope v1→v2 upgrade, zod schemas, retry logic | ≥90% of data-layer |
| Nuance scoring | Golden-set calibration fixtures (20 hand-scored examples) run in CI | scoring function |
| Content | CI script: zod schema per topic JSON; answer-key + catalog seeding; L3 source-URL tier allowlist | all content files |
| E2E | Playwright (chromium+webkit): guest full topic incl. anonymous baseline; signup+import; OB completion; day-30 flow (clock-mocked); admin views | 5 journeys, nightly + pre-release |
| Screens | RTL smoke tests (render + primary interaction) | kept screens |

Definition of done for every build chunk includes its tests. No merge without green CI.

---

## 7. CI/CD & Environments

- GitHub Actions: lint → content validation/seeding → Vitest → migrations-from-empty + `db test` → build → (nightly) Playwright.
- `dev` Supabase project for previews/CI; `prod` gated on tagged release + manual `supabase db push`.
- Service-role key only in Edge Function secrets + CI; CI grep gate ensures it never enters the client bundle.
- `console.*` stripped from production via Vite `esbuild.drop`; `debug()` wrapper for dev logs. The 27 existing debug statements are removed during data-layer surgery.

---

## 8. Privacy & Safety (users are minors; fixes M6)

### 8.1 Age gate — before ALL server-side capture (N3)
A neutral birth-year screen runs in the welcome flow, **before any server-side data capture — including the anonymous guest baseline**, which stores minors' political opinions keyed to a persistent anon_id and therefore cannot sit behind a mere notice. Rules:
- Under-13 (any path, guest or signup): blocked app-wide with a friendly message; the attempt is not stored. CIVIC targets 14–18; there is no under-13 mode.
- Guests 13+: the birth year is used **client-side only** as the gate and is never transmitted or stored — a guest leaves no age record, only the gate outcome (proceed).
- Accounts: birth year (year only — minimization) stored on `profiles` at signup; legacy accounts with NULL are re-prompted at next login (§2.1.5) and settable only while NULL (§2.3).
This is the standard 13+ general-audience posture under COPPA; v1's "collect nothing" stance inverted the compliance logic and is withdrawn, and v2's account-only gate left the guest capture path open — both are corrected here.

### 8.2 Minors' political-opinion data
- Treated as sensitive by policy: private to the user; admin visibility exists for moderation and is **disclosed in-product** at the point of writing ("Visible to you and the CIVIC team").
- Privacy policy + terms pages shipped **in P0, before any real user** — plain-language, teenager-readable, covering: what's collected, admin visibility, aggregation rules (n≥10), no sale or sharing for marketing, honest disclosure of the single third-party error processor (Sentry, PII/content-scrubbed — D-003), deletion via `rpc.delete_account()`.
- Anonymous comparison data always aggregated, n≥10, no individual exposure.
- Admin screen shows usernames only, never emails.

### 8.3 Classroom mode gating
Deferred to P2 and **conditional on a documented student-data stance** (SOPIPA-class state laws apply when a product is used at a teacher's direction): manual teacher verification, no individual takes to teachers, data-handling addendum published before the feature ships. If the policy work doesn't fit the timeline, the feature stays cut — it is not on the application-narrative critical path.

---

## 9. Observability

Sentry (free tier, production only) for client errors. `events` + SQL views compute the spec §11 metrics (D1/D7 retention, OB completion, bonus-take rate, account-creation rate, **baseline-capture and day-30 funnel**) rendered on AdminScreen. The funnel view is P0 — it's how a September shortfall is caught in September (§5.1.4).

---

## 10. Phasing & Cut Lines (fixes M5)

**P0 — "Integrity + Measurement core" (target: ship by Aug 10)**
Schema v2 squash + prod repair (incl. post-repair diff gate); signup trigger + username pre-flight + age gate (guest + account); RPC core (complete_*, check_streak, import, nuance×3, username_available, log_event, delete_account); client data-layer rebuild + screen surgery (§4.1); guest envelope v2 + import; nuance **baseline** UI + rubric + calibration; privacy/terms pages; funnel views; CI (migrations-from-empty, RPC/RLS tests, content seeding); Sentry; debug-log strip. **Retry-on-error only — no offline queue.**
*Deliberately excluded from P0 (N5):* the **day-30 UI + reminder emails cannot be needed before ~Sept 28** (30 days after the first launch users), so they are P1-week-1 work by design, not a P0 slip risk. The day-30 *RPCs* ship in P0 (schema/interface complete); only their UI/email surfaces are P1.

**P0 go/no-go checkpoint — Aug 1 (N5):** if the RPC core + data-layer merge is not green in CI by Aug 1, the pre-decided descope activates: `delete_account` and `complete_level3_cards` slip to P1; anonymous-comparison prep drops from P1 to P2; Web Push is cut outright; P0 completion extends to Aug 17 with Sept 1 launch held by compressing soft-launch prep to two weeks. What never moves: age gate, privacy pages, baseline pipeline, import, funnel instrumentation.

**P1 — "Launch + re-engagement" (target: live users Sept 1)**
Deploy prod + soft launch; **day-30 UI + email re-engagement via Resend Edge Function (day-28/35, unsubscribe link)**; Web Push; anonymous comparison; L3-in-Supabase + admin editor; social sharing; streak freeze; IndexedDB offline queue; Playwright suite complete.

**P2 — post-launch (Sept–Oct, cuttable without touching the application narrative)**
Classroom mode (conditional, §8.3); daily digest; new topics; nuance day-30 admin analytics polish.

**Named cut lines if behind on Aug 15:** cut Web Push (email remains), cut L3 CMS (JSON remains), cut sharing, cut offline queue. **Never cut:** age gate, privacy pages, nuance pipeline, import, funnel instrumentation — these are the application story.

User-acquisition bar (from §5.1.4 assumption chain): **~280–300 first-session users by ~Sept 5** — a real-world recruiting task for the owner (school clubs, teachers, community) that no architecture can substitute for; flagged as the plan's largest non-engineering risk, with pre-declared fallback reporting thresholds if missed (§5.1.4).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Live prod DB state differs from assumptions | `repair_prod.sql` authored from live `pg_dump --schema-only`, hand-reviewed; migrations verified from empty in CI |
| Day-30 sample shortfall | Multi-channel recapture incl. guest day-30 RPC; 28–60-day window; funnel visible from day 1; acquisition bar stated (~300 users); pre-declared fallback thresholds at n≥25 / 10–24 / <10 (§5.1.4) |
| Guest import forgeable | Bounded (catalog XP cap), one-shot, flagged `imported_from_guest`; documented trust exception |
| Nuance metric construct validity challenged | Structured two-field capture; public rubric + golden-set calibration; limitation documented |
| Solo owner + agent merge conflicts | Build plan enforces per-chunk file ownership (BUILD_PLAN) |
| Legal exposure (minors) | Age gate, disclosure, privacy pages in P0; classroom gated on policy work |
| Timeline | P0/P1/P2 with named cut lines; offline queue and all P2 items off the critical path |

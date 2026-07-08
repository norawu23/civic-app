# WS-B RPC signature contract — Fri Jul 10 interface freeze

**Status: FROZEN 2026-07-10** (authored 2026-07-08, operator). Decision record: D-010.
**Basis:** ARCHITECTURE.md v3.2 §3/§3.1/§3.2/§5.1/§5.2 · decisions.md D-001, D-008 (§4, nuance `answers` shape), D-009 · `supabase/migrations/0001_schema.sql` (the `progress` columns ARE the snapshot) · `docs/specs/C1-guest-envelope-v2.md` (import input shape) · BUILD_PLAN §3 (B1–B5) · WS-B-signature-freeze-brief.md.

This document freezes the **interface** of every WS-B RPC: names, params, return shapes, and the error convention. It is what C2 builds stubs against and what B1–B5 implement to. Full per-chunk DoD/test specs follow in W2 (BUILD_PLAN §1a); nothing in them may contradict this contract. Post-freeze changes are decisions.md events.

Two deliberate deviations from the §3 list, both operator rulings recorded in D-010: `check_streak` gains a `tz_offset_minutes` param (§4 below), and `submit_nuance_session.kind` is frozen to two values, not three (§5 below).

---

## 1. Conventions (apply to every RPC below)

1. **SQL surface.** Every function lives in schema `public`, is `SECURITY DEFINER` with `set search_path = public, pg_temp`, and carries an explicit `grant execute` to exactly the audience listed per RPC (`authenticated`, or `anon, authenticated`) — matching the merged `0002` convention (`username_available`). Client calls go through `supabase.rpc('<name>', {...})` wrappers in `io.js` only (D-008 §4).
2. **Return type.** Every WS-B RPC `returns jsonb` — a single JSON object, exactly one of the shapes in §3. No RPC returns void, a bare scalar, or `null`. Gated/empty results are explicit shapes, never null. (`username_available` predates this and keeps its merged `returns boolean` — already built in `0002`; referenced here, not re-frozen.)
3. **Validation.** `io.js` zod-validates every return against these shapes; the snapshot schema is defined **once** and reused (§2). A shape mismatch is a client-side `internal` error, not something screens improvise around.
4. **Idempotency is visible, not implied.** Award RPCs are idempotent (§3: repeats never re-award). A replay is a **success** carrying `xp_awarded: 0` — never an error. The client distinguishes "just earned" from "already done" by reading `xp_awarded`, not by inferring from errors.
5. **Errors.** One convention, §6. Success bodies never carry an `error` key; failures are always exceptions (non-2xx through PostgREST), so retry-on-error and optimistic rollback (§4.4, C2) key off one signal.
6. **XP values** come from `xp_awards` at execution time (§3); the amounts are reference data, not part of this contract.

---

## 2. Canonical `progress_snapshot` type

Defined once, returned by **every RPC that writes the `progress` row**. One zod schema in `io.js`; per D-008 §4 these returns are the *only* way the client learns XP/progress state — `check_streak`'s return doubles as the login bootstrap read.

```ts
progress_snapshot = {
  total_xp:          int,              // ≥ 0
  streak:            int,              // ≥ 0
  streak_freezes:    int,              // 0 | 1
  last_login_date:   string | null,    // 'YYYY-MM-DD' (user-local date per D-001)
  tz_offset_minutes: int,              // -840 … 840 (D-001)
  topics:            object,           // per-topic completion flags (jsonb, shape per C2/registry)
  opinion_builders:  object,           // per-OB completion flags (jsonb)
  schema_version:    int,              // snapshot versioning — a future change is client-detectable
  updated_at:        string            // ISO 8601 timestamptz
}
```

**Column audit vs `0001.progress`** (the freeze-brief's "confirm exact set"): all `progress` columns are included **except** —

- `id` — it is the caller's own `auth.uid()`; echoing it adds nothing.
- `streak_freeze_awarded_at` — internal 1/month award-cap bookkeeping (§3.2); no screen renders it.
- `imported_from_guest` — analytics-honesty flag (§4.6); read by admin views, not by the client (which performed the import and already knows).

Adding a field to the snapshot later is a decisions.md event and a `schema_version` bump consideration; removing or retyping one post-freeze is a breaking change and requires the same.

---

## 3. Return shapes

Three shapes cover every WS-B RPC. No chunk invents its own.

**S1 — progress envelope** (RPCs that write `progress`):

```ts
{ snapshot: progress_snapshot, xp_awarded: int /* ≥ 0; 0 on replay */, ...addendum }
```

Addenda are small, typed, per-RPC (listed in §4), e.g. `complete_quiz`'s `n_correct`. Nesting the snapshot (rather than flattening) keeps one reusable zod schema and makes field collisions impossible.

**S2 — ack** (RPCs that write something *other than* `progress`, or nothing the client may read):

```ts
{ accepted: true }        // nuance submissions, log_event
{ deleted:  true }        // delete_account
```

Acks are deliberately information-free. For the nuance RPCs this is structural enforcement of the ratified no-score-shown stance (D-010): the score has **no client-facing return path at all** — it is computed server-side, stored, and readable solely via G2's admin views. A careless field add cannot regress "we don't show the score."

**S3 — gated aggregate** (`get_ob_comparison` only):

```ts
// n < 10  (§5.2 privacy gate — no distribution leaves the server)
{ n: int, gated: true }

// n ≥ 10
{ n: int, gated: false,
  cold:         { yes: int, no: int },          // counts; client renders %
  evolved:      [ { take: string, count: int } ], // preset takes, grouped by exact text
  custom_count: int }                            // is_custom takes, one bucket, never text
```

Custom take **text is never returned** — only its count. Counts (not percentages) are frozen so the client's rendering math is its own business and `n` stays honest.

---

## 4. The RPCs

### B1 — L1 grading

| | |
|---|---|
| `complete_flashcards(topic_id text, level int)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `complete_quiz(topic_id text, level int, answers int[])` | → S1 `{ snapshot, xp_awarded, n_correct: int }`. Grant: `authenticated`. |

- `complete_quiz` grades **all** quiz levels, including L3 (D-001 — `complete_level3_quiz` does not exist).
- `xp_awarded` includes any perfect-score bonus earned by *this* call.
- **No per-question correctness vector is returned.** Green/coral feedback is already local (client JSON ships `correctIndex`, §3.1); echoing per-question results would leak the server-side key path for nothing. `n_correct` supports the score summary; that is all.

### B2 — Progression + streak

| | |
|---|---|
| `complete_level2(topic_id text)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `complete_level3_cards(topic_id text)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `check_streak(tz_offset_minutes int)` | → S1 `{ snapshot, streak_event }` (no `xp_awarded` — streaks award none). Grant: `authenticated`. |

- **`check_streak` param — operator amendment to §3's zero-param signature (D-010).** D-001 requires the stored `tz_offset_minutes` to be "refreshed on every app load from the client," and A3's RLS leaves **no direct write path** to `progress` — so the offset must ride an RPC, and it must arrive *with* the streak check (evaluating the day boundary against a stale offset at exactly the moment it matters is wrong). The client passes `new Date().getTimezoneOffset()`-derived minutes on every call; the server **clamps** to ±840 (never errors on out-of-range) and persists it before computing the user-local date from server `now()`. Device clock is never an input.
- `streak_event: 'started' | 'same_day' | 'extended' | 'freeze_spent' | 'reset'` — makes the freeze-spend observable (D* screens show "streak freeze used!") instead of forcing the client to diff snapshots it may not have (first call of a session *is* the bootstrap read). Exact transition semantics are B2's W2 spec; the enum is frozen.

### B3 — Opinion builder + comparison

| | |
|---|---|
| `complete_opinion_builder(ob_id text, cold_take text, evolved_take text, is_custom boolean)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `get_ob_comparison(ob_id text)` | → S3. Grant: `anon, authenticated`. |

- `cold_take ∈ {'yes','no'}` (per the `evolved_takes` CHECK).
- `xp_awarded` covers base + ≥50-char bonus for this call as one number (100 / 300 / 0 on replay). The bonus threshold lives server-side; the client never computes XP (§4.1).
- `get_ob_comparison` **moves into B3's chunk** (D-010): completion and comparison are one feature — the bars render on OB completion (§5.2 step 8). It is WS-B's only read-only RPC and its only anon-callable non-nuance RPC (guests complete OBs locally and still see the aggregate). Grows B3 slightly; accepted.

### B4 — Nuance instrument

| | |
|---|---|
| `submit_nuance_session(kind text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `authenticated`. |
| `submit_nuance_baseline_anon(anon_id text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `anon, authenticated`. |
| `submit_nuance_day30_anon(anon_id text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `anon, authenticated`. |

- **`kind ∈ {'baseline','day30'}` — frozen at two values (D-010),** correcting the freeze brief's three-value list: `0001`'s CHECK admits exactly these two, the `unique nulls not distinct (user_id, anon_id, kind)` constraint structurally precludes a repeatable third kind, and no third session exists anywhere in §5.1's design. Widening later is an ordinary additive migration + decisions.md event.
- `answers` is the **D-008 frozen shape** — `[{question_id, response_type, position?, other_side?}]` — referenced, not redefined here. The E1 trigram threshold inside scoring ratifies separately per D-005 §4 (Jul 13) and does not touch these signatures.
- **Returns are ack-only — ratified by Nora 2026-07-08: no score is ever shown after the questionnaire** (zero-reward framing, §5.1.3/N6; a visible score invites gaming and pollutes the 30-day delta). Score, `elapsed_days`, everything measured: server-side only, admin-readable via G2. The ack shape is identical across all three so no wrapper can leak by variance.
- Rate limiting (N8/[r5]) and the linked-anon-id rejection [r2] surface through the §6 error codes; limits/thresholds are B4 implementation, not interface.

### B5 — Import, events, deletion

| | |
|---|---|
| `import_guest_snapshot(snapshot jsonb)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `log_event(name text, props jsonb)` | → S2 `{ accepted: true }`. Grant: `anon, authenticated`. |
| `delete_account()` | → S2 `{ deleted: true }`. Grant: `authenticated`. |

- `import_guest_snapshot`'s input is the **C1 envelope v2 `state`** (flags + evolved takes + `anon_id` for baseline linking — never XP numbers; server derives XP per §4.6). `xp_awarded` = total derived XP, which is C3's "confirmed success" signal. One-shot semantics surface as errors (§6), not silent no-ops — a guest's data silently not importing is exactly the failure C3's UX must show.
- `log_event`: allowlist + quota violations are errors (§6); *whether* the client toasts on an analytics failure is C2 policy (it shouldn't), but the contract reports honestly.
- `delete_account` returns `{ deleted: true }` after full cascade; there is deliberately no snapshot to return.

### Already merged — referenced, not re-frozen

`username_available(name text) returns boolean` — built in `0002` (A2), case-sensitive exact match per D-008 §1.

---

## 5. Freeze inventory (one line per RPC)

| RPC | Params | Returns | Grant | Chunk |
|---|---|---|---|---|
| `complete_flashcards` | `topic_id text, level int` | S1 | authenticated | B1 |
| `complete_quiz` | `topic_id text, level int, answers int[]` | S1 + `n_correct` | authenticated | B1 |
| `complete_level2` | `topic_id text` | S1 | authenticated | B2 |
| `complete_level3_cards` | `topic_id text` | S1 | authenticated | B2 |
| `check_streak` | `tz_offset_minutes int` | S1 + `streak_event`, no `xp_awarded` | authenticated | B2 |
| `complete_opinion_builder` | `ob_id text, cold_take text, evolved_take text, is_custom boolean` | S1 | authenticated | B3 |
| `get_ob_comparison` | `ob_id text` | S3 | anon, authenticated | B3 |
| `submit_nuance_session` | `kind text, answers jsonb` | S2 `accepted` | authenticated | B4 |
| `submit_nuance_baseline_anon` | `anon_id text, answers jsonb` | S2 `accepted` | anon, authenticated | B4 |
| `submit_nuance_day30_anon` | `anon_id text, answers jsonb` | S2 `accepted` | anon, authenticated | B4 |
| `import_guest_snapshot` | `snapshot jsonb` | S1 | authenticated | B5 |
| `log_event` | `name text, props jsonb` | S2 `accepted` | anon, authenticated | B5 |
| `delete_account` | — | S2 `deleted` | authenticated | B5 |

---

## 6. Error convention

The gap §3 omits entirely; C2's "typed error surface for screens" depends on it.

**Mechanism (frozen):** an RPC failure is a Postgres exception —

```sql
raise exception using message = '<error_code>', detail = '<human-readable context>';
```

- `message` carries **exactly one snake_case code token** from the registry below — nothing else, no interpolated values (those go in `detail`).
- PostgREST surfaces this as HTTP 400 with the code in the body's `message`; supabase-js exposes it as `error.message`. `io.js` maps the token to a typed error via one zod enum; any unrecognized token or non-RPC failure maps to `internal`. Screens consume typed errors only — no screen ever parses error strings.
- Expected domain states are raised as registry codes. Unexpected internals (constraint violations the RPC didn't anticipate, etc.) are **not** caught-and-translated — they bubble raw and the client maps them to `internal`. No RPC ever signals failure via a 200-response `{error: ...}` body.
- `detail` must never contain user-written content (it can reach logs/Sentry; G3's scrubber is the backstop, not the license).

**Code registry (frozen; additions are decisions.md events):**

| Code | Meaning | Raised by |
|---|---|---|
| `not_authenticated` | `auth.uid()` is null on an authenticated-only RPC | all authenticated-grant RPCs |
| `invalid_params` | param fails structural validation (bad enum value, malformed jsonb, empty text, bad `level`) | all |
| `unknown_topic` | `topic_id` not in `topics_catalog` | B1, B2 |
| `locked_topic` | topic not yet unlocked for this user (§3 state-transition check) | B1, B2, B3 |
| `invalid_answers` | `answers` fails shape/length checks (vector length ≠ key length; nuance jsonb malformed vs D-008 shape) | B1, B4 |
| `unknown_ob` | `ob_id` unknown | B3 |
| `rate_limited` | IP/anon-id rate limit hit (N8, [r5]) | B4 anon RPCs |
| `anon_id_linked` | `anon_id` already linked to an account ([r2]) | B4 anon RPCs |
| `duplicate_submission` | a row of this `kind` already exists for this identity (`0001` unique constraint) | B4 |
| `baseline_missing` | day-30 submitted with no baseline row for this identity | B4 |
| `baseline_too_recent` | baseline exists but is < 28 days old (§5.1.2) | B4 |
| `already_imported` | second `import_guest_snapshot` call (§4.6 one-shot) | B5 |
| `progress_not_empty` | progress row not at default state — import refused (§4.6) | B5 |
| `invalid_snapshot` | envelope fails structural/content validation (bad topic ids, take shapes, enum values) | B5 |
| `event_not_allowed` | event name not on the allowlist | B5 `log_event` |
| `event_quota_exceeded` | per-identity daily quota hit | B5 `log_event` |

**Not errors:** replays of award RPCs (success, `xp_awarded: 0` — §1.4) · out-of-range `tz_offset_minutes` (clamped, §4/B2) · `get_ob_comparison` under the n-gate (success, `{n, gated: true}`).

---

## 7. Consumers

- **C2** builds `io.js` RPC wrappers + zod schemas (one `progress_snapshot` schema, S1/S2/S3 envelopes, the error-code enum) and stubs every RPC above until B* lands. C2 needs no separate spec in this batch — it rides entirely on this contract (ratified 2026-07-08).
- **B1–B5 builders** implement to this contract; their W2 chunk specs add DoD/tests but cannot alter names, params, return shapes, grants, or error codes without a decisions.md event.
- **D\*/E2 screens** consume typed errors and snapshot fields only — never raw error strings, never direct `progress` SELECTs (D-008 §4).
- **G2** is the only read path for nuance scores (admin views); nothing here returns one.

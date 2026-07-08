# WS-B RPC signature contract — Fri Jul 10 interface freeze

**Status: FROZEN 2026-07-10** (authored 2026-07-08, operator; independently adversarial-reviewed same day — an Opus reviewer with no authorship context, verdict folded in). Decision records: D-010 (contract) + D-011 (review rulings).
**Basis:** ARCHITECTURE.md v3.2 §3/§3.1/§3.2/§5.1/§5.2 · decisions.md D-001, D-008 (§4, nuance `answers` shape), D-009 · `supabase/migrations/0001_schema.sql` (the `progress` columns ARE the snapshot) · `docs/specs/C1-guest-envelope-v2.md` (import input shape) · BUILD_PLAN §3 (B1–B5) · WS-B-signature-freeze-brief.md.

This document freezes the **interface** of every WS-B RPC: names, params, return shapes, and the error convention. It is what C2 builds stubs against and what B1–B5 implement to. Full per-chunk DoD/test specs follow in W2 (BUILD_PLAN §1a); nothing in them may contradict this contract. Post-freeze changes are decisions.md events.

Three deliberate deviations from the §3 list, all operator rulings: `check_streak` gains a `tz_offset_minutes` param (D-010), `submit_nuance_session.kind` is frozen to two values, not three (D-010), and `complete_opinion_builder` gains a leading `topic_id` param (D-011 — the §3 signature could not populate a NOT NULL column). The adversarial review's remaining rulings (import input = full C1 envelope, replay-idempotency for nuance/import, nuance-score RLS caveat + B4 masking migration, anon-only grants on the anon RPCs) are D-011.

---

## 1. Conventions (apply to every RPC below)

1. **SQL surface.** Every function lives in schema `public`, is `SECURITY DEFINER` with `set search_path = public, pg_temp`, and carries an explicit `grant execute` to exactly the audience listed per RPC (`authenticated`, or `anon, authenticated`) — matching the merged `0002` convention (`username_available`). Client calls go through `supabase.rpc('<name>', {...})` wrappers in `io.js` only (D-008 §4).
2. **Return type.** Every WS-B RPC `returns jsonb` — a single JSON object, exactly one of the shapes in §3. No RPC returns void, a bare scalar, or `null`. Gated/empty results are explicit shapes, never null. (`username_available` predates this and keeps its merged `returns boolean` — already built in `0002`; referenced here, not re-frozen.)
3. **Validation.** `io.js` zod-validates every return against these shapes; the snapshot schema is defined **once** and reused (§2). A shape mismatch is a client-side `internal` error, not something screens improvise around.
4. **Idempotency is visible, not implied — and covers lost-ack retries.** Award RPCs are idempotent (§3: repeats never re-award). A replay is a **success** carrying `xp_awarded: 0` — never an error. The same rule extends to the unique-write RPCs (D-011): resubmitting a nuance session of an existing `kind` acks `{accepted: true}` without writing, and re-calling `import_guest_snapshot` after a completed import returns S1 with `xp_awarded: 0`. Rationale: §4.4's P0 offline posture is *naive retry* — a committed write whose HTTP response was dropped (school Wi-Fi) will be retried verbatim, and that retry must not surface a failure toast (or, for C3, a retry-loop that never clears the guest envelope). The client distinguishes "just earned" from "already done" by reading `xp_awarded`, not by inferring from errors.
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
  topics:            object,           // per-topic completion flags (jsonb) — shape pinned below
  opinion_builders:  object,           // per-OB completion flags (jsonb) — shape pinned below
  schema_version:    int,              // snapshot versioning — a future change is client-detectable
  updated_at:        string            // ISO 8601 timestamptz
}
```

**Column audit vs `0001.progress`** (the freeze-brief's "confirm exact set"): all `progress` columns are included **except** —

- `id` — it is the caller's own `auth.uid()`; echoing it adds nothing.
- `streak_freeze_awarded_at` — internal 1/month award-cap bookkeeping (§3.2); no screen renders it.
- `imported_from_guest` — analytics-honesty flag (§4.6); read by admin views, not by the client (which performed the import and already knows).

**Flag-map shape (D-011):** `topics` and `opinion_builders` are not free-form objects — their key/flag structure is the **registry-generated `DEFAULT_PROGRESS` shape** (D-005 §3, §5.8), the same per-topic flags shape C1's envelope v2 `state` carries (C1 spec, frozen alongside this contract on Jul 10). B* writers and C2's reconciler implement to that one shape; a key-name divergence between them is a contract violation even though a bare-`object` zod check would pass it.

Adding a field to the snapshot later is a decisions.md event and a `schema_version` bump consideration; removing or retyping one post-freeze is a breaking change and requires the same.

---

## 3. Return shapes

Three shapes cover every WS-B RPC. No chunk invents its own.

**S1 — progress envelope** (RPCs that write `progress`):

```ts
{ snapshot: progress_snapshot, xp_awarded: int /* ≥ 0; 0 on replay */, ...addendum }
```

`xp_awarded` is present on **every** S1 return — including `check_streak`, where it is constantly `0` (streaks award no XP) — so C2 keeps exactly one S1 zod schema with no per-RPC field-presence special cases (D-011). Addenda are small, typed, per-RPC (listed in §4), e.g. `complete_quiz`'s `n_correct`. Nesting the snapshot (rather than flattening) keeps one reusable zod schema and makes field collisions impossible.

**S2 — ack** (RPCs that write something *other than* `progress`, or nothing the client may read):

```ts
{ accepted: true }        // nuance submissions, log_event
{ deleted:  true }        // delete_account
```

Acks are deliberately information-free. For the nuance RPCs this enforces the ratified no-score-shown stance (D-010) on the **RPC return path**: the score is computed server-side, stored, and never returned. A careless field add cannot regress it *here*.

**Honest caveat + closure (D-011, from the adversarial review):** the RPC path is not the only path. Merged `0003` grants authenticated users own-row SELECT on `nuance_sessions`, and Supabase's default table grants include the `score` and `elapsed_days` columns — so today, non-exposure rests on client discipline (io.js never selecting those columns), not structure. **B4's chunk therefore includes a migration replacing the table-wide SELECT grant on `nuance_sessions` with a column-list grant excluding `score` and `elapsed_days`** (own-row `answers`/`kind`/`created_at` remain readable — §5.1.5's "then vs now" needs them). After that migration the no-score stance is structural in both paths. This is a grant change layered on `0003`'s policies, not a policy edit; it rides B4's migration file.

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
- `complete_flashcards.level` domain: a level that carries a flashcard set per the content catalog — in P0 that is `1` only (L2/L3 card reads have dedicated RPCs); any other value is `invalid_params`. The param stays so P1 content growth doesn't need a signature change.
- `xp_awarded` includes any perfect-score bonus earned by *this* call.
- **No per-question correctness vector is returned.** Green/coral feedback is already local (client JSON ships `correctIndex`, §3.1); echoing per-question results would leak the server-side key path for nothing. `n_correct` supports the score summary; that is all.

### B2 — Progression + streak

| | |
|---|---|
| `complete_level2(topic_id text)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `complete_level3_cards(topic_id text)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `check_streak(tz_offset_minutes int)` | → S1 `{ snapshot, xp_awarded: 0, streak_event, freeze_awarded: boolean }`. Grant: `authenticated`. |

- **`check_streak` param — operator amendment to §3's zero-param signature (D-010).** D-001 requires the stored `tz_offset_minutes` to be "refreshed on every app load from the client," and A3's RLS leaves **no direct write path** to `progress` — so the offset must ride an RPC, and it must arrive *with* the streak check (evaluating the day boundary against a stale offset at exactly the moment it matters is wrong). The client passes `new Date().getTimezoneOffset()`-derived minutes on every call; the server **clamps** to ±840 (never errors on out-of-range) and persists it before computing the user-local date from server `now()`. Device clock is never an input.
- `streak_event: 'started' | 'same_day' | 'extended' | 'freeze_spent' | 'reset'` — makes the freeze-spend observable (D* screens show "streak freeze used!") instead of forcing the client to diff snapshots it may not have (first call of a session *is* the bootstrap read). Exact transition semantics are B2's W2 spec; the enum is frozen.
- `freeze_awarded: boolean` (D-011) — a 7-day-milestone freeze *award* (§3.2) co-occurs with `streak_event: 'extended'`, so it cannot be an enum value; the boolean makes "streak freeze earned!" observable by the same argument as `freeze_spent`. `false` on every call that awards nothing.

### B3 — Opinion builder + comparison

| | |
|---|---|
| `complete_opinion_builder(topic_id text, ob_id text, cold_take text, evolved_take text, is_custom boolean)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `get_ob_comparison(ob_id text)` | → S3. Grant: `anon, authenticated`. |

- **`topic_id` param — operator amendment to §3's four-param signature (D-011).** `evolved_takes.topic_id` is NOT NULL (`0001`), the merged schema has **no** OB→topic mapping table, and OB ids do not embed topic ids (`tax-ob-01` vs `taxes`) — §3's signature literally cannot populate the column, nor run the `locked_topic` unlock check. The client always has the topic in hand (C1's envelope stores it on every evolved take; the OB screen lives inside a topic). Server validates the (`topic_id`, `ob_id`) pair.
- `cold_take ∈ {'yes','no'}` (per the `evolved_takes` CHECK).
- `ob_id` validation (`unknown_ob`, the required-before-optional ordering, the pair check above) needs a server-side OB registry seeded from content JSON — a small B3 migration + H1-seeder extension, flagged as a schema dependency in D-011. Without it a forged `ob_id` would mint unbounded XP (the per-`ob_id` uniqueness constraint is no cap on invented ids).
- `xp_awarded` covers base + ≥50-char bonus for this call as one number (100 / 300 / 0 on replay). The bonus threshold lives server-side; the client never computes XP (§4.1).
- `get_ob_comparison` **moves into B3's chunk** (D-010): completion and comparison are one feature — the bars render on OB completion (§5.2 step 8). It is WS-B's only read-only RPC and its only anon-callable non-nuance RPC (guests complete OBs locally and still see the aggregate). Grows B3 slightly; accepted.
- `get_ob_comparison` on an unknown `ob_id` returns `{ n: 0, gated: true }`, not an error (D-011) — the gated shape is already the "nothing to show" state, and not erroring avoids turning the RPC into a catalog-enumeration oracle. `unknown_ob` is raised only by `complete_opinion_builder`, where accepting a bad id would write junk.

### B4 — Nuance instrument

| | |
|---|---|
| `submit_nuance_session(kind text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `authenticated`. |
| `submit_nuance_baseline_anon(anon_id text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `anon` only. |
| `submit_nuance_day30_anon(anon_id text, answers jsonb)` | → S2 `{ accepted: true }`. Grant: `anon` only. |

- **`kind ∈ {'baseline','day30'}` — frozen at two values (D-010),** correcting the freeze brief's three-value list: `0001`'s CHECK admits exactly these two, the `unique nulls not distinct (user_id, anon_id, kind)` constraint structurally precludes a repeatable third kind, and no third session exists anywhere in §5.1's design. Widening later is an ordinary additive migration + decisions.md event.
- `answers` is the **D-008 frozen shape** — `[{question_id, response_type, position?, other_side?}]` — referenced, not redefined here. The E1 trigram threshold inside scoring ratifies separately per D-005 §4 (Jul 13) and does not touch these signatures.
- **Returns are ack-only — ratified by Nora 2026-07-08: no score is ever shown after the questionnaire** (zero-reward framing, §5.1.3/N6; a visible score invites gaming and pollutes the 30-day delta). Score, `elapsed_days`, everything measured: admin-readable via G2 only. The ack shape is identical across all three so no wrapper can leak by variance. The RPC path enforces this; the own-row SELECT path is closed by B4's column-grant migration (§3/S2 caveat).
- **Resubmission of an existing (identity, `kind`) is an idempotent success** — `{accepted: true}`, no write, no error (D-011; see §1.4's lost-ack rationale). B4 must pre-check and short-circuit rather than let the `0001` unique constraint raise (a raw `23505` would surface as `internal`). The UI prevents deliberate retakes; the wire may retry.
- **Anon grants are `anon` only (D-011),** tightened from the `0002` both-roles convention: §5.1.2 scopes these to guests, an authed user has the `submit_nuance_session` path, and the narrower grant removes a pointless unlinked-row minting surface in a minors' app. `username_available` and `log_event` keep `anon, authenticated` — both genuinely serve both audiences.
- Rate limiting (N8/[r5]) and the linked-anon-id rejection [r2] surface through the §6 error codes; limits/thresholds are B4 implementation, not interface.

### B5 — Import, events, deletion

| | |
|---|---|
| `import_guest_snapshot(snapshot jsonb)` | → S1 `{ snapshot, xp_awarded }`. Grant: `authenticated`. |
| `log_event(name text, props jsonb)` | → S2 `{ accepted: true }`. Grant: `anon, authenticated`. |
| `delete_account()` | → S2 `{ deleted: true }`. Grant: `authenticated`. |

- **`snapshot` = the entire C1 envelope v2** — `{v, anon_id, created_at, state}` — **not** the `state` alone (D-011, review BLOCKER). `anon_id` lives at the envelope's *top level* (C1 spec), and it is load-bearing: §4.6 links the guest's anonymous nuance baselines by `anon_id` in this same call, preserving the 30-day clock. Passing only `state` would silently break that linking. B5 reads `snapshot.anon_id` + `snapshot.state.{topics, opinion_builders, evolved_takes}` and **ignores `snapshot.state.total_xp`** — XP is derived server-side from flags via `xp_awards`, never trusted from the envelope (§4.6). `xp_awarded` = total derived XP, C3's "confirmed success" signal.
- **Replay is an idempotent success (D-011):** if this account already imported (`progress.imported_from_guest = true`), return S1 with `xp_awarded: 0` — the lost-ack retry case C3's "envelope cleared only on confirmed success" loop depends on. Precedence: already-imported success is checked **before** the `progress_not_empty` error, which is reserved for the genuine refusal (never imported, but progress is no longer default from real play — §4.6's one-shot condition). Real validation failures error per §6; a guest's data silently not importing is exactly the failure C3's UX must show.
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
| `check_streak` | `tz_offset_minutes int` | S1 (`xp_awarded: 0`) + `streak_event` + `freeze_awarded` | authenticated | B2 |
| `complete_opinion_builder` | `topic_id text, ob_id text, cold_take text, evolved_take text, is_custom boolean` | S1 | authenticated | B3 |
| `get_ob_comparison` | `ob_id text` | S3 | anon, authenticated | B3 |
| `submit_nuance_session` | `kind text, answers jsonb` | S2 `accepted` | authenticated | B4 |
| `submit_nuance_baseline_anon` | `anon_id text, answers jsonb` | S2 `accepted` | anon | B4 |
| `submit_nuance_day30_anon` | `anon_id text, answers jsonb` | S2 `accepted` | anon | B4 |
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
| `not_authenticated` | `auth.uid()` is null on an authenticated-only RPC. **Defensive-only (D-011):** in practice an anon caller is stopped by the missing `grant execute` before the body runs (surfacing as `internal`), and a valid authenticated request always has a uid — session expiry is detected client-side via supabase-js auth state, not this code. Kept as a belt-and-suspenders guard inside every authed function body. | all authenticated-grant RPCs |
| `invalid_params` | a param is the wrong **type/arity** for the signature: bad enum value, non-array where `int[]` expected, jsonb that isn't an object/array of the required kind, empty text, `level` outside the frozen domain | all |
| `unknown_topic` | `topic_id` not in `topics_catalog` | B1, B2, B3 |
| `locked_topic` | topic not yet unlocked for this user (§3 state-transition check) | B1, B2, B3 |
| `invalid_answers` | a well-formed `answers` value whose **content/length** is wrong: vector length ≠ key length (B1); D-008-shape field violations inside the array (B4). Type-level breakage is `invalid_params`; the two never overlap (D-011). | B1, B4 |
| `unknown_ob` | `ob_id` unknown / not paired with `topic_id` | B3 `complete_opinion_builder` only |
| `rate_limited` | IP/anon-id rate limit hit (N8, [r5]) | B4 anon RPCs |
| `anon_id_linked` | `anon_id` already linked to an account ([r2]) | B4 anon RPCs |
| `baseline_missing` | day-30 submitted with no baseline row for this identity | B4 |
| `baseline_too_recent` | baseline exists but is < 28 days old (§5.1.2) | B4 |
| `progress_not_empty` | never imported, but progress row not at default state — import refused (§4.6); checked **after** the already-imported idempotent-success case | B5 |
| `invalid_snapshot` | envelope fails structural/content validation (bad topic ids, take shapes, enum values) | B5 |
| `event_not_allowed` | event name not on the allowlist | B5 `log_event` |
| `event_quota_exceeded` | per-identity daily quota hit | B5 `log_event` |

**Not errors (D-011 expanded the list):** replays of award RPCs (success, `xp_awarded: 0` — §1.4) · nuance resubmission of an existing (identity, `kind`) (success, `{accepted: true}`) · `import_guest_snapshot` after a completed import (success, `xp_awarded: 0`) · out-of-range `tz_offset_minutes` (clamped, §4/B2) · `get_ob_comparison` under the n-gate **or on an unknown `ob_id`** (success, `{n, gated: true}`). `duplicate_submission` and `already_imported` were removed from the registry when those states were reclassified as idempotent successes.

---

## 7. Consumers

- **C2** builds `io.js` RPC wrappers + zod schemas (one `progress_snapshot` schema, S1/S2/S3 envelopes, the error-code enum) and stubs every RPC above until B* lands. C2 needs no separate spec in this batch — it rides entirely on this contract (ratified 2026-07-08).
- **B1–B5 builders** implement to this contract; their W2 chunk specs add DoD/tests but cannot alter names, params, return shapes, grants, or error codes without a decisions.md event.
- **D\*/E2 screens** consume typed errors and snapshot fields only — never raw error strings, never direct `progress` SELECTs (D-008 §4).
- **G2** is the only intended read path for nuance scores (admin views); nothing here returns one, and B4's column-grant migration (§3/S2) closes the own-row SELECT path so the stance is structural, not disciplinary.

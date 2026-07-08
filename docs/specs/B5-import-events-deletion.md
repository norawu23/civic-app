# Chunk spec B5 — Import + events + deletion RPCs

**Workstream:** WS-B (RPC layer) · **Estimate:** 2 bd · **Review tier:** 1 (integrity — adversarial second pass; carries the §4.6 trust exception and the deletion promise)
**Issued:** 2026-07-08 (batch 2) · **Basis:** docs/specs/WS-B-signatures.md (FROZEN, D-010 + D-011 — incl. ruling 1: input = ENTIRE C1 envelope; ruling 4: replay idempotency); ARCHITECTURE.md v3.2 §4.6, §2.2 (events comment block), §8.2 (deletion); docs/specs/C1-guest-envelope-v2.md + merged `src/data-layer/guest.js` (the envelope you parse); BUILD_PLAN.md §3 B5 `[P-8]` `[r7]`; migrations 0001–0003; **D-012** (batch-2 rulings incl. the events allowlist)
**Start:** Mon Jul 13 (W2) · Depends on: **A1/A2/A3 + H1 merged**; **B1's 0004 helpers** (frozen); **B3's `ob_catalog` + take-validation rules** (0006 — if it lags your test phase, coordinate through the operator; migrations order 0004→0008 regardless) · Consumers: C3 (import flow), C2 (`events.js` → `log_event`), F1 (`delete_account` for `[r8]`), G1 (allowlist), G2 (linked baselines)

## Objective

Implement `import_guest_snapshot`, `log_event`, and `delete_account` in `0008_rpc_import_events_deletion.sql`. Import is the §4.6 bounded trust exception: flags in, **server-derived** XP out (catalog-capped), one-shot, `anon_id`-linked nuance baselines, idempotent on replay. `log_event` enforces the **frozen events allowlist** (enumerated below — the [P-8] operator deliverable rides this spec) plus a per-identity daily quota. `delete_account` performs the full cascade the privacy page promises.

## Migration ownership

**`supabase/migrations/0008_rpc_import_events_deletion.sql` — owned exclusively by B5 (D-005 §1).**

## In-scope files

- `supabase/migrations/0008_rpc_import_events_deletion.sql` (new)
- `tests/rpc/b5-import-events-deletion.test.mjs` (new)
- `.github/workflows/ci.yml` (extend — a new `rpc-import` job **only**)

## Interfaces consumed (frozen — do not redesign)

- **Signatures, verbatim from WS-B-signatures.md §4/B5:**
  - `import_guest_snapshot(snapshot jsonb)` → S1 `{snapshot, xp_awarded}`. Grant: `authenticated`.
  - `log_event(name text, props jsonb)` → S2 `{accepted: true}`. Grant: `anon, authenticated`.
  - `delete_account()` → S2 `{deleted: true}`. Grant: `authenticated`.
- **Input = the ENTIRE C1 envelope v2** `{v, anon_id, created_at, state}` — not `state` alone (D-011 ruling 1, review BLOCKER). `state = {total_xp, topics, opinion_builders, evolved_takes, baseline_done}` per the merged `guest.js`. You read `snapshot.anon_id` + `snapshot.state.{topics, opinion_builders, evolved_takes}` and **ignore `state.total_xp` and `state.baseline_done`** — XP is derived server-side, never trusted (§4.6).
- Contract §1/§6: replay of a completed import = S1 with `xp_awarded: 0`, checked **before** `progress_not_empty` (D-011 ruling 4). Error codes: `not_authenticated`, `invalid_params`, `progress_not_empty`, `invalid_snapshot`, `event_not_allowed`, `event_quota_exceeded`.
- B1's 0004 helpers; D-012 §1 flag-map semantics; **B3's D-012 §4 rules** (`ob_catalog` incl. `standard_options`; the preset-integrity stance) and the `evolved_takes.excluded` default.
- `xp_awards` values; 0001 `events` comment block ("event rows must survive account deletion for aggregate analytics" — the D-012 §6 anonymize-don't-delete ruling operationalizes this).

## Interfaces exposed

### `import_guest_snapshot` — checks in order (normative)

1. Auth guard; `snapshot` is a jsonb object → else `invalid_params`.
2. **Already imported** (`progress.imported_from_guest = true`) → S1 + `xp_awarded: 0`, no writes (idempotent replay — C3's lost-ack case; BEFORE any other check).
3. **Structural validation → `invalid_snapshot`:** `v = 2`; `anon_id` present and UUID-format (D-012 §7 — it links political-opinion rows; an arbitrary string must not ride in, and the CSPRNG bearer property `[r1]` makes real ids unguessable); `state` an object; every `state.topics` key ∈ `topics_catalog`, flags boolean / `quizScore` int-or-null per the D-012 §1 shape; every `state.opinion_builders` key ∈ `ob_catalog`, values `{completed: bool}`; every take entry `{opinion_builder_id, topic_id, cold_take ∈ yes|no, evolved_take non-empty ≤ 2000 chars, is_custom bool}` with a valid `ob_catalog` pairing; at most one take per `ob_id`. **No unlock-chain/ordering validation** — forged flags are the accepted, XP-bounded residual risk (§4.6).
4. **`progress_not_empty`** — refused iff never imported AND the row is not at **default state**, defined (D-012 §7) as: `total_xp = 0` AND `topics = '{}'` AND `opinion_builders = '{}'` AND zero `evolved_takes` rows for this user. **Streak columns are deliberately excluded** — C2's login bootstrap calls `check_streak` before C3 imports, so `streak`/`last_login_date` are already touched on every real first login.
5. **One transaction:**
   - **XP derivation (per D-012 §7):** sum via `xp_for()` over validated flags — L1 `flashcardsComplete` → 50; `quizComplete` on levels 1/3 → 50 each, plus the 25 perfect bonus iff `quizScore` equals that (topic, level)'s `quiz_answer_keys` vector length; L2/L3 `flashcardsComplete` → 0 (D-012 §2). OB XP derives **only from valid take entries** (100; 300 iff `is_custom` AND `char_length ≥ 50` — §4.6's "custom takes must meet the ≥50-char rule, else scored as standard"): a `completed` OB flag with no take entry imports the flag but mints nothing. A take with `is_custom = false` whose text matches no `ob_catalog.standard_options` entry is **downgraded to custom** (imported with `is_custom = true`, custom XP rule) rather than refused — import tolerates envelope drift; the S3 text-leak protection is what matters (D-012 §4/§7).
   - Writes: `progress.topics := validated state.topics`, `opinion_builders := validated flags`, `total_xp := derived sum` (absolute, not incremented), `imported_from_guest := true`, `updated_at := now()`; insert take rows with `is_imported = true` and the derived `xp_earned`.
   - **Baseline linking (§4.6):** `update nuance_sessions set user_id = auth.uid() where anon_id = snapshot.anon_id and user_id is null`. Rows already linked to **another** account are silently skipped (the WHERE guard) — a shared/stolen device must not fail the whole import, and G2's dedup rule `[r2]` handles a user who ends up with both authed and linked rows.
6. Return S1; `xp_awarded` = the derived total (C3's "confirmed success" signal — it clears the envelope only on this).

The hard XP ceiling — every flag + every bonus + all 10 custom takes — is **4,000** (5 topics × 200 + 10 × 300). The clamp is structural (derivation, not validation); the test asserts the maximal forged envelope yields exactly this and not one point more.

### `log_event` — the frozen allowlist ([P-8] deliverable, D-012 §6)

Identity: authed → `user_id = auth.uid()`, any props `anon_id` ignored; anon → `props` **must carry `anon_id`** (UUID-format, else `invalid_params`) which is lifted into `events.anon_id` and **stripped from the stored props** — the frozen signature has no `anon_id` param, so it rides props by D-012 §6.

Checks: types (`name` non-empty text; `props` an object or null; serialized props ≤ 1 KB, values scalar — else `invalid_params`) → allowlist (`event_not_allowed`) → per-identity daily quota, UTC day, `event_daily_quota() returns int` = **500** (parameter-slot function) → insert → ack.

**Allowlist (frozen with this spec; additions are decisions.md events):**

```
app_open · welcome_seen · age_gate_passed · age_gate_blocked
baseline_offered · baseline_started · baseline_completed · baseline_skipped
flashcards_completed · quiz_completed · level2_completed · level3_cards_completed
ob_started · ob_completed · comparison_viewed
signup_started · account_created · import_completed · import_failed
day30_banner_shown · day30_started · day30_completed
install_prompt_shown · install_prompt_accepted · install_prompt_dismissed
```

(25 names: the §5.1.4 funnel rates, §9 metrics, and `[r6]` install tracking; day-30 names are included now so the P1-2 UI needs no post-freeze addition.) Implement as a SQL constant array in the function. Props carry ids/enums/numbers only — never free text (G3's scrubber is the backstop, not the license).

### `delete_account` — full cascade (D-012 §6)

`delete from auth.users where id = auth.uid()` — FK cascades remove `profiles`, `progress`, `evolved_takes`, and `nuance_sessions` (linked-anon rows included: they carry the user's `user_id`; measurement loss on deletion is the privacy-correct outcome). **Before** the delete, anonymize events: `update events set user_id = null where user_id = auth.uid()` — rows survive for aggregate funnel honesty per 0001's comment block, but carry no identity. Return `{deleted: true}`; deliberately no snapshot. If the local stack denies the definer function DELETE on `auth.users`, that is an escalation (ownership/grant fix in this migration), not a workaround via soft-delete.

## Definition of done

- [ ] `0008` applies cleanly on 0001→0007 from empty; full-chain migrations job green
- [ ] All three RPCs match the frozen signature table exactly (grants + PUBLIC revoke; `log_event` callable as both roles, the other two `authenticated`)
- [ ] **Forged-XP clamp:** maximal forged envelope → `total_xp` exactly 4,000; `state.total_xp: 999999` ignored; OB flag without take mints 0
- [ ] **Replay before refusal:** import → replay → S1/`xp_awarded: 0`/no duplicate takes; fresh account with real play (one `complete_flashcards`) → `progress_not_empty`; fresh account after only `check_streak` → import **succeeds** (streak exclusion proven)
- [ ] Baseline linking: anon baseline rows gain `user_id`; the 30-day clock survives (day-30 via `submit_nuance_session` works against the linked baseline — cross-test with B4's merged RPC); rows linked to another account untouched, import still succeeds
- [ ] `invalid_snapshot` battery: wrong `v`, missing/malformed `anon_id`, unknown topic id, unknown/mispaired ob, `cold_take = 'maybe'`, non-boolean flag, duplicate takes, 2001-char take — each refused with **zero** partial writes (transaction proven by row counts)
- [ ] `log_event`: allowlisted name inserts with correct identity column; off-allowlist → `event_not_allowed`; 501st event of the UTC day → `event_quota_exceeded` (seed 500 directly, then RPC); anon without props `anon_id` → `invalid_params`; stored props contain no `anon_id` key
- [ ] `delete_account`: a fully-populated user (progress, takes, authed + linked nuance rows, events) → zero rows in profiles/progress/evolved_takes/nuance_sessions, `auth.users` row gone, events rows remain with `user_id IS NULL`
- [ ] `rpc-import` CI job green; SKIP-not-fail without Docker

## Required tests

- Import happy paths: mid-progress envelope (some flags + takes) → correct derived XP, flags landed, `is_imported = true`, `imported_from_guest = true`; **empty fresh-guest envelope** (just `anon_id` + baseline) → succeeds, XP 0, baseline linked, import consumed (replay-idempotent thereafter)
- Perfect-bonus derivation: `quizScore` = key length → +25; key length − 1 → no bonus; `quizScore: 99` → no bonus (validated against real key lengths, not trusted)
- Preset-downgrade: envelope take `is_custom: false` with non-registry text → imported as custom, correct XP, and `get_ob_comparison` never surfaces its text (cross-test with B3)
- The clamp, replay, refusal, linking, `invalid_snapshot`, `log_event`, and deletion batteries per DoD
- Quota identity separation: 500 authed events don't exhaust an anon identity's quota and vice versa
- Grant wall: anon calling `import_guest_snapshot`/`delete_account` → permission denied

## Out of scope (do not touch)

- The C3 import flow/UX, envelope clearing, retry banner (client — C3); `guest.js` (merged, C1)
- `events.js` transport and instrumentation call sites (C2 `[m-7]` / G1) — you own the server contract only
- G2 dedup/views; funnel SQL views (G1); the F1 `[r8]` flow that calls `delete_account`
- B4's nuance RPCs and rate limits (you only *link* nuance rows); B3's `ob_catalog` DDL (you consume it)
- P1 tables (`push_subscriptions` etc.) — nothing to cascade until they exist
- 0001–0007; RLS policies

## Decisions log

Signatures are D-010/D-011 (FROZEN; envelope-not-state input and replay-before-refusal are recorded rulings). New pins this spec executes: **D-012** §6 (events allowlist + anon_id-via-props + 500/day quota + delete-anonymizes-events), §7 (default-state definition excluding streak columns; anon_id UUID check; skip-other-account linking; OB-XP-from-takes-only; perfect-bonus derivation; preset-downgrade on import). Conflicts → escalate (D-013+), never edit.

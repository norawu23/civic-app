# Chunk spec B3 — Opinion builder + comparison RPCs

**Workstream:** WS-B (RPC layer) · **Estimate:** 2 bd · **Review tier:** 2 (standard)
**Issued:** 2026-07-08 (batch 2) · **Basis:** docs/specs/WS-B-signatures.md (FROZEN, D-010 + D-011 — incl. D-011 ruling 3: `topic_id` param + the OB-registry dependency); ARCHITECTURE.md v3.2 §3, §4.1 (OB screen surgery), §5.2 (n≥10 gate); BUILD_PLAN.md §3 B3; docs/specs/H1-content-pipeline.md (seeder you extend); migrations 0001–0003; **D-012** (batch-2 rulings)
**Start:** Mon Jul 13 (W2) · Depends on: **A1/A2/A3 + H1 merged**, **B1's 0004 helpers** (frozen; vendor locally from B1's spec appendix if 0004 lags) · Consumers: C2 (wrappers), D2 (OB screen), B5 (import validates takes against **your** `ob_catalog`), P1-5 (comparison UI)

## Objective

Implement `complete_opinion_builder` and `get_ob_comparison` in `0006_rpc_opinion_builder.sql`, **plus the server-side OB registry (`ob_catalog`) and the H1-seeder extension that populates it** — D-011 ruling 3: without the registry, a forged `ob_id` mints unbounded XP (the per-`ob_id` uniqueness constraint is no cap on invented ids). The registry also carries each OB's preset take texts, which closes a text-leak hole in the comparison aggregate (D-012 §4).

## Migration ownership

**`supabase/migrations/0006_rpc_opinion_builder.sql` — owned exclusively by B3 (D-005 §1).** Contains: `ob_catalog` DDL, the `evolved_takes.excluded` column (D-012 §5), and both RPCs.

## In-scope files

- `supabase/migrations/0006_rpc_opinion_builder.sql` (new)
- `scripts/content/seed.mjs` (**extend** — emit `ob_catalog` rows; H1 is merged, this diff is yours; H2–H6 touch only `src/data/*.json`, so no collision)
- `scripts/content/seed.test.mjs` (extend — ob_catalog assertions)
- `tests/rpc/b3-opinion-builder.test.mjs` (new)
- `.github/workflows/ci.yml` (extend — a new `rpc-opinion` job **only**, plus the `content` job's row-count assertion gains `10 ob_catalog`)

## Interfaces consumed (frozen — do not redesign)

- **Signatures, verbatim from WS-B-signatures.md §4/B3:**
  - `complete_opinion_builder(topic_id text, ob_id text, cold_take text, evolved_take text, is_custom boolean)` → S1 `{snapshot, xp_awarded}`. Grant: `authenticated`. (The leading `topic_id` is the D-011 ruling-3 amendment — do not "simplify" it away.)
  - `get_ob_comparison(ob_id text)` → S3. Grant: `anon, authenticated`. Unknown `ob_id` → `{n: 0, gated: true}`, **never an error** (non-enumerating; D-011).
  - S3 shapes verbatim (contract §3): gated `{n, gated: true}`; open `{n, gated: false, cold: {yes, no}, evolved: [{take, count}], custom_count}` — **counts, not percentages; custom take text never returned**.
- Contract §1/§2/§6 conventions (grant wall incl. PUBLIC revoke; snapshot; error codes `not_authenticated`, `invalid_params`, `unknown_topic`, `locked_topic`, `unknown_ob`).
- 0001 `evolved_takes` DDL: `cold_take CHECK IN ('yes','no')`, `UNIQUE (user_id, opinion_builder_id)`, NOT NULL `topic_id`/`xp_earned`.
- `xp_awards`: `opinion_builder = 100`, `opinion_builder_bonus = 200`.
- B1's 0004 helpers; D-012 §1 flag-map semantics (`opinion_builders` values are **`{"completed": true}` flags only** — take text lives in `evolved_takes`, matching C1's envelope split).
- Content JSON: each topic has exactly 2 OBs (`*-ob-01` `required: true`, `*-ob-02` optional); preset take texts at `opinionBuilders[].evolvedTake.standardOptions`.

## Interfaces exposed

**`ob_catalog` (new table — D-012 §4):**

```sql
create table public.ob_catalog (
  ob_id            text primary key,
  topic_id         text not null references public.topics_catalog,
  required         boolean not null,
  position         int not null,            -- index within the topic (0 = required OB)
  standard_options text[] not null          -- the preset evolved-take texts, verbatim from content JSON
);
-- RLS enabled, ZERO policies (default-deny, same stance as topics_catalog —
-- D-008 §4: the client reads content JSON; only RPCs read the registry).
```

Seeded by `content:seed` (your extension): one row per content-JSON OB, `ON CONFLICT DO UPDATE` idempotent like the existing emitters. Seed `topics_catalog` before `ob_catalog` (FK).

**`complete_opinion_builder` — checks in order:**

1. Auth guard; param types (`cold_take ∈ {'yes','no'}`, `evolved_take` non-empty text ≤ 2000 chars, `is_custom` boolean — else `invalid_params`).
2. `unknown_topic` → `locked_topic` (topic-level, via `topic_unlocked`).
3. `unknown_ob` if `ob_id` ∉ `ob_catalog` **or** `ob_catalog.topic_id ≠ topic_id` (the pair check — D-011 ruling 3).
4. **Preset-integrity check (D-012 §4):** if `is_custom = false`, `evolved_take` must exactly match one of the OB's `standard_options` — else `invalid_params`. Without this, a mislabeled "preset" with arbitrary text would surface user-written text through S3's `evolved` buckets, bypassing the custom-text-never-returned guarantee.
5. **Required-before-optional (D-012 §4):** if this OB has `required = false` and the topic's required OB is not completed (`opinion_builders` flag) → raise **`locked_topic`** with detail `'required opinion builder not yet completed'`. (The frozen 14-code registry has no OB-ordering code; `locked_topic`'s "not yet unlocked for this user — state-transition check" is the ruled reading. Do not invent a new code.)
6. **Replay** (flag already `completed`, or an `evolved_takes` row exists for (user, ob)): return snapshot + `xp_awarded: 0`, **no writes** — the original take is kept even if the replay carries different text. Pre-check; a raw 23505 must never surface.
7. **First completion, one transaction:** insert `evolved_takes` row (`is_custom`, `is_imported = false`, `xp_earned` = the award below) + set `opinion_builders.<ob_id> = {"completed": true}` + `total_xp += award` + `updated_at = now()`.

**XP:** `xp_for('opinion_builder')` (100) + `xp_for('opinion_builder_bonus')` (200) iff `is_custom AND char_length(evolved_take) >= 50` — one number, 100 / 300 / 0-on-replay (contract §4/B3). Presets are always 100; the threshold lives server-side only.

**`get_ob_comparison(ob_id)`** — read-only, `anon, authenticated`:

- `n` = count of `evolved_takes` rows for `ob_id` **where `excluded = false`** (D-012 §5 — this migration adds `excluded boolean not null default false` to `evolved_takes`, aligning §3/N8's "every cited aggregate filters excluded"; the admin toggle UI is G2/P1, not yours). Imported rows (`is_imported = true`) **count** — they are genuine user takes.
- `n < 10` (or unknown `ob_id`) → `{n, gated: true}`. Else: `cold` = yes/no counts; `evolved` = non-custom takes grouped by exact text, ordered by count desc; `custom_count` = custom-row count, **text never selected**.

## Definition of done

- [ ] `0006` applies cleanly on 0001→0005 from empty; full-chain migrations job green
- [ ] Both RPCs match the frozen signature table exactly (incl. leading `topic_id`; `anon, authenticated` grant on the comparison, `authenticated` + PUBLIC revoke on completion)
- [ ] `ob_catalog` seeded by `content:seed`: 10 rows, correct topic pairing, `required` flags, `standard_options` verbatim; double-run idempotent; CI `content` job asserts the count
- [ ] Forged-`ob_id` battery: invented id, real id with wrong topic, real id with locked topic — all refused, zero XP minted (the D-011 ruling-3 headline)
- [ ] Preset-integrity: `is_custom=false` with non-preset text → `invalid_params`; comparison's `evolved` buckets can only ever contain registry texts (asserted by querying after a mixed write set)
- [ ] Replay of a completed OB: `xp_awarded: 0`, no second row, original text retained, no 23505 surfaces
- [ ] Gate behavior: n=9 → gated; n=10 → open with correct counts; unknown ob → `{n: 0, gated: true}`; excluded rows drop out of both `n` and the buckets
- [ ] Custom take text absent from every possible return (grep-level review assertion + test on the open shape)
- [ ] `rpc-opinion` CI job green; SKIP-not-fail without Docker

## Required tests

- Happy paths: required OB preset (100 XP), optional OB after required, custom ≥50 chars (300), custom 49 chars (100 — boundary), custom exactly 50 (300)
- Ordering: optional before required → `locked_topic`; required first then optional → both succeed
- Double-submit (BUILD_PLAN B3): identical replay and different-text replay → idempotent, flag map + `evolved_takes` unchanged
- Forged inputs: `cold_take = 'maybe'` → `invalid_params`; 2001-char take → `invalid_params`; unknown/mispaired/locked ob per DoD
- Comparison: seeded fixture set crossing n=10; anon-callable; counts sum (`cold.yes + cold.no = n`); `evolved` + `custom_count` consistent; imported rows included; excluded rows filtered
- Seeder: golden assertion of one `ob_catalog` row against the JSON; idempotency; FK order (topics before obs)

## Out of scope (do not touch)

- Import-path take validation and `is_imported = true` writes (B5 — it consumes your `ob_catalog` and D-012 §4 rules)
- The OB screen, XP display, comparison bars UI (D2, P1-5); `excluded` admin toggle (G2)
- Content JSON edits (H2–H6); `validate.mjs`/`lint-sources.mjs` (only `seed.mjs` is yours to extend)
- Nuance similarity/scoring machinery (B4) — the ≥50-char bonus is `char_length`, nothing trigram
- 0001–0005, 0007–0008; RLS policies beyond your own table's default-deny

## Decisions log

Signatures are D-010/D-011 (FROZEN; `topic_id` param and gated-unknown-ob behavior are recorded rulings). New pins this spec executes: **D-012** §4 (`ob_catalog` shape incl. `standard_options`; preset-integrity check; required-before-optional surfaces as `locked_topic`), §5 (`evolved_takes.excluded` + P0 filtering). Conflicts → escalate (D-013+), never edit.

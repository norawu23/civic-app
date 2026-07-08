# Chunk spec A2 — Auth trigger + `username_available`

**Workstream:** WS-A (database foundation) · **Estimate:** 2 bd · **Review tier:** 1 (integrity — adversarial second pass)
**Issued:** 2026-07-11 (batch 1b) · **Basis:** ARCHITECTURE.md v3.2 §2.2 (profiles/progress comment blocks), §3 RPC list, §8.1 age gate; BUILD_PLAN.md §3 A2; D-005 §1 (migration ownership), `[r3]`, `[N7]`
**Start:** Mon Jul 13 (W2) · Depends on: **A1 merged** (0001_schema.sql) · Blocks: signup path (C3/D3/F1 consume the metadata contract + placeholder semantics)

## Objective

Author `0002_auth.sql`: the `SECURITY DEFINER` trigger that creates a `profiles` + `progress` row for every new `auth.users` row from signup metadata, and the pre-flight `username_available` RPC. The trigger must never strand an auth row (collision/missing metadata → placeholder + `needs_profile_completion`), must reject an under-13 signup server-side without storing it, and must be idempotent under a double-fire.

## In-scope files

- `supabase/migrations/0002_auth.sql` (new — owns migration number 0002 per D-005 §1)
- `tests/auth/trigger.test.mjs` (new — drives the trigger via the local stack)
- `tests/auth/username-available.test.mjs` (new)
- `tests/lib/supabase-stack.mjs` (**consume only** — `createProject/startProject/getDbUrl/psql`; do not modify A1's helper)
- `.github/workflows/ci.yml` (extend — a new `auth` job **only**, matching the per-chunk scope-note convention A1/E1/H1 established; do not fold work into the `migrations` job)

## Interfaces consumed (frozen — do not redesign)

- **0001 shapes** (`supabase/migrations/0001_schema.sql`, verbatim): `profiles(id, username, avatar_id, is_admin, birth_year, needs_profile_completion, created_at)` with `username` UNIQUE + `CHECK (char_length BETWEEN 3 AND 20)`, `birth_year CHECK (BETWEEN 1900 AND 2100)`; `progress(id, …)` where `id` is the PK **and** the FK to `auth.users` (no `user_id` column). Both tables have RLS enabled, **zero policies** — the trigger is `SECURITY DEFINER` and writes past RLS by design.
- **Signup metadata contract:** the client calls `supabase.auth.signUp({ …, options: { data: { username, birth_year } } })`; the trigger reads `new.raw_user_meta_data->>'username'` and `->>'birth_year'`. `birth_year` arrives as a JSON string → cast defensively.
- ARCHITECTURE §8.1: under-13 (any path) is blocked and **the attempt is not stored**; year-only minimization.

## Interfaces exposed (frozen after merge; ratified in the Jul 10 freeze)

- **`public.username_available(name text) returns boolean`** — `SECURITY DEFINER`, `STABLE`. Returns `true` iff `name` passes the 3–20 length check **and** no existing `profiles.username` matches. **Case-sensitive exact match** — it must use the identical comparison the UNIQUE index uses, so a "yes" from pre-flight cannot then collide in the trigger (citext / case-folding is an explicit non-goal; **freeze ruling**). Granted to `anon` + `authenticated` (called before login).
- **Trigger `on_auth_user_created` → `public.handle_new_user()`** — `AFTER INSERT ON auth.users FOR EACH ROW`, `SECURITY DEFINER`:
  - **Under-13 gate (first, outside the collision handler so it propagates):** if `birth_year` is present and `(extract(year from now())::int - birth_year) < 14` → `RAISE EXCEPTION` → aborts the GoTrue signup transaction → **no `auth.users` row persists** (§8.1). Threshold: **`current_year − birth_year < 14`** (D-008 §2 — the 14-target rule, NOT `< 13`: because birth-year-only data can't resolve exact age, `< 13` would admit actual-12-year-olds born in the boundary year; `< 14` guarantees zero under-13 storage and matches the 14–18 audience). **F1's client gate MUST mirror this exact expression** so a client-passed signup is never server-rejected. The year-only coarseness is a documented age-gate limitation, not an A2 bug.
  - **Happy path:** `INSERT profiles(id, username, birth_year)` + `INSERT progress(id)`, both `ON CONFLICT (id) DO NOTHING`.
  - **Fallback path (`BEGIN … EXCEPTION`):** on `unique_violation` (username taken) **or** NULL/blank/invalid username → insert the profile with a **placeholder username** `left('user_' || replace(new.id::text,'-',''), 20)` (fits the 3–20 CHECK; `id` uniqueness makes the placeholder effectively unique), keep a valid ≥13 `birth_year` else NULL, and set **`needs_profile_completion = true`**. Always still insert the `progress` row. Signup never strands an auth row (`[r3]/[N7]`).
- **Placeholder + `needs_profile_completion` semantics** are the contract D3's profile-completion screen and C3's signup flow consume. **Clearing** `needs_profile_completion` is A3's column-restriction trigger's job (on a valid username change), not A2's — A2 only sets it true.

## Definition of done

- [ ] `0002_auth.sql` applies cleanly on top of 0001 against a fresh shadow DB (`supabase db start` with both migrations)
- [ ] A valid signup (username + birth_year in metadata) yields exactly one `profiles` row (real username, `needs_profile_completion=false`) and one `progress` row at defaults
- [ ] Under-13 metadata → signup aborts, **and a follow-up query proves zero `auth.users` / `profiles` / `progress` rows for that email** (nothing stored)
- [ ] Username collision → account still created with a placeholder username + `needs_profile_completion=true` + a `progress` row (auth row never stranded)
- [ ] Missing/blank username metadata → same placeholder fallback path
- [ ] Placeholder username satisfies the 3–20 CHECK (assert length on a synthesized `id`)
- [ ] Double-fire of the trigger for the same `id` inserts no duplicate and raises no error (idempotent `ON CONFLICT`)
- [ ] `username_available` returns false for a taken name, false for a 2-char / 21-char name, true for a free valid name; callable as `anon`
- [ ] `auth` CI job green; tests SKIP (exit 0) — not fail — when Docker/psql are absent, per A1's `deny-all-smoke` precedent

## Required tests (integration, via `tests/lib/supabase-stack.mjs`)

- Trigger happy path: metadata signup → both rows present, values correct
- Under-13 rejection **and non-persistence** (the load-bearing §8.1 assertion)
- Collision fallback → placeholder + `needs_profile_completion=true`
- Missing-metadata fallback
- Double-fire idempotency (manually invoke the trigger function / re-insert path twice)
- `username_available`: taken / too-short / too-long / free; anon-callable
- Placeholder length ≤ 20 on a real UUID

## Out of scope (do not touch)

- Any **RLS policy**, the **column-restriction trigger**, and the `is_admin()` helper — all A3 (`0003_policies.sql`)
- Every `complete_*` / nuance / import / `log_event` / `delete_account` RPC (WS-B)
- Client signup UI, the age-gate screen, and the profile-completion screen (F1 / C3 / D3) — A2 delivers only the server contract they call
- Legacy-NULL birth-year re-prompt behavior and under-13-on-re-prompt deletion (F1 `[r8]` + B5 `delete_account`)
- Editing 0001 or `repair_prod.sql` (A1, merged)

## Decisions log

The three interface rulings this chunk depends on are ratified in **D-008** (2026-07-07), incorporated into the Jul 10 freeze: (1) `username_available` = case-sensitive exact match; (2) under-13 threshold `current_year − birth_year < 14`, mirrored by F1; (3) placeholder format `left('user_'||hex(id),20)`. Post-freeze changes to any of the three are a new decisions.md event.

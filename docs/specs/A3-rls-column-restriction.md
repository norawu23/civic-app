# Chunk spec A3 — RLS policy suite + column-restriction trigger

**Workstream:** WS-A (database foundation) · **Estimate:** 2 bd · **Review tier:** 1 (integrity — adversarial second pass; `[m-4]` moved A3 to Tier 1)
**Issued:** 2026-07-11 (batch 1b) · **Basis:** ARCHITECTURE.md v3.2 §2.3 (RLS matrix), §3.1 (grading threat model), §8.2 (admin visibility); BUILD_PLAN.md §3 A3; D-005 §1 (migration ownership), `[N9]`
**Start:** Mon Jul 13 (W2) · Depends on: **A1 merged** (0001) and migration **0002 present** (A2 owns the number below A3). May be built in parallel with A2; merges after 0002. Blocks: every deny-path test the WS-B RPCs and D* screens rely on.

## Objective

Author `0003_policies.sql`: the full RLS policy set that converts 0001's default-deny tables into the §2.3 access matrix, plus the `BEFORE UPDATE` trigger on `profiles` that restricts which columns a user can write (`[N9]`). This is the wall that makes "RPC is the only write path for XP/progress/takes" true and blocks privilege escalation via `is_admin`.

## In-scope files

- `supabase/migrations/0003_policies.sql` (new — owns migration number 0003 per D-005 §1)
- `tests/rls/policies.test.mjs` (new — deny-path per policy per table)
- `tests/rls/column-restriction.test.mjs` (new — the profiles BEFORE UPDATE trigger)
- `tests/lib/supabase-stack.mjs` (**consume only** — do not modify A1's helper)
- `.github/workflows/ci.yml` (extend — a new `rls` job **only**, per the per-chunk scope-note convention)

## Interfaces consumed (frozen — do not redesign)

- **0001 tables + RLS-enabled/zero-policy state** (verbatim). The tables in scope are exactly the eight in 0001: `profiles`, `progress`, `evolved_takes`, `nuance_sessions`, `xp_awards`, `quiz_answer_keys`, `topics_catalog`, `events`. P1/P2 tables are not created yet → not in scope.
- Column names as merged: `evolved_takes.user_id`, `nuance_sessions.user_id` (both nullable-anon-aware), `progress.id`/`profiles.id` = `auth.uid()`.
- ARCHITECTURE §3.1: `quiz_answer_keys` is a **grading secret** — never client-readable. §8.2: admin sees usernames for moderation; RPCs (SECURITY DEFINER, WS-B) bypass RLS for anon/authed writes.

## Interfaces exposed (frozen after merge; ratified in the Jul 10 freeze)

**`public.is_admin() returns boolean`** — `SECURITY DEFINER`, `STABLE`: `exists(select 1 from public.profiles where id = auth.uid() and is_admin)`. `SECURITY DEFINER` is load-bearing — it reads `profiles` past RLS so the admin-SELECT policies below don't recurse (§2.3 note). Granted to `authenticated`.

**Policies (exact §2.3 matrix — SELECT-side is RLS; write-side is RPC-only unless noted):**

| Table | Policies created |
|---|---|
| `profiles` | authenticated **SELECT own** (`id = auth.uid()`); authenticated **UPDATE own** (`id = auth.uid()`, USING+WITH CHECK — column limits enforced by the trigger, not the policy); admin **SELECT all** (`is_admin()`). No INSERT policy (trigger-only). No anon. |
| `progress` | authenticated **SELECT own**; admin **SELECT all**. **No INSERT/UPDATE/DELETE policy at all** → RPC-only writes. No anon. |
| `evolved_takes` | authenticated **SELECT own** (`user_id = auth.uid()`); admin **SELECT all**. No INSERT policy → RPC-only. No anon. |
| `nuance_sessions` | authenticated **SELECT own** (`user_id = auth.uid()`); admin **SELECT all**. No INSERT policy → RPC-only (anon baseline enters via the SECURITY DEFINER RPC, not a client INSERT). No anon. |
| `events` | admin **SELECT all** (funnel views, G1). No client SELECT/INSERT → `log_event` RPC only. |
| `xp_awards` | **No policy — intentional default-deny.** Read by RPCs via SECURITY DEFINER; the client gets XP values back in RPC return payloads, never by direct SELECT (**freeze ruling**). |
| `quiz_answer_keys` | **No policy — intentional default-deny.** Grading secret (§3.1); server-only. |
| `topics_catalog` | **No policy — intentional default-deny.** Client uses `src/data/registry.js` (D-005 §3) for unlock order; RPCs read the catalog server-side. |

The three "no policy" rows are a deliberate decision, not an omission — call it out in a migration comment so a later reader doesn't "fix" it.

**`BEFORE UPDATE ON public.profiles` trigger (`[N9]` column restriction):**
- `username` — writable · `avatar_id` — writable
- `birth_year` — **settable only while currently NULL**: `if OLD.birth_year is not null then NEW.birth_year := OLD.birth_year; end if;` (once set, immutable via client update — age can't be falsified after the fact)
- `is_admin`, `id`, `created_at` — **forced to OLD** (`NEW.x := OLD.x`): never client-writable. The `is_admin` pin is the privilege-escalation guard — the single most important assertion in the adversarial review.
- `needs_profile_completion` — **derived, never directly client-writable** (D-008 §5): `if OLD.needs_profile_completion and NEW.username <> OLD.username then NEW.needs_profile_completion := false; else NEW.needs_profile_completion := OLD.needs_profile_completion; end if`. I.e. the first username change on a flagged account clears it (the completion screen's username pick, as a side effect); otherwise the flag is pinned to OLD. **Deliberately does not pattern-match the `user_%` placeholder** — a user who legitimately picks a `user_`-prefixed name must still get un-flagged. This is the only place the flag is cleared; no `complete_profile` RPC exists.

## Definition of done

- [ ] `0003_policies.sql` applies cleanly on top of 0001 + 0002 against a fresh shadow DB
- [ ] **Deny-path per policy per table** (the DoD headline): a second authenticated user cannot SELECT user A's `profiles` / `progress` / `evolved_takes` / `nuance_sessions` rows (cross-user read denied)
- [ ] anon (guest) gets zero rows / permission-denied on every in-scope table (no anon policy anywhere)
- [ ] A non-admin authenticated user cannot read another user's rows via the admin path (`is_admin()` false → admin-SELECT policy doesn't apply); an admin can
- [ ] Direct `UPDATE progress` / `INSERT evolved_takes` / `INSERT nuance_sessions` by an authenticated user is **denied** (proves RPC-only write path holds even before B* exists)
- [ ] Column restriction: a user updating their own profile **cannot** set `is_admin=true` (silently pinned to OLD — assert the row still has `is_admin=false`), cannot change `id`/`created_at`, cannot overwrite a non-NULL `birth_year`, **can** change `username`/`avatar_id`, and setting `birth_year` while NULL succeeds
- [ ] `needs_profile_completion` flips to false when a placeholder-account user sets a valid username, and cannot be set true/false directly otherwise
- [ ] `is_admin()` does not recurse (an admin SELECT on `profiles` returns without a policy-recursion error)
- [ ] `rls` CI job green; tests SKIP (exit 0) when Docker/psql absent (A1 precedent)

## Required tests (integration, via `tests/lib/supabase-stack.mjs`)

Seed two normal users (A, B) + one admin through A2's trigger (or direct inserts as service role), then, per policy:
- Cross-user SELECT denial on profiles/progress/evolved_takes/nuance_sessions (A cannot see B)
- anon SELECT denial on all eight tables
- Non-admin cannot use the admin-SELECT path; admin can read all
- Direct write denial: authenticated `UPDATE progress`, `INSERT evolved_takes`, `INSERT nuance_sessions` all rejected
- `is_admin` escalation blocked (own-profile UPDATE leaves `is_admin=false`)
- `birth_year` immutable-once-set; settable-while-NULL
- `id`/`created_at` immutable on self-update
- `needs_profile_completion` cleared by a valid username change; not otherwise client-settable
- `quiz_answer_keys` / `xp_awards` / `topics_catalog` unreadable by authenticated + anon (default-deny holds)

## Out of scope (do not touch)

- The auth trigger + `username_available` (A2, `0002_auth.sql`)
- Any `complete_*` / nuance / import / `log_event` / `delete_account` RPC (WS-B) — A3 only proves the deny side of the wall those RPCs write through
- Policies for P1/P2 tables (`level3_content`, `level3_quiz`, `push_subscriptions`, `classes`, `class_members`, `daily_digest`) — they ship with their features
- Client screens (Profile/Admin — D2), the admin SQL views themselves (G-track consumes these policies)
- Editing 0001 / 0002 / `repair_prod.sql`

## Decisions log

The two rulings this chunk depends on are ratified in **D-008** (2026-07-07), incorporated into the Jul 10 freeze: (§4) `xp_awards`/`quiz_answer_keys`/`topics_catalog` remain default-deny (client reads XP via RPC returns, never direct SELECT); (§5) `needs_profile_completion` is cleared solely by this column-restriction trigger on the first username change (no dedicated RPC). Both are load-bearing for the adversarial review and freeze the client's read surface. `is_admin()` and the policy matrix operate below the ARCHITECTURE §2/§3 interface level (no architecture amendment).

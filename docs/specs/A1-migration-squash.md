# Chunk spec A1 — Migration squash + prod repair

**Workstream:** WS-A (database foundation) · **Estimate:** 3 bd · **Review tier:** 2 (standard)
**Issued:** 2026-07-06 (batch 1a) · **Basis:** ARCHITECTURE.md v3.2 §2.1–§2.2, BUILD_PLAN.md §3 A1, §3a runbook, D-001
**Start:** Tue Jul 7 · Blocks: A2, A3, all of WS-B

## Objective

Replace the wrong `001_init.sql` with a single `0001_schema.sql` that builds the complete v3.1 P0 schema from empty, and author the one-time `repair_prod.sql` that reconciles the live prod DB to it. Deliver the CI jobs that make both verifiable: migrations-from-empty against a shadow DB, a post-repair schema-diff script, and a grep gate that fails CI when code references columns absent from migrations.

## In-scope files

- `supabase/migrations/0001_schema.sql` (new)
- `supabase/migrations/001_init.sql` (**delete**)
- `supabase/repair_prod.sql` (new — lives outside `migrations/`; applied by hand once, per §3a runbook)
- `scripts/schema-diff.sh` (new — post-repair `pg_dump --schema-only` diff vs CI shadow)
- `scripts/check-column-refs.mjs` (new — grep gate)
- `.github/workflows/ci.yml` (new or extend — only the `migrations` and `column-refs` jobs)

## Interfaces consumed

- **Operator-supplied input:** a schema-only `pg_dump` of live prod (operator provides day 1; builders never hold prod credentials — §3a). Repair authoring works from this dump exclusively.
- ARCHITECTURE §2.2 DDL is the authoritative schema text. Do not redesign it.

## Interfaces exposed (frozen after merge; ratified in the Jul 10 freeze)

**Migration file ownership (operator ruling, embedded here):**
- `0001_schema.sql` (this chunk): all P0 tables + constraints + indexes, **RLS enabled on every table with zero policies** (default-deny), `xp_awards` seed rows. No triggers, no functions, no policies.
- `0002_*` is reserved for A2 (auth trigger + `username_available`), `0003_*` for A3 (policies + column-restriction trigger). Later chunks append numbered migrations for their RPCs. P1 tables (`level3_content`, `level3_quiz`, `push_subscriptions`) ship with their P1 features, not in 0001.

**Tables in 0001** (exact shapes per ARCHITECTURE §2.2, plus the two plan amendments):
- `profiles` — incl. `birth_year int` (nullable, sanity CHECK 1900–2100) and **`needs_profile_completion boolean NOT NULL DEFAULT false`** `[r3]`
- `progress` — incl. **`tz_offset_minutes int NOT NULL DEFAULT 0`** (D-001; CHECK BETWEEN −840 AND 840)
- `evolved_takes`, `nuance_sessions` (incl. `excluded`, `elapsed_days`, `UNIQUE NULLS NOT DISTINCT`), `events`
- `xp_awards` (seeded: values taken from the current client's XP table — `flashcards 50`, `quiz 50`, `quiz_perfect_bonus 25`, `opinion_builder 100`, `opinion_builder_bonus 200` — operator confirms the full action list at review)
- `quiz_answer_keys`, `topics_catalog` (**empty** — seeded by CI from content JSON; that mechanism is H1's chunk, not yours)

## Definition of done

- [ ] `supabase db reset` on an empty local project applies 0001 cleanly; app schema matches ARCHITECTURE §2.2 + `needs_profile_completion` + `tz_offset_minutes`
- [ ] Every table has `ENABLE ROW LEVEL SECURITY`; zero policies exist (deny-all verified by a smoke test: anon + authed selects fail)
- [ ] `repair_prod.sql` is a single transaction; derived from the operator-supplied dump; transforms legacy rows (`avatar` text → `avatar_id` int mapping, `progress_data` jsonb → new columns) — any transformation with no mechanical answer is escalated per §1, not silently defaulted
- [ ] `scripts/schema-diff.sh` produces an **empty diff** between the repaired-dump schema and the CI shadow DB built from 0001 (modulo comments/ownership) — demonstrated against a local copy of the prod dump with the repair applied
- [ ] CI `migrations` job: fresh shadow DB → apply from empty → red on failure
- [ ] CI `column-refs` job: extracts `.from('<table>')` and column identifiers used in `src/` supabase-js calls, checks against 0001 DDL, red on a reference to a nonexistent column (allowlist file permitted for false positives, checked in and commented)
- [ ] `001_init.sql` deleted; no other migration files exist

## Required tests

- Migrations-from-empty passes in CI (the job itself is the test)
- Deny-all smoke: with 0001 applied and no policies, `SELECT` on `profiles`/`progress` as anon and as an authed role returns zero rows / permission denied
- `xp_awards` seed assertion: expected action list present, values match
- Repair rehearsal: script applies the prod dump to a scratch DB, runs `repair_prod.sql`, runs `schema-diff.sh`, asserts empty
- Negative test for the grep gate: a fixture file referencing a fake column turns the job red

## Out of scope (do not touch)

- Any trigger, function, RPC, or RLS **policy** (A2/A3/B*)
- Seeding `quiz_answer_keys` / `topics_catalog` from content JSON (H1)
- Running anything against actual prod — the operator executes the §3a runbook in week 2
- Client code (except the read-only scan in `check-column-refs.mjs`)
- The legacy-client "syncing paused" banner (operator/D-002, repair day)

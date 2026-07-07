# Chunk spec H1 — Content pipeline

**Workstream:** WS-H (content track) · **Estimate:** 1 bd · **Review tier:** 3 (DoD + spot-check)
**Issued:** 2026-07-06 (batch 1a) · **Basis:** ARCHITECTURE.md v3.2 §5.8, §6 (content row); BUILD_PLAN.md §3 H1, D-004
**Start:** Tue Jul 7 · Consumers: B1 test phase (answer-key seeding — cross-dependency sheet requires H1 lands first), H2–H6 (validator + linter), CI

## Objective

Build the content pipeline: a JSON schema validator for the five topic files in `src/data/`, a CI seeding step that generates `quiz_answer_keys` and `topics_catalog` rows from content JSON, and a sourcing-tier linter that checks every L3 source URL against the Tier-1/2 domain allowlist. All five topics already exist and must pass the validator as-is (D-004) — schema violations in existing content are escalated, not "fixed" by loosening the schema.

## In-scope files

- `scripts/content/validate.mjs` (new — schema validator)
- `scripts/content/seed.mjs` (new — emits SQL or seeds via local supabase)
- `scripts/content/source-tiers.json` (new — **operator-owned data**; you ship the mechanism + a draft list for ratification)
- `scripts/content/lint-sources.mjs` (new)
- `.github/workflows/ci.yml` (extend — `content` job only)
- `src/data/*.json` — **read-only.** Content edits belong to H2–H6.

## Interfaces consumed

- Actual shape of the five existing files (this is the schema — codify, don't invent):
  ```
  { topic, title, icon,
    levels: {
      level1: { title, flashcards: [{id, term, definition}], quiz: [{id, question, options[4], correctIndex}] },
      level2: { title, cards: [{id, title, content}] },
      level3: { title, cards: [{id, title, content, source: {label, url}}], quiz: [{id, question, options[4], correctIndex}] }
    },
    opinionBuilders: [{ id, required, question, contextCards: [...], flipCards: {yes, no}, evolvedTake: {standardOptions[...], ...} }] }
  ```
  Derive the full schema (incl. `evolvedTake` internals) from the files themselves; where the five files disagree with each other, escalate per §1.
- Unlock-order registry: `TOPIC_UNLOCK_ORDER` currently lives in `src/hooks/useProgress.js`. Extract it to `src/data/registry.js` (single source: ordered topic ids); `topics_catalog.position` seeds from it. (§5.8: "content + one registry line." C2 will consume the same registry later — coordinate nothing, just export it.)
- Target tables (created empty by A1's `0001_schema.sql`): `quiz_answer_keys(topic_id, level, answers int[])`, `topics_catalog(topic_id, position, level_count)`.

## Interfaces exposed

- `npm run content:validate` / `content:lint` / `content:seed` — the commands H2–H6's DoDs and CI invoke
- Seed output: idempotent SQL (`INSERT ... ON CONFLICT DO UPDATE`) covering both quiz levels per topic (level 1 and level 3 answer vectors from `correctIndex` order) and one catalog row per registry entry
- `source-tiers.json` shape: `{ "tier1": ["apnews.com", ...], "tier2": [...] }` — matched on registrable domain (subdomains of an allowlisted domain pass)
- Linter output contract: **error** (CI red) on a domain on neither tier · **warn** (CI green, annotated) on unknown-but-plausible cases the operator should triage. Per BUILD_PLAN: unknown domains warn; the linter must at minimum flag `factcheck.org` (known violation, D-004 — H2–H5 replace it; do not edit content yourself).

## Definition of done

- [ ] Validator passes on all five existing files unmodified; any real schema violation found is reported in the handoff note + escalated, and the schema is NOT loosened to paper over it
- [ ] Validator catches (fixture-proven): missing `correctIndex` · `correctIndex` out of range · options ≠ 4 · duplicate ids within a topic · duplicate OB ids across topics · L3 card missing `source.url` · malformed URL
- [ ] Seeding is idempotent (run twice → identical table state) and CI asserts row counts: 5 catalog rows, 10 answer-key rows (5 topics × 2 quiz levels)
- [ ] Linter run on current content flags `factcheck.org` and reports every distinct source domain with its tier, as the compliance-pass input for H2–H5
- [ ] Draft `source-tiers.json` submitted for operator ratification (seed it from the domains actually cited in content, sorted into obvious Tier-1 (wire services, .gov, major-outlet straight news) / Tier-2 / unknown buckets — the operator rules on placement)
- [ ] CI `content` job: validate → lint → seed against the shadow DB, ordered before the RPC test jobs (B1 dependency)
- [ ] `content:seed` documented in the handoff note for local use (`supabase start` + seed) so B1's builder can run it day 1 of their test phase

## Required tests

- Validator: one green fixture + one fixture per failure mode above (red)
- Seeder: golden assertion of the exact `answers int[]` for one known topic/level against the JSON `correctIndex` values; idempotency (double-run diff empty)
- Linter: fixtures for tier-1 pass, tier-2 pass, subdomain pass, unknown-domain warn, denied-domain error, `factcheck.org` flagged in real content
- Registry: `topics_catalog` positions match `TOPIC_UNLOCK_ORDER` exactly; `level_count` = 3 for all five

## Out of scope (do not touch)

- Editing any topic JSON — content fixes, FactCheck.org replacement, L3 currency are H2–H6 (operator-adjudicated)
- The neutrality-pass harness (operator orchestrates; separate scripted step, not this chunk)
- `useProgress.js` beyond extracting the unlock-order constant (C2 owns that file's rebuild)
- `DEFAULT_PROGRESS` generation from the registry (C2, per §5.8)
- Any RPC, migration DDL, or RLS (A*, B*)
- L3-in-Supabase / admin content editor (P1-6)

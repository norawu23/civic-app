# Chunk spec C1 — Guest envelope v2

**Workstream:** WS-C (client data layer) · **Estimate:** 2 bd · **Review tier:** 2 (standard)
**Issued:** 2026-07-06 (batch 1a) · **Basis:** ARCHITECTURE.md v3.2 §4.2–§4.3, §8.1; BUILD_PLAN.md §3 C1 `[r1]` `[r6]`
**Start:** Tue Jul 7 · No upstream code deps · Consumers: C2 (reads the envelope), C3/B5 (import), E2 (anon_id for baseline)

## Objective

Build `src/data-layer/guest.js`: a versioned localStorage envelope (`{v: 2, ...}`) holding guest progress state, a CSPRNG-generated `anon_id`, and an upgrader that heals the existing legacy `civic_progress` v1 blob. Add the PWA install prompt to the guest flow as the iOS-Safari 7-day-eviction mitigation `[r6]`.

## In-scope files

- `src/data-layer/guest.js` (new — this chunk creates the `src/data-layer/` directory)
- `src/data-layer/guest.test.js` (new)
- `src/components/InstallPrompt.jsx` (new — small, presentation-only)
- `public/manifest.webmanifest` (new or fix — only what installability requires)
- One integration point in the guest flow to mount `InstallPrompt` (smallest possible diff in `App.jsx` or `WelcomeScreen.jsx`)

## Interfaces consumed

- Legacy v1 shape: whatever `civic_progress` currently holds — the shape written by `src/hooks/useProgress.js` (`DEFAULT_PROGRESS`: `{user:{totalXP,streak,lastLoginDate}, topics:{...}, opinionBuilders:{...}}`). Read that file as the authoritative v1 reference; handle partial/corrupt blobs.
- `crypto.randomUUID()` — the **only** permitted anon_id generator `[r1]`. No fallback generator, no `Math.random` anywhere in this chunk. If `crypto.randomUUID` is unavailable the envelope is created without an anon_id and one is minted lazily on next access where it is available.

## Interfaces exposed (freeze candidates — submit final shape to operator by **EOD Thu Jul 9** for the Fri Jul 10 freeze)

**Envelope v2 schema** (localStorage key `civic_envelope_v2`; legacy key left in place until C3 confirms import):

```js
{
  v: 2,
  anon_id: "<uuid>",            // CSPRNG, generated once, never regenerated
  created_at: "<ISO>",
  state: {                      // mirrors server progress semantics
    total_xp: 0,
    topics: { ... },            // same per-topic flags shape as v1 (flags only — no XP inside)
    opinion_builders: { ... },  // completion flags
    evolved_takes: [ ... ],     // {opinion_builder_id, topic_id, cold_take, evolved_take, is_custom}
    baseline_done: false        // set by E2
  }
}
```

**Module API:**

```js
loadEnvelope()        // → envelope (migrating v1 if found, creating fresh if none); never throws
saveEnvelope(env)     // validates then persists; throws on schema violation
getAnonId()           // → uuid string (mints + persists if missing)
migrateV1(rawV1)      // pure function: v1 blob → v2 envelope; exported for tests
clearEnvelope()       // used by C3 only after confirmed import success
```

## Definition of done

- [ ] `anon_id` produced exclusively by `crypto.randomUUID()` — **verified by code inspection at review** plus the format/uniqueness tests below `[r1]`
- [ ] v1 `civic_progress` blob upgrades losslessly: every completion flag, evolved take, and XP-derivable fact carried over; corrupt/partial v1 degrades to fresh envelope + preserved raw blob under `civic_progress_v1_backup` (never data loss, never a crash)
- [ ] Envelope validates on every save; a malformed envelope on load is quarantined (backup key) and replaced, not propagated
- [ ] Install prompt: `beforeinstallprompt` capture + custom prompt on Chromium; on iOS Safari, an instructional prompt (Share → Add to Home Screen) shown in the guest flow, dismissible, shown at most twice `[r6]`
- [ ] Final envelope schema + module API delivered to operator by EOD Thu Jul 9 for freeze ratification
- [ ] No supabase-js import anywhere in this chunk

## Required tests

- `migrateV1` fixtures: fresh default v1 · mid-progress v1 (some levels + OBs done) · v1 with evolved takes · truncated JSON · non-JSON garbage · missing key entirely
- anon_id: UUID-v4 format regex; 1,000 mints in a loop are unique; persisted id is stable across `loadEnvelope()` calls
- Round-trip: `saveEnvelope(loadEnvelope())` is idempotent
- Save rejects: wrong `v`, missing `anon_id`, XP numbers inside `topics` (flags only)
- InstallPrompt: RTL smoke — renders on simulated `beforeinstallprompt`, dismiss persists, max-2-shows honored

## Out of scope (do not touch)

- `src/hooks/useProgress.js` / `useAuth.js` rewiring (C2 owns consumption of this module)
- Deleting the legacy `civic_progress` key (C3, only after confirmed import)
- Any network call, RPC wrapper, or zod server schema (C2/io.js)
- Service worker / offline caching (P1)
- The nuance baseline UI that reads `getAnonId()` (E2)
- Age-gate logic (F1) — the install prompt must not entangle with it

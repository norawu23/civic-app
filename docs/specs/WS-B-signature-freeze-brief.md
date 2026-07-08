# WS-B signature-freeze brief (batch 2)

**Written 2026-07-08**, at the end of the A2/A3 merge session, so the settled decisions survive into a fresh authoring session. This is a *brief*, not the deliverable — it tells a fresh session what to write and what's already decided.

## What to produce

One document — the **WS-B RPC signature contract** — that freezes the *interface* of every WS-B RPC (names, params, return shapes, error convention) for the **Fri Jul 10 interface freeze**. Signatures only; the full per-chunk DoD/test specs for B1–B5 roll W1→W2 per BUILD_PLAN §1a ("spec batch 2 start / finish"). The contract is what C2 builds stubs against and what the B1–B5 builders implement to.

## Sources of truth (read these — not any chat history)

- `docs/ARCHITECTURE.md` §3 (authoritative RPC list) + §3.1 grading threat model + §3.2 streaks
- `docs/decisions.md`: **D-001** (streak = server time + stored tz_offset; `complete_level3_quiz` removed — L3 quiz grades through `complete_quiz`), **D-008 §4** (client reads XP ONLY via RPC returns, never direct SELECT) + **D-008** nuance `answers jsonb` shape `{question_id, response_type, position?, other_side?}`, **D-009** (A2/A3 review rulings)
- `supabase/migrations/0001_schema.sql` — the `progress` table columns ARE the snapshot; `0002/0003` (merged) are the auth-trigger + RLS wall these RPCs write past via `SECURITY DEFINER`
- `docs/specs/C1-guest-envelope-v2.md` — the shape `import_guest_snapshot` ingests
- `docs/BUILD_PLAN.md` §3 — B1–B5 chunk DoDs (B2/B4/B5 are Tier-1, adversarial review)

## Freeze-ready — ratify §3 params as-is (no redesign)

`complete_flashcards(topic_id, level)` · `complete_level2(topic_id)` · `complete_level3_cards(topic_id)` · `check_streak()` · `delete_account()` · `log_event(name, props jsonb)` · `import_guest_snapshot(snapshot jsonb)` [snapshot = C1 envelope v2].
`username_available(name text)` is **already built + merged** (A2, `0002_auth.sql`) — reference it, don't re-freeze it.

## The soft spots — all on the RETURN side (this is the real work)

§3 hand-waves every return as "returns the updated progress snapshot." That's the mush. Resolutions we landed:

1. **One canonical `progress_snapshot` return type, defined once and reused by every write RPC.** Lift it from `0001`'s `progress` table client-relevant columns: `total_xp, streak, streak_freezes, last_login_date, tz_offset_minutes, topics, opinion_builders, schema_version, updated_at` (confirm exact set against `0001`; exclude internal-only `streak_freeze_awarded_at`). This is the single most load-bearing freeze artifact — `io.js` zod-validates it and D-008 §4 makes it the *only* way the client learns XP.
2. **`complete_quiz` return** = snapshot + `{ xp_awarded, n_correct }`. Feedback (green/coral) is already local from client JSON, so do NOT echo per-question correctness (that leaks the key we deliberately kept server-side).
3. **Nuance RPCs return an ack only** (`{ accepted: true }`), never the score — `submit_nuance_session`, `submit_nuance_baseline_anon`, `submit_nuance_day30_anon`. **RATIFIED by Nora 2026-07-08: no score is shown after the questionnaire.** Rationale: zero-reward framing (E2) + a visible score invites gaming and pollutes the 30-day delta. Score is readable only via G2 admin views.
4. **`get_ob_comparison(ob_id)`** — in §3 but assigned to no B chunk. **Fold into B3** (complete + compare are one feature). Return `{ n, bars }` when `n ≥ 10`, else `{ n, gated: true }` with no distribution. (Slightly grows B3.)
5. **`submit_nuance_session(kind, answers jsonb)`** — freeze `kind ∈ {'baseline','session','day30'}`; point `answers jsonb` at the D-008/E1 frozen shape rather than re-defining it (E1 threshold ratifies on the Jul 10 list too).

## Strengthening the mushy parts — my take (the "how", not just the "what")

The return side is mushy because §3 never gave it a type or an error convention. Principles to make it robust, in priority order:

1. **Single source-of-truth snapshot type.** Define `progress_snapshot` once; every write RPC returns exactly it (plus at most a small typed addendum like `complete_quiz`'s `{xp_awarded,n_correct}`). Never let a chunk invent its own return. One zod schema in `io.js`, reused. This alone removes most of the mush.
2. **Make idempotency *visible* in the return.** Every award RPC returns `xp_awarded` for *this* call — `0` on a replay. The client then distinguishes "already done" from "just earned" without inferring it. This operationalizes §3's "repeats never re-award" as an observable contract, not a hidden invariant.
3. **Explicit states over nulls.** Gated/empty is a shape, not a null: `get_ob_comparison` → `{n, gated:true}`; nuance → `{accepted:true}`; never a bare null or void the client has to guess about.
4. **Version the snapshot.** Carry `schema_version` in the return (it's already a `progress` column). A future snapshot change becomes client-detectable instead of a silent break — cheap insurance for a frozen contract.
5. **Enforce the nuance-silent stance *structurally*, not by discipline.** The score must have no client-facing return path at all — ack-only returns + score readable solely through a `SECURITY DEFINER` admin (G2). Then "we don't show the score" can't regress via a careless field add.
6. **A typed error convention — the one gap §3 omits entirely.** C2's DoD promises a "typed error surface for screens," but §3 defines no error shapes. Freeze a convention now: RPCs signal failure with stable, mappable codes (e.g. `locked_topic`, `already_completed`, `rate_limited`, `baseline_too_recent`, `anon_id_linked`) via a consistent mechanism (RAISE with a documented SQLSTATE/message, or a `{error: code}` envelope — pick one and hold it). Without this, every screen invents ad-hoc error parsing and C2 can't deliver its typed surface. Treat this as a sixth soft spot, not an afterthought.

## Also ratified this session

- **C2 needs no separate spec in this batch** — it rides entirely on the frozen signatures (Nora agreed).
- Batch 3 (D1–D3, E2, F2, G1–G3) is a **W3** spec task, gated on C2 — not now.

## Deliverable mechanics

Author `docs/specs/WS-B-signatures.md` (or equivalent), commit it to a branch, and log a decisions.md entry (**D-010**) recording the frozen return contract + the nuance-silent ratification + the `get_ob_comparison`→B3 ownership move + the error convention. Operator authors and commits specs directly (as with the A2/A3/F1 spec commit `332e4d1`). Do not push without asking Nora. This must be done before the **Fri Jul 10** freeze.

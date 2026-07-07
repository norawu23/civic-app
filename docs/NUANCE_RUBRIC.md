# Nuance session scoring rubric

**Status:** PROVISIONAL — golden-set fixtures are builder-authored placeholders (E1) pending operator hand-scoring Jul 11–12 2026. The trigram threshold below is a **proposal**, not yet ratified (D-005 §4).

**Basis:** ARCHITECTURE.md §5.1.3, transcribed verbatim below (this document does not reinterpret those rules — it explains and worked-examples them).

This is the public, mechanical scoring rubric for nuance sessions (the baseline and day-30 "where do you stand" quiz, ARCHITECTURE §5.1). It exists so that:

- the reference JS implementation (`tests/nuance/reference-scorer.mjs`),
- B4's server-side SQL scoring function, and
- the golden-set calibration fixtures (`tests/nuance/golden-set.json`)

all agree on what a "correct" score is, for the same reason unit-tested business logic agrees with its spec. If the SQL and the reference implementation ever disagree on a golden-set fixture, that is either a bug in the SQL or an ambiguity in this rubric — never something to silently paper over (see "Known ambiguities" at the end).

## The three scoring levels

Each question in a nuance session is answered one of three ways, each carrying a fixed point value that does not depend on session position, question topic, or `kind` (`baseline` vs `day30`):

| Response | Points | Rule |
|---|---|---|
| Yes/No tap | **1** | The user tapped a bare "Yes" or "No" and moved on. |
| "It's complicated" | **2** | The user tapped the explicit "It's complicated" option instead of picking a side. |
| Structured (both sides) | **3** | The user filled in **both** structured fields — *"Your position"* and *"The strongest point on the other side"* — and both pass the 40-char and trigram checks below. |

A session's total `score` (the `nuance_sessions.score` column) is the **sum** of the per-question score across every entry in that session's `answers` array. A 5-question baseline therefore scores in the range **5–15**.

A **structured attempt that fails** the 3-point bar (see next section) does not fall to 1 — it falls to **2**, the same tier as "It's complicated." Reasoning: attempting to articulate a position, even incompletely, is closer to "I see this is complicated" than to a bare Yes/No tap. This is explicit in the spec's DoD: *"empty `other_side` on a structured attempt scores 2, not 3 — position alone ≠ both sides."*

## The 40-character rule

Both structured fields must be **non-trivial**: each is measured by **character count ≥ 40** (named constant `MIN_STRUCTURED_FIELD_CHARS = 40` in `reference-scorer.mjs`, so the operator or B4 can change it in one place if ratified differently). A field of 39 characters fails; a field of exactly 40 passes.

**Length is measured on the field as stored — leading/trailing whitespace is NOT trimmed before counting.** This is the reference implementation's choice, made for mechanical simplicity ("a length rule with no normalization step is one thing to get right, not two"), but it means a user could pad a short answer with trailing spaces to cross the boundary. This is flagged as a known ambiguity below — the residual gaming risk this creates is content-independent low-effort behavior, which the `excluded` flag and 10% admin spot-check (next section) are already the designated backstop for, not the scorer.

**Character counting uses code points, not UTF-16 code units** (`Array.from(str).length`, not `str.length`). A single emoji outside the Basic Multilingual Plane (e.g. 🙂, `U+1F642`) is one character under this rule even though it occupies two UTF-16 code units. See gs-18 in the golden set and "Known ambiguities" below — whether Postgres's `char_length()` agrees with this in every case (e.g. multi-codepoint ZWJ emoji sequences) is unverified against a real implementation.

### Worked examples — 40-char boundary (golden set gs-05/06/07)

All three hold a long, unrelated companion field constant so length is the only variable:

| Fixture | Field under test | Length | Companion field | Result |
|---|---|---|---|---|
| gs-05 | `"Curfews unfairly limit teenage freedom."` | 39 | 80-char distinct sentence | **2** (fails — one char short) |
| gs-06 | `"Curfews unfairly limits teenage freedom."` | 40 | 80-char distinct sentence | **3** (passes — exactly at the line) |
| gs-07 | `"A curfew unfairly limits teenage freedom."` | 41 | 80-char distinct sentence | **3** (passes, safely over) |

## The trigram near-duplicate rule

Even if both fields clear 40 characters, they must **not be near-duplicates of each other** — otherwise a user could satisfy the length rule by typing the same sentence twice (or a trivial rewording) without actually articulating two sides.

**Similarity metric:** trigram (3-character shingle) similarity, following the same algorithm Postgres's `pg_trgm` extension uses:

1. Lower-case the string.
2. Split into "words" — maximal runs of Unicode letters/digits; anything else (punctuation, whitespace) is a separator and contributes no trigrams of its own.
3. Pad each word with two leading spaces and one trailing space.
4. Take every contiguous 3-character substring of each padded word, collected into a **set** (duplicates collapsed) across the whole string.
5. `similarity(a, b) = |trigrams(a) ∩ trigrams(b)| / |trigrams(a) ∪ trigrams(b)|` — the Jaccard index over the two trigram sets.

`position` and `other_side` are **near-duplicates** iff `similarity(position, other_side) > TRIGRAM_NEAR_DUPLICATE_THRESHOLD`.

### Proposed threshold: **0.55** (D-005 §4 — proposal, pending operator ratification)

This is a single named constant (`TRIGRAM_NEAR_DUPLICATE_THRESHOLD` in `reference-scorer.mjs`) specifically so the operator can change one number at the Jul 11–12 review without touching any scoring logic. B4 implements the identical threshold in SQL via `pg_trgm`'s `similarity()` function (same formula, so the numbers should transfer directly — see "Known ambiguities" for the residual risk).

**Why 0.55, in three worked examples** (spec requires 3 boundary examples demonstrating the threshold):

1. **Clearly duplicate (similarity 1.0):** identical text pasted into both fields. Trivially near-duplicate at any reasonable threshold — golden set gs-17.
2. **Clearly duplicate, non-trivial (similarity ~0.90):** two sentences that share nearly all of their words in different order — e.g. swapping "good"/"bad" in an otherwise-identical sentence produces the *same trigram set* (word order doesn't affect which trigrams exist, only which word they came from) and scores 1.0 similarity despite being semantically opposite. This is itself an illustration of "structure ≠ quality" — worth knowing even though it isn't a promoted golden-set fixture.
3. **The boundary pair (golden set gs-09/gs-10):** two constructed sentence pairs that share a long common clause and differ only in their final claim, tuned so one pair's similarity falls just *above* 0.55 and the other just *below* it:
   - **gs-09** (similarity **0.5683**, > 0.55 → near-duplicate → **2 points**): both fields share the clause *"Term limits would force accountability into the political system by requiring new leadership after a set number of years in office;"* before diverging into a supporters/critics claim.
   - **gs-10** (similarity **0.5297**, < 0.55 → not a near-duplicate → **3 points**): same construction with a shorter shared clause (*"...after some years;"*), reducing the shared-trigram fraction just enough to cross back under the line.

These two are deliberately constructed to be close to the line (a ~0.02 margin on each side) rather than naturalistic quiz answers — they exist to pin the threshold's exact behavior as a regression test, not to model realistic user text. Realistic near-duplicate behavior is closer to example 1 or 2 above.

## The documented limitation: structure ≠ semantic quality

**The scorer makes no quality judgment.** It only checks structure: did the user tap a button, or fill in two fields that are long enough and different enough from each other? It cannot tell whether the content is thoughtful, relevant to the question, or even coherent.

The metric's actual claim is narrower than "the user demonstrated nuanced thinking" — it is **"willingness and ability to articulate both sides,"** which field completion directly operationalizes (ARCHITECTURE §5.1.3). A user who mechanically clears both bars is credited with that willingness even if the content is gibberish.

**Golden-set gs-11** documents this explicitly: two different strings of keyboard-mash text (`"asdkfj alsdkfj alskdjf..."` / `"zzzxcv mnbvcxz poiuytre..."`), each over 40 characters and mutually dissimilar (trigram similarity ≈ 0.01, nowhere near the duplicate threshold), **mechanically scores 3** — the maximum score — despite being meaningless. This is not a scorer bug; it is the documented, accepted limitation.

**The mitigation lives outside the scorer, not inside it:** every `nuance_sessions` row carries an `excluded boolean` (ARCHITECTURE line 115). An admin spot-checks a **10% sample** and flags gibberish/low-effort text for exclusion from cited aggregates (N6, N8) — bounded, sampled human review, not an attempt to make the mechanical scorer smarter. With **zero XP, no badge, and no streak credit** attached to nuance sessions (N6 — stated in-product as "this one's just for you"), there is no incentive to game the scorer, so the residual risk this backstop absorbs is boredom-typing, not deliberate gaming.

## The `answers` shape

```json
[
  { "question_id": "q1", "response_type": "tap", "position": "yes" },
  { "question_id": "q2", "response_type": "complicated" },
  {
    "question_id": "q3",
    "response_type": "structured",
    "position": "Your position text, >= 40 chars to qualify for 3...",
    "other_side": "The strongest point on the other side, >= 40 chars and not a near-duplicate of position..."
  }
]
```

`response_type` is one of `'tap' | 'complicated' | 'structured'`. `position` on a `'tap'` entry holds the literal `'yes'`/`'no'` value (not a structured-field position). Frozen Jul 10 with the B4 signatures per the E1 spec.

## Reference implementation

`tests/nuance/reference-scorer.mjs` exports:

- `score(answers) -> int` — the whole-session score; sums `scoreAnswer` over the array.
- `scoreAnswer(answer) -> 1 | 2 | 3` — the per-question rule above.
- `trigramSimilarity(a, b) -> number` and `isNearDuplicate(a, b, threshold?)` — the trigram machinery.
- `TRIGRAM_NEAR_DUPLICATE_THRESHOLD` and `MIN_STRUCTURED_FIELD_CHARS` — the two named constants above.

It is pure, synchronous, zero-dependency ESM. B4's SQL scoring function must agree with it on every fixture in `tests/nuance/golden-set.json`; the CI `calibration` job (`.github/workflows/ci.yml`) enforces this (currently in `reference` mode; becomes `rpc` mode, comparing against the live `submit_nuance_session` RPC, once B4 lands — see the TODO in `tests/nuance/calibration.test.js`).

## Known ambiguities (for operator adjudication / B4 escalation)

These are places where the mechanical rule above has more than one reasonable reading, or where the reference JS implementation's specific choice may not automatically match B4's SQL. None of them are resolved unilaterally here — they are flagged so the operator can rule on them during Jul 11–12 hand-scoring, or B4 can escalate if the SQL disagrees with the reference on the affected fixture.

1. **Whitespace trimming on the 40-char rule.** The reference scorer counts raw length, untrimmed. Postgres `char_length()` also does not trim by default, so this likely matches — but if B4's implementation adds a `trim()` before measuring (a reasonable, arguably more-correct choice), the two would disagree on a field consisting mostly of padding whitespace. No golden-set fixture currently isolates this exact case.
2. **Code-point vs grapheme-cluster counting (gs-18).** The reference scorer counts Unicode code points (`Array.from`). Simple emoji (single-codepoint, BMP or astral) likely count the same way in Postgres's `char_length()`. Multi-codepoint grapheme clusters (skin-tone modifiers, ZWJ family emoji, combining diacritics) are a case where "one visual character" and "one code point" diverge, and this has not been verified against a real Postgres `char_length()` call.
3. **Trigram algorithm fidelity to real `pg_trgm`.** The reference implementation's trigram extraction (word-split, 2-space/1-space padding, Jaccard over sets) is a faithful reproduction of the documented `pg_trgm` algorithm, but has not been cross-checked against a running Postgres instance with the extension enabled. If B4's SQL `similarity()` calls produce different numbers than `trigramSimilarity()` on any golden-set fixture, that is exactly the kind of discrepancy the spec says to escalate, not silently resolve.
4. **The near-duplicate boundary fixtures (gs-09/gs-10) are synthetic, not naturalistic.** They were constructed by controlling shared-word fraction precisely to land close to 0.55 on both sides, which produces slightly stilted prose. They are excellent regression pins for the exact threshold value but are not representative of what a real near-duplicate quiz answer looks like "in the wild" (example 1/2 in the trigram section above are more representative). If the operator wants a more naturalistic boundary pair, these two are the ones to replace or supplement.
5. **The trigram threshold itself (0.55) is a proposal, not a validated number.** It was chosen because it comfortably separates the constructed boundary pair and "feels" like a reasonable cutoff, not from any corpus analysis of real nuance-session answers (none exist yet — this is a pre-launch instrument). The operator's Jul 11–12 hand-scoring pass, once it has real user-authored text to look at, is the first real opportunity to validate or revise it.
6. **What counts as "gibberish" is entirely outside the scorer's authority.** gs-11 demonstrates that keyboard-mash text scores 3 mechanically. This rubric does not attempt to define gibberish detection — that judgment call belongs entirely to the admin spot-check, by design (§5.1.3). Nothing here should be read as suggesting the scorer should be extended to catch this case; doing so would reintroduce the free-text-heuristic problem structured scoring was built to fix (M7).

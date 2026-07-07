// tests/nuance/reference-scorer.mjs
//
// Pure, zero-dependency executable form of the nuance-session scoring rubric
// (ARCHITECTURE.md §5.1.3, transcribed verbatim — do not reinterpret here;
// change the rubric in docs/NUANCE_RUBRIC.md first, then mirror it here):
//
//   - Yes/No tap                                    = 1 point
//   - "It's complicated"                            = 2 points
//   - Both structured fields ("Your position" and
//     "The strongest point on the other side")
//     completed non-trivially (each >= 40 chars,
//     not near-duplicates of each other by trigram
//     similarity)                                   = 3 points
//   - A structured attempt that fails the 3-point
//     bar (missing/short field, or a near-duplicate
//     pair) falls back to the "complicated" tier    = 2 points
//     (spec E1 DoD: "position alone != both sides")
//
// `score(answers)` sums the per-question score across every entry in the
// `answers` array for one nuance_sessions row (baseline is 5 questions;
// see ARCHITECTURE §5.1.1). This is the function B4's SQL scoring must
// agree with on all 20 golden-set fixtures — a discrepancy is a B4 bug or a
// rubric ambiguity to escalate (docs/specs/E1-rubric-golden-set.md), never
// silently resolved by either side.
//
// No I/O, no randomness, no dependencies. Import and call `score(answers)`.

/**
 * PROPOSED trigram near-duplicate threshold (D-005 §4: proposal-and-ratify).
 * similarity(position, other_side) > TRIGRAM_NEAR_DUPLICATE_THRESHOLD means
 * "near-duplicate" -> the pair does NOT satisfy the 3-point bar even if both
 * fields are individually >= 40 chars.
 *
 * This is a single named constant specifically so the operator can change
 * one number at ratification (Jul 11-12) without touching any logic. B4
 * implements the identical threshold in SQL via pg_trgm's `similarity()`.
 *
 * Builder's proposal: 0.55 — see docs/NUANCE_RUBRIC.md "Trigram threshold"
 * section for the worked boundary examples that justify this number.
 */
export const TRIGRAM_NEAR_DUPLICATE_THRESHOLD = 0.55

/**
 * The 40-char rule (ARCHITECTURE §5.1.3). Named constant for the same
 * reason as the trigram threshold: one place to change it.
 */
export const MIN_STRUCTURED_FIELD_CHARS = 40

/**
 * Character length used for the 40-char rule. Uses code-point counting
 * (`Array.from`) rather than raw `.length` (UTF-16 code units) so a single
 * astral character (e.g. an emoji outside the BMP) counts as one character,
 * not two. This is the reference implementation's choice; Postgres
 * `char_length()` counts characters similarly for typical text but the two
 * are not guaranteed to agree on every possible Unicode edge case (combining
 * marks, ZWJ emoji sequences) — flagged as an open item in the handoff, see
 * gs-18 in the golden set.
 */
function charLength(str) {
  return Array.from(str ?? '').length
}

/**
 * Trigram set for one string, following pg_trgm's word-based algorithm:
 * lower-case, split into maximal runs of letters/digits ("words"; anything
 * else is a separator and contributes no trigrams of its own), pad each
 * word with two leading blanks and one trailing blank, then take every
 * contiguous 3-character substring of the padded word. The result is a
 * *set* (duplicates collapsed), matching pg_trgm's `show_trgm()` behavior.
 */
export function trigramSet(str) {
  const normalized = (str ?? '').toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const set = new Set()
  for (const word of words) {
    const padded = `  ${word} `
    for (let i = 0; i <= padded.length - 3; i++) {
      set.add(padded.slice(i, i + 3))
    }
  }
  return set
}

/**
 * Trigram similarity of two strings: |A intersect B| / |A union B|
 * (Jaccard index over trigram sets) — the same formula pg_trgm's
 * `similarity()` uses. Returns a number in [0, 1]. Two empty-trigram
 * strings (e.g. both blank, or both pure punctuation) are defined as
 * similarity 0 (not near-duplicate) rather than dividing 0/0 — an empty
 * field is already excluded from scoring 3 by the 40-char rule, so this
 * edge case never actually reaches the near-duplicate check in practice.
 */
export function trigramSimilarity(a, b) {
  const setA = trigramSet(a)
  const setB = trigramSet(b)
  if (setA.size === 0 && setB.size === 0) return 0

  let common = 0
  for (const trigram of setA) {
    if (setB.has(trigram)) common++
  }
  const union = setA.size + setB.size - common
  return union === 0 ? 0 : common / union
}

/** True iff `a` and `b` are near-duplicates under the proposed threshold. */
export function isNearDuplicate(a, b, threshold = TRIGRAM_NEAR_DUPLICATE_THRESHOLD) {
  return trigramSimilarity(a, b) > threshold
}

/**
 * Score a single answer entry:
 *   { question_id, response_type: 'tap'|'complicated'|'structured', position?, other_side? }
 * Returns 1, 2, or 3. Throws on an unrecognized response_type (fail loudly
 * rather than silently mis-score — a scorer that swallows bad input is
 * worse than one that crashes CI).
 */
export function scoreAnswer(answer) {
  if (!answer || typeof answer !== 'object') {
    throw new TypeError(`reference-scorer: answer must be an object, got ${JSON.stringify(answer)}`)
  }

  const { response_type } = answer

  if (response_type === 'tap') return 1
  if (response_type === 'complicated') return 2

  if (response_type === 'structured') {
    const position = answer.position ?? ''
    const other_side = answer.other_side ?? ''
    const bothLongEnough =
      charLength(position) >= MIN_STRUCTURED_FIELD_CHARS &&
      charLength(other_side) >= MIN_STRUCTURED_FIELD_CHARS
    if (bothLongEnough && !isNearDuplicate(position, other_side)) return 3
    // Fails the 3-point bar (missing/short field, or near-duplicate pair):
    // still an attempt at engagement, scored like "complicated" — position
    // alone (or a copy-pasted "other side") is not "both sides" (spec DoD).
    return 2
  }

  throw new TypeError(
    `reference-scorer: unknown response_type ${JSON.stringify(response_type)} (question_id=${answer.question_id})`,
  )
}

/**
 * Score a whole nuance_sessions row's `answers` array. Sum of the
 * per-question scores. A baseline session has 5 questions (ARCHITECTURE
 * §5.1.1), so the session-level score ranges 5-15, but this function makes
 * no assumption about array length — it just sums whatever it's given.
 */
export function score(answers) {
  if (!Array.isArray(answers)) {
    throw new TypeError(`reference-scorer: answers must be an array, got ${JSON.stringify(answers)}`)
  }
  return answers.reduce((total, answer) => total + scoreAnswer(answer), 0)
}

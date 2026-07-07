// src/data-layer/guest.js
//
// Guest envelope v2 — a versioned localStorage envelope for guest (not-signed-in)
// progress, plus a lossless upgrader from the legacy v1 `civic_progress` blob
// written by src/hooks/useProgress.js.
//
// Chunk: C1 — see docs/specs/C1-guest-envelope-v2.md for the contract.
//
// Frozen schema (submitted to operator for the Jul 10 interface freeze —
// see this chunk's handoff notes for the authoritative copy):
//
//   localStorage['civic_envelope_v2'] = {
//     v: 2,
//     anon_id: "<uuid>",           // crypto.randomUUID() ONLY. Minted once,
//                                   // never regenerated. May be null only in
//                                   // the (rare) browser-without-randomUUID
//                                   // case; minted lazily thereafter.
//     created_at: "<ISO 8601>",
//     state: {
//       total_xp: 0,
//       topics: {
//         [topicId]: {
//           unlocked: boolean,
//           currentLevel: number | null,
//           levels: {
//             [levelKey]: {
//               flashcardsComplete: boolean,
//               quizComplete: boolean,
//               quizScore: number | null,   // raw score, NOT an XP value
//             }
//           }
//         }
//       },
//       opinion_builders: {
//         [obId]: { completed: boolean }   // flags only — no xp, no text
//       },
//       evolved_takes: [
//         {
//           opinion_builder_id: string,
//           topic_id: string | null,
//           cold_take: string,
//           evolved_take: string,
//           is_custom: boolean,
//         }
//       ],
//       baseline_done: false,
//     }
//   }
//
// Design note: freshEnvelope() intentionally leaves state.topics and
// state.opinion_builders EMPTY ({}) for a brand-new guest with no legacy
// data. Seeding the default per-topic/opinion-builder scaffolding is a
// registry-driven concern (src/data/registry.js, H1; DEFAULT_PROGRESS
// generation, C2 per decisions.md D-005 #3) — this module deliberately
// stays mechanical (storage + migration + anon_id) so it never forks from
// the registry's unlock order. migrateV1() DOES populate real per-topic
// state for actual legacy blobs, since that data already exists.

const V1_KEY = 'civic_progress'
const V1_BACKUP_KEY = 'civic_progress_v1_backup'
const V2_KEY = 'civic_envelope_v2'
const V2_CORRUPT_BACKUP_KEY = 'civic_envelope_v2_corrupt_backup'

// obId prefix -> topic id, inferred from the fixed naming convention visible
// in useProgress.js's DEFAULT_PROGRESS.opinionBuilders (imm-ob-01, tax-ob-01,
// ger-ob-01, gun-ob-01, cli-ob-01). Not sourced from a registry file (none
// exists for opinion builders as of this chunk) — see handoff "open
// questions" for the assumption this encodes.
const OB_TOPIC_PREFIX = {
  imm: 'immigration',
  tax: 'taxes',
  ger: 'gerrymandering',
  gun: 'gunRights',
  cli: 'climateChange',
}

const BANNED_TOPIC_KEYS = new Set(['xp', 'xpearned', 'totalxp', 'total_xp', 'xpgained'])

// ─── localStorage helpers (never throw) ────────────────────────────────────

function safeGetItem(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

// ─── anon_id ────────────────────────────────────────────────────────────────

function hasCryptoUUID() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
}

// The ONLY permitted anon_id generator. No pseudo-random fallback and no
// homegrown generator anywhere in this module — CSPRNG only. [r1]
function mintAnonId() {
  return hasCryptoUUID() ? crypto.randomUUID() : null
}

// ─── shape helpers ──────────────────────────────────────────────────────────

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function topicIdFromObId(obId) {
  if (typeof obId !== 'string') return null
  const prefix = obId.split('-')[0]
  return OB_TOPIC_PREFIX[prefix] ?? null
}

function freshEnvelope() {
  return {
    v: 2,
    anon_id: mintAnonId(),
    created_at: new Date().toISOString(),
    state: {
      total_xp: 0,
      topics: {},
      opinion_builders: {},
      evolved_takes: [],
      baseline_done: false,
    },
  }
}

// ─── migrateV1 — pure v1 blob -> v2 envelope upgrader ──────────────────────
//
// rawV1: the raw string as read from localStorage.getItem('civic_progress'),
// or null/undefined if the key is absent. Never throws. Never touches
// localStorage itself (pure) — callers are responsible for any backup
// persistence of the raw blob.
//
// Degrades to a fresh envelope (never crashes, never partially-applies
// garbage) when: rawV1 is null/undefined (missing key), rawV1 fails
// JSON.parse (truncated JSON / non-JSON garbage), or the parsed value isn't
// a plain object. Otherwise migrates as much of the legacy shape as is
// present, defensively, field by field.
export function migrateV1(rawV1) {
  if (rawV1 == null) return freshEnvelope()

  let parsed
  try {
    parsed = JSON.parse(rawV1)
  } catch {
    return freshEnvelope()
  }

  if (!isPlainObject(parsed)) return freshEnvelope()

  const v1User = isPlainObject(parsed.user) ? parsed.user : {}
  const v1Topics = isPlainObject(parsed.topics) ? parsed.topics : {}
  const v1OBs = isPlainObject(parsed.opinionBuilders) ? parsed.opinionBuilders : {}

  const total_xp =
    typeof v1User.totalXP === 'number' && Number.isFinite(v1User.totalXP) ? v1User.totalXP : 0

  // topics: same per-topic flags shape as v1 (unlocked / currentLevel / levels).
  // No XP is carried inside topics — v1 never stored any there either.
  const topics = {}
  for (const [topicId, t] of Object.entries(v1Topics)) {
    if (!isPlainObject(t)) continue

    const levels = {}
    if (isPlainObject(t.levels)) {
      for (const [levelKey, lvl] of Object.entries(t.levels)) {
        if (!isPlainObject(lvl)) continue
        levels[levelKey] = {
          flashcardsComplete: !!lvl.flashcardsComplete,
          quizComplete: !!lvl.quizComplete,
          quizScore: typeof lvl.quizScore === 'number' ? lvl.quizScore : null,
        }
      }
    }

    topics[topicId] = {
      unlocked: !!t.unlocked,
      currentLevel: typeof t.currentLevel === 'number' ? t.currentLevel : null,
      levels,
    }
  }

  // opinion_builders: completion flags only. evolved_takes: everything else
  // (cold take / evolved take text) is extracted into its own array, per the
  // v2 schema's "flags only" rule for opinion_builders.
  const opinion_builders = {}
  const evolved_takes = []
  for (const [obId, ob] of Object.entries(v1OBs)) {
    const completed = !!(isPlainObject(ob) && ob.completed)
    opinion_builders[obId] = { completed }

    if (completed) {
      evolved_takes.push({
        opinion_builder_id: obId,
        topic_id: topicIdFromObId(obId),
        cold_take: typeof ob.coldTake === 'string' ? ob.coldTake : '',
        evolved_take: typeof ob.evolvedTake === 'string' ? ob.evolvedTake : '',
        // v1 never recorded whether the evolved take was hand-written vs a
        // preset selection — best-effort default. See handoff open questions.
        is_custom: false,
      })
    }
  }

  return {
    v: 2,
    anon_id: mintAnonId(),
    created_at: new Date().toISOString(),
    state: { total_xp, topics, opinion_builders, evolved_takes, baseline_done: false },
  }
}

// ─── validation ─────────────────────────────────────────────────────────────

function scanForBannedXPKeys(node) {
  if (Array.isArray(node)) {
    return node.some(scanForBannedXPKeys)
  }
  if (isPlainObject(node)) {
    return Object.entries(node).some(
      ([k, v]) => BANNED_TOPIC_KEYS.has(k.toLowerCase()) || scanForBannedXPKeys(v),
    )
  }
  return false
}

// Throws with a descriptive message on any schema violation. Returns true
// on success (never returns false — always throws or passes).
export function validateEnvelope(env) {
  const fail = (msg) => {
    throw new Error(`[data-layer/guest] invalid envelope: ${msg}`)
  }

  if (!isPlainObject(env)) fail('envelope is not an object')
  if (env.v !== 2) fail(`wrong v (expected 2, got ${JSON.stringify(env.v)})`)
  if (typeof env.anon_id !== 'string' || env.anon_id.length === 0) fail('missing anon_id')
  if (typeof env.created_at !== 'string' || env.created_at.length === 0) {
    fail('missing created_at')
  }

  const s = env.state
  if (!isPlainObject(s)) fail('missing state')
  if (typeof s.total_xp !== 'number' || !Number.isFinite(s.total_xp)) {
    fail('state.total_xp must be a finite number')
  }
  if (!isPlainObject(s.topics)) fail('state.topics must be an object')
  if (scanForBannedXPKeys(s.topics)) {
    fail('state.topics must contain flags only — no XP fields')
  }
  if (!isPlainObject(s.opinion_builders)) fail('state.opinion_builders must be an object')
  if (!Array.isArray(s.evolved_takes)) fail('state.evolved_takes must be an array')
  if (typeof s.baseline_done !== 'boolean') fail('state.baseline_done must be a boolean')

  return true
}

// ─── ensure / persist helpers ───────────────────────────────────────────────

function ensureAnonId(env) {
  if (env.anon_id) return env
  const id = mintAnonId()
  return id ? { ...env, anon_id: id } : env
}

// Best-effort persist: validates, writes, swallows failure (used internally
// so loadEnvelope() can uphold its "never throws" contract even if, e.g.,
// crypto.randomUUID is unavailable and anon_id can't yet be set).
function persistBestEffort(env) {
  try {
    validateEnvelope(env)
    return safeSetItem(V2_KEY, JSON.stringify(env))
  } catch {
    return false
  }
}

// ─── public API ─────────────────────────────────────────────────────────────

// Loads the guest envelope, migrating the legacy v1 blob if v2 isn't present
// yet, or creating a fresh envelope if neither is present. Never throws.
export function loadEnvelope() {
  const v2raw = safeGetItem(V2_KEY)
  if (v2raw != null) {
    try {
      const parsed = JSON.parse(v2raw)
      validateEnvelope(parsed)
      const withId = ensureAnonId(parsed)
      if (withId !== parsed) persistBestEffort(withId)
      return withId
    } catch {
      // Malformed v2 envelope: quarantine, then fall through to migration /
      // fresh-envelope path below rather than propagating a broken shape.
      safeSetItem(V2_CORRUPT_BACKUP_KEY, v2raw)
    }
  }

  const v1raw = safeGetItem(V1_KEY)
  const migrated = migrateV1(v1raw)

  if (v1raw != null) {
    let v1Corrupt = false
    try {
      JSON.parse(v1raw)
    } catch {
      v1Corrupt = true
    }
    if (v1Corrupt) safeSetItem(V1_BACKUP_KEY, v1raw)
  }

  const withId = ensureAnonId(migrated)
  persistBestEffort(withId)
  return withId
}

// Validates then persists. Throws on schema violation — callers that want
// a "never throws" write path should catch, or use loadEnvelope()'s
// internal migration path instead.
export function saveEnvelope(env) {
  validateEnvelope(env)
  localStorage.setItem(V2_KEY, JSON.stringify(env))
}

// Returns the guest's anon_id, minting + persisting it if missing (e.g. the
// rare case where crypto.randomUUID wasn't available at envelope-creation
// time but is available now). Returns null only if crypto.randomUUID is
// still unavailable.
export function getAnonId() {
  const env = loadEnvelope()
  if (env.anon_id) return env.anon_id

  const id = mintAnonId()
  if (!id) return null

  const next = { ...env, anon_id: id }
  persistBestEffort(next)
  return id
}

// Removes the v2 envelope from storage. Used by C3 only, after a confirmed
// guest->account import.
export function clearEnvelope() {
  safeRemoveItem(V2_KEY)
}

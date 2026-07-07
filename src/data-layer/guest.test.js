// src/data-layer/guest.test.js
//
// NOTE ON TEST RUNNER: this repo's package.json has no test runner wired
// (no vitest devDependency, no "test" script). Rather than add a
// devDependency without operator approval (per BUILD_PLAN protocol), these
// tests are written against Node's built-in test runner (`node:test` +
// `node:assert/strict`, available in Node >=18, zero extra deps) so they
// are actually executable today:
//
//   node --test src/data-layer/guest.test.js
//
// If/when vitest is added to the project (it's listed as a candidate in
// the protocol notes), this file's describe/it/assert calls port to it
// with only import-line changes — the bodies are already
// describe/it-shaped and use plain `assert`, not a vitest-only API.
//
// localStorage does not exist as a Node global, so a tiny in-memory
// polyfill is installed on globalThis before each test. crypto.randomUUID
// IS a real Node global (Node >=19 stably, present in this repo's Node 20)
// so anon_id generation is exercised for real, not mocked.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(k, String(v))
    },
    removeItem: (k) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  globalThis.localStorage = createMockStorage()
})

const {
  migrateV1,
  validateEnvelope,
  loadEnvelope,
  saveEnvelope,
  getAnonId,
  clearEnvelope,
} = await import('./guest.js')

const V1_KEY = 'civic_progress'
const V1_BACKUP_KEY = 'civic_progress_v1_backup'
const V2_KEY = 'civic_envelope_v2'
const V2_CORRUPT_BACKUP_KEY = 'civic_envelope_v2_corrupt_backup'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ─── fixtures ───────────────────────────────────────────────────────────────

const FRESH_V1 = {
  user: { totalXP: 0, streak: 1, lastLoginDate: null },
  topics: {
    immigration: {
      unlocked: true,
      currentLevel: 1,
      levels: { 1: { flashcardsComplete: false, quizComplete: false, quizScore: null } },
    },
    taxes: { unlocked: false, currentLevel: null, levels: {} },
    gerrymandering: { unlocked: false, currentLevel: null, levels: {} },
    gunRights: { unlocked: false, currentLevel: null, levels: {} },
    climateChange: { unlocked: false, currentLevel: null, levels: {} },
  },
  opinionBuilders: {
    'imm-ob-01': { completed: false },
    'imm-ob-02': { completed: false },
    'tax-ob-01': { completed: false },
    'tax-ob-02': { completed: false },
    'ger-ob-01': { completed: false },
    'ger-ob-02': { completed: false },
    'gun-ob-01': { completed: false },
    'gun-ob-02': { completed: false },
    'cli-ob-01': { completed: false },
    'cli-ob-02': { completed: false },
  },
}

const MID_PROGRESS_V1 = {
  user: { totalXP: 175, streak: 3, lastLoginDate: '2026-07-06' },
  topics: {
    immigration: {
      unlocked: true,
      currentLevel: 2,
      levels: {
        1: { flashcardsComplete: true, quizComplete: true, quizScore: 3 },
        2: { flashcardsComplete: false, quizComplete: false, quizScore: null },
      },
    },
    taxes: { unlocked: false, currentLevel: null, levels: {} },
    gerrymandering: { unlocked: false, currentLevel: null, levels: {} },
    gunRights: { unlocked: false, currentLevel: null, levels: {} },
    climateChange: { unlocked: false, currentLevel: null, levels: {} },
  },
  opinionBuilders: {
    ...FRESH_V1.opinionBuilders,
    'imm-ob-01': { completed: false },
  },
}

const EVOLVED_TAKES_V1 = {
  user: { totalXP: 425, streak: 5, lastLoginDate: '2026-07-06' },
  topics: MID_PROGRESS_V1.topics,
  opinionBuilders: {
    ...FRESH_V1.opinionBuilders,
    'imm-ob-01': {
      completed: true,
      coldTake: 'Immigration is bad.',
      xpEarned: 200,
      evolvedTake: 'Immigration policy involves real tradeoffs I hadn’t considered.',
    },
    'tax-ob-01': {
      completed: true,
      coldTake: 'Taxes are theft.',
      xpEarned: 100,
      evolvedTake: 'Taxes fund things I use.',
    },
  },
}

// ─── migrateV1 ──────────────────────────────────────────────────────────────

describe('migrateV1', () => {
  it('missing key entirely -> fresh v2 envelope', () => {
    const env = migrateV1(null)
    assert.equal(env.v, 2)
    assert.deepEqual(env.state.topics, {})
    assert.deepEqual(env.state.opinion_builders, {})
    assert.deepEqual(env.state.evolved_takes, [])
    assert.equal(env.state.baseline_done, false)
    assert.equal(env.state.total_xp, 0)
  })

  it('non-JSON garbage -> fresh envelope, never throws', () => {
    assert.doesNotThrow(() => migrateV1('not json at all {{{'))
    const env = migrateV1('not json at all {{{')
    assert.equal(env.v, 2)
    assert.equal(env.state.total_xp, 0)
  })

  it('truncated JSON -> fresh envelope, never throws', () => {
    const truncated = JSON.stringify(MID_PROGRESS_V1).slice(0, 40)
    assert.doesNotThrow(() => migrateV1(truncated))
    const env = migrateV1(truncated)
    assert.equal(env.v, 2)
    assert.equal(env.state.total_xp, 0)
  })

  it('fresh default v1 migrates losslessly (all flags false, xp 0)', () => {
    const env = migrateV1(JSON.stringify(FRESH_V1))
    assert.equal(env.state.total_xp, 0)
    assert.equal(env.state.topics.immigration.unlocked, true)
    assert.equal(env.state.topics.immigration.currentLevel, 1)
    assert.equal(env.state.topics.immigration.levels['1'].flashcardsComplete, false)
    assert.equal(env.state.topics.taxes.unlocked, false)
    assert.equal(Object.keys(env.state.opinion_builders).length, 10)
    for (const ob of Object.values(env.state.opinion_builders)) {
      assert.equal(ob.completed, false)
    }
    assert.deepEqual(env.state.evolved_takes, [])
  })

  it('mid-progress v1 carries over every completion flag and score', () => {
    const env = migrateV1(JSON.stringify(MID_PROGRESS_V1))
    assert.equal(env.state.total_xp, 175)
    assert.equal(env.state.topics.immigration.currentLevel, 2)
    assert.equal(env.state.topics.immigration.levels['1'].flashcardsComplete, true)
    assert.equal(env.state.topics.immigration.levels['1'].quizComplete, true)
    assert.equal(env.state.topics.immigration.levels['1'].quizScore, 3)
    assert.equal(env.state.topics.immigration.levels['2'].flashcardsComplete, false)
    // no XP-named field anywhere under topics
    assert.doesNotThrow(() => validateEnvelope(env))
  })

  it('v1 with evolved takes extracts them into evolved_takes, flags-only opinion_builders', () => {
    const env = migrateV1(JSON.stringify(EVOLVED_TAKES_V1))
    assert.equal(env.state.total_xp, 425)
    assert.equal(env.state.opinion_builders['imm-ob-01'].completed, true)
    assert.equal('coldTake' in env.state.opinion_builders['imm-ob-01'], false)
    assert.equal('evolvedTake' in env.state.opinion_builders['imm-ob-01'], false)
    assert.equal('xpEarned' in env.state.opinion_builders['imm-ob-01'], false)

    assert.equal(env.state.evolved_takes.length, 2)
    const immTake = env.state.evolved_takes.find((t) => t.opinion_builder_id === 'imm-ob-01')
    assert.ok(immTake)
    assert.equal(immTake.topic_id, 'immigration')
    assert.equal(immTake.cold_take, 'Immigration is bad.')
    assert.equal(immTake.evolved_take, 'Immigration policy involves real tradeoffs I hadn’t considered.')
    assert.equal(typeof immTake.is_custom, 'boolean')

    const taxTake = env.state.evolved_takes.find((t) => t.opinion_builder_id === 'tax-ob-01')
    assert.ok(taxTake)
    assert.equal(taxTake.topic_id, 'taxes')
  })

  it('migrated envelope always passes validateEnvelope', () => {
    for (const fixture of [FRESH_V1, MID_PROGRESS_V1, EVOLVED_TAKES_V1]) {
      const env = migrateV1(JSON.stringify(fixture))
      assert.doesNotThrow(() => validateEnvelope(env))
    }
  })
})

// ─── anon_id ─────────────────────────────────────────────────────────────────

describe('anon_id', () => {
  it('matches UUID v4 format', () => {
    const id = getAnonId()
    assert.match(id, UUID_V4_RE)
  })

  it('1000 mints in a loop are all unique', () => {
    const ids = new Set()
    for (let i = 0; i < 1000; i++) {
      // fresh envelope each time -> fresh anon_id each time
      globalThis.localStorage.clear()
      ids.add(getAnonId())
    }
    assert.equal(ids.size, 1000)
  })

  it('persisted id is stable across loadEnvelope() calls', () => {
    globalThis.localStorage.clear()
    const first = loadEnvelope().anon_id
    const second = loadEnvelope().anon_id
    const third = getAnonId()
    assert.equal(first, second)
    assert.equal(second, third)
  })

  it('source contains no Math.random / homegrown generator (static check backing the required code-inspection review)', () => {
    const src = readFileSync(fileURLToPath(new URL('./guest.js', import.meta.url)), 'utf8')
    assert.doesNotMatch(src, /Math\.random/)
    // crypto.randomUUID must be the only id-minting call site.
    const mintCalls = src.match(/randomUUID\(\)/g) ?? []
    assert.ok(mintCalls.length >= 1)
  })
})

// ─── round trip / save validation ──────────────────────────────────────────

describe('saveEnvelope / loadEnvelope round trip', () => {
  it('saveEnvelope(loadEnvelope()) is idempotent', () => {
    globalThis.localStorage.clear()
    const env = loadEnvelope()
    const before = globalThis.localStorage.getItem(V2_KEY)
    saveEnvelope(env)
    const after = globalThis.localStorage.getItem(V2_KEY)
    assert.equal(before, after)
  })

  it('rejects wrong v', () => {
    const env = loadEnvelope()
    assert.throws(() => saveEnvelope({ ...env, v: 1 }))
    assert.throws(() => saveEnvelope({ ...env, v: 3 }))
  })

  it('rejects missing anon_id', () => {
    const env = loadEnvelope()
    // eslint-disable-next-line no-unused-vars
    const { anon_id, ...rest } = env
    assert.throws(() => saveEnvelope(rest))
    assert.throws(() => saveEnvelope({ ...env, anon_id: '' }))
  })

  it('rejects XP numbers inside topics (flags only)', () => {
    const env = loadEnvelope()
    const tainted = {
      ...env,
      state: {
        ...env.state,
        topics: {
          immigration: {
            unlocked: true,
            currentLevel: 1,
            levels: { 1: { flashcardsComplete: true, quizComplete: true, quizScore: 3, xp: 50 } },
          },
        },
      },
    }
    assert.throws(() => saveEnvelope(tainted))
  })
})

// ─── malformed v2 on load is quarantined ───────────────────────────────────

describe('malformed v2 envelope on load', () => {
  it('quarantines the raw blob and replaces it with a fresh/migrated envelope', () => {
    globalThis.localStorage.clear()
    globalThis.localStorage.setItem(V2_KEY, '{"v":2,"anon_id":123, this is not valid json')
    const env = loadEnvelope()
    assert.doesNotThrow(() => validateEnvelope(env))
    assert.equal(
      globalThis.localStorage.getItem(V2_CORRUPT_BACKUP_KEY),
      '{"v":2,"anon_id":123, this is not valid json',
    )
  })

  it('quarantines a structurally-valid-JSON-but-schema-invalid envelope', () => {
    globalThis.localStorage.clear()
    const badShape = JSON.stringify({ v: 1, anon_id: 'not-a-real-envelope' })
    globalThis.localStorage.setItem(V2_KEY, badShape)
    const env = loadEnvelope()
    assert.doesNotThrow(() => validateEnvelope(env))
    assert.equal(globalThis.localStorage.getItem(V2_CORRUPT_BACKUP_KEY), badShape)
  })
})

// ─── v1 backup preservation ─────────────────────────────────────────────────

describe('v1 backup preservation on corrupt migration', () => {
  it('preserves the raw v1 blob under civic_progress_v1_backup when v1 JSON is corrupt', () => {
    globalThis.localStorage.clear()
    const garbage = '{"user": totally not json'
    globalThis.localStorage.setItem(V1_KEY, garbage)
    const env = loadEnvelope()
    assert.doesNotThrow(() => validateEnvelope(env))
    assert.equal(globalThis.localStorage.getItem(V1_BACKUP_KEY), garbage)
  })

  it('does not write a v1 backup when v1 key is simply absent', () => {
    globalThis.localStorage.clear()
    loadEnvelope()
    assert.equal(globalThis.localStorage.getItem(V1_BACKUP_KEY), null)
  })

  it('does not write a v1 backup when v1 JSON parses fine (even if partial)', () => {
    globalThis.localStorage.clear()
    globalThis.localStorage.setItem(V1_KEY, JSON.stringify({ user: { totalXP: 10 } }))
    loadEnvelope()
    assert.equal(globalThis.localStorage.getItem(V1_BACKUP_KEY), null)
  })
})

// ─── clearEnvelope ──────────────────────────────────────────────────────────

describe('clearEnvelope', () => {
  it('removes the v2 key', () => {
    globalThis.localStorage.clear()
    loadEnvelope()
    assert.ok(globalThis.localStorage.getItem(V2_KEY) !== null)
    clearEnvelope()
    assert.equal(globalThis.localStorage.getItem(V2_KEY), null)
  })
})

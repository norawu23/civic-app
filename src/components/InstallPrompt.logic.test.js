// src/components/InstallPrompt.logic.test.js
//
// Executable coverage of the pure logic backing InstallPrompt.jsx
// (max-2-shows, dismiss persistence, iOS detection), imported from
// ./installPromptLogic.js — a plain-.js sibling module with no JSX, so it
// can be loaded directly by Node's built-in test runner (Node cannot parse
// JSX; InstallPrompt.jsx itself is therefore NOT import-able from a plain
// `node --test` run). See InstallPrompt.test.jsx for the full RTL
// rendering smoke test, which IS blocked on missing tooling (documented
// there); this file is the real, currently-running substitute for the
// "dismiss persists" / "max-2-shows honored" required-test bullets.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadMeta,
  saveMeta,
  canShowPrompt,
  recordShown,
  recordDismissed,
  isIOSUserAgent,
  isStandalone,
} from './installPromptLogic.js'

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  }
}

describe('InstallPrompt meta persistence', () => {
  it('loadMeta defaults to shownCount 0, dismissed false when nothing stored', () => {
    const storage = createMockStorage()
    assert.deepEqual(loadMeta(storage), { shownCount: 0, dismissed: false })
  })

  it('loadMeta tolerates garbage in storage', () => {
    const storage = createMockStorage()
    storage.setItem('civic_install_prompt_meta', 'not json')
    assert.deepEqual(loadMeta(storage), { shownCount: 0, dismissed: false })
  })

  it('saveMeta then loadMeta round-trips', () => {
    const storage = createMockStorage()
    saveMeta(storage, { shownCount: 1, dismissed: false })
    assert.deepEqual(loadMeta(storage), { shownCount: 1, dismissed: false })
  })
})

describe('canShowPrompt / max-2-shows', () => {
  it('allows showing while shownCount < 2 and not dismissed', () => {
    assert.equal(canShowPrompt({ shownCount: 0, dismissed: false }), true)
    assert.equal(canShowPrompt({ shownCount: 1, dismissed: false }), true)
  })

  it('stops allowing once shownCount reaches 2 (max-2-shows honored)', () => {
    assert.equal(canShowPrompt({ shownCount: 2, dismissed: false }), false)
    assert.equal(canShowPrompt({ shownCount: 3, dismissed: false }), false)
  })

  it('simulated session sequence: shown, shown, then never again', () => {
    let meta = { shownCount: 0, dismissed: false }
    // session 1 mounts, records a show
    assert.equal(canShowPrompt(meta), true)
    meta = recordShown(meta)
    // session 2 mounts, records a show
    assert.equal(canShowPrompt(meta), true)
    meta = recordShown(meta)
    // session 3 mounts: must not show anymore
    assert.equal(canShowPrompt(meta), false)
  })
})

describe('dismiss persists', () => {
  it('recordDismissed makes canShowPrompt false even with shownCount still under the cap', () => {
    let meta = { shownCount: 1, dismissed: false }
    meta = recordDismissed(meta)
    assert.equal(canShowPrompt(meta), false)
  })

  it('dismissal round-trips through storage (simulating "persists across sessions")', () => {
    const storage = createMockStorage()
    let meta = loadMeta(storage)
    meta = recordDismissed(meta)
    saveMeta(storage, meta)

    // new "session" re-reads from the same storage
    const reloaded = loadMeta(storage)
    assert.equal(canShowPrompt(reloaded), false)
  })
})

describe('platform detection', () => {
  it('isIOSUserAgent matches iPhone/iPad/iPod UAs', () => {
    assert.equal(
      isIOSUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      ),
      true,
    )
    assert.equal(
      isIOSUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
      true,
    )
  })

  it('isIOSUserAgent does not match Android/desktop UAs', () => {
    assert.equal(
      isIOSUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120'),
      false,
    )
    assert.equal(
      isIOSUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
      ),
      false,
    )
  })

  it('isStandalone true when navigator.standalone is set (iOS installed PWA)', () => {
    assert.equal(isStandalone({ navigatorStandalone: true }), true)
  })

  it('isStandalone true when display-mode:standalone media query matches', () => {
    assert.equal(isStandalone({ matchesDisplayModeStandalone: true }), true)
  })

  it('isStandalone false otherwise', () => {
    assert.equal(isStandalone({}), false)
    assert.equal(isStandalone(), false)
  })
})

// src/components/installPromptLogic.js
//
// Pure logic backing InstallPrompt.jsx, split into its own plain-.js module
// so it can be unit-tested with Node's built-in test runner without a JSX
// transform (Node cannot parse JSX natively, and this repo has no
// vitest/babel/esbuild dev-loader wired up yet — see the handoff notes for
// C1). InstallPrompt.jsx imports everything from here.

const META_KEY = 'civic_install_prompt_meta'
const MAX_SHOWS = 2

export function loadMeta(storage) {
  try {
    const raw = storage.getItem(META_KEY)
    if (!raw) return { shownCount: 0, dismissed: false }
    const parsed = JSON.parse(raw)
    return {
      shownCount: typeof parsed?.shownCount === 'number' ? parsed.shownCount : 0,
      dismissed: !!parsed?.dismissed,
    }
  } catch {
    return { shownCount: 0, dismissed: false }
  }
}

export function saveMeta(storage, meta) {
  try {
    storage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // best-effort — presentation-only, never throw over this
  }
}

export function canShowPrompt(meta) {
  return !meta.dismissed && meta.shownCount < MAX_SHOWS
}

export function recordShown(meta) {
  return { ...meta, shownCount: meta.shownCount + 1 }
}

export function recordDismissed(meta) {
  return { ...meta, dismissed: true }
}

export function isIOSUserAgent(ua) {
  return /iP(hone|ad|od)/.test(ua || '')
}

export function isStandalone({ navigatorStandalone, matchesDisplayModeStandalone } = {}) {
  return !!navigatorStandalone || !!matchesDisplayModeStandalone
}

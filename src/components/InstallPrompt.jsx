// src/components/InstallPrompt.jsx
//
// Chunk C1 — PWA install prompt, the iOS-Safari 7-day-eviction mitigation
// [r6] (see docs/specs/C1-guest-envelope-v2.md). Presentation-only: this
// component owns no envelope/progress state and does not import
// src/data-layer/guest.js — it tracks its own tiny "have we shown this
// enough" flag in a dedicated localStorage key, entirely separate from the
// guest envelope schema.
//
// Two paths:
//   - Chromium (and other browsers that fire `beforeinstallprompt`):
//     capture the event, show a custom "Install" button that calls
//     event.prompt() on click.
//   - iOS Safari (no beforeinstallprompt support at all): show static
//     instructions ("Share -> Add to Home Screen"). There is no
//     programmatic install API on iOS; this is the only lever [r6] has.
//
// Both variants are dismissible and shown at most twice total (persisted
// across sessions), per the chunk's definition of done.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadMeta,
  saveMeta,
  canShowPrompt,
  recordShown,
  recordDismissed,
  isIOSUserAgent,
  isStandalone,
} from './installPromptLogic.js'

// Pure logic (testable without a DOM/React renderer) lives in
// ./installPromptLogic.js — import from there directly, not from this file.

function detectInitialPlatform() {
  if (typeof navigator === 'undefined') return 'none'
  const ios =
    isIOSUserAgent(navigator.userAgent) &&
    !isStandalone({
      navigatorStandalone: navigator.standalone,
      matchesDisplayModeStandalone:
        typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
    })
  return ios ? 'ios' : 'none'
}

function safeStorage() {
  try {
    // touch it — throws in some locked-down contexts even to reference
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

const NOOP_STORAGE = {
  getItem: () => null,
  setItem: () => {},
}

// ─── component ──────────────────────────────────────────────────────────────

function InstallPrompt() {
  const storage = safeStorage() ?? NOOP_STORAGE
  const [meta, setMeta] = useState(() => loadMeta(storage))
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  // 'chromium' | 'ios' | 'none' — iOS is a UA-based fact that can't change
  // for the life of the component, so it's decided once at init; 'chromium'
  // only ever arrives later, asynchronously, via the real browser signal.
  const [platform, setPlatform] = useState(() => detectInitialPlatform())

  // Subscribes to the one external signal this component cares about. The
  // state update happens inside the event callback (not synchronously in
  // the effect body), matching the "subscribe, setState on external change"
  // effect pattern rather than deriving state during the effect itself.
  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault()
      setDeferredPrompt(e)
      setPlatform('chromium')
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  const visible = platform !== 'none' && canShowPrompt(meta)

  // Persist a "shown" impression exactly once per mount, the first time a
  // platform becomes known — deliberately does NOT call setMeta: this
  // session's visibility is decided from the `meta` already in state: what
  // this writes only affects whether *future* mounts still count as
  // eligible (max-2-shows). Keeping it a plain localStorage write (no
  // setState) avoids re-render churn during the effect entirely.
  const hasRecordedShowRef = useRef(false)
  useEffect(() => {
    if (platform === 'none') return
    if (hasRecordedShowRef.current) return
    if (!canShowPrompt(meta)) return
    hasRecordedShowRef.current = true
    saveMeta(storage, recordShown(meta))
    // Intentionally keyed only on `platform`: this must fire exactly once
    // per mount, the first time platform resolves to something show-able.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform])

  const handleDismiss = useCallback(() => {
    setMeta((prev) => {
      const next = recordDismissed(prev)
      saveMeta(storage, next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } catch {
      // ignore — user dismissed the native prompt
    }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  if (!visible) return null

  return (
    <div style={styles.banner} role="dialog" aria-label="Install CIVIC">
      {platform === 'chromium' ? (
        <>
          <p style={styles.text}>Install CIVIC for quick access, even offline.</p>
          <div style={styles.actions}>
            <button style={styles.primaryBtn} onClick={handleInstallClick}>
              Install
            </button>
            <button style={styles.ghostBtn} onClick={handleDismiss}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={styles.text}>
            Add CIVIC to your Home Screen: tap <strong>Share</strong>, then{' '}
            <strong>Add to Home Screen</strong>.
          </p>
          <button style={styles.ghostBtn} onClick={handleDismiss}>
            Got it
          </button>
        </>
      )}
    </div>
  )
}

const styles = {
  banner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    padding: '0.9rem 1rem',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.08)',
    border: '1.5px solid rgba(255,255,255,0.16)',
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'sans-serif',
  },
  text: {
    margin: 0,
    fontSize: '0.9rem',
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
  },
  primaryBtn: {
    flex: 1,
    padding: '0.6rem',
    background: '#ffffff',
    color: '#1A3C5E',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: '700',
    cursor: 'pointer',
  },
  ghostBtn: {
    flex: 1,
    padding: '0.6rem',
    background: 'transparent',
    color: 'rgba(255,255,255,0.75)',
    border: '1.5px solid rgba(255,255,255,0.2)',
    borderRadius: '10px',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default InstallPrompt

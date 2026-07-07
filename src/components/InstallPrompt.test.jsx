// src/components/InstallPrompt.test.jsx
//
// ******************************************************************
// NOT EXECUTED IN THIS CHUNK — BLOCKED ON MISSING DEVDEPENDENCIES.
// ******************************************************************
//
// This is the RTL smoke test named explicitly in the C1 spec's "Required
// tests" section ("renders on simulated beforeinstallprompt, dismiss
// persists, max-2-shows honored"). It is written in full against
// @testing-library/react + vitest, matching the "Vitest-style tests"
// convention referenced in the build protocol — but none of the following
// are installed in this repo, and the protocol forbids adding npm
// dependencies without operator approval:
//
//   - vitest (or another test runner with a JSX/ESM transform)
//   - jsdom or happy-dom (a DOM implementation Node doesn't ship)
//   - @testing-library/react (+ @testing-library/jest-dom, optional)
//
// I did NOT install these. This file will fail with MODULE_NOT_FOUND if
// run as-is (`node --test` cannot parse JSX or resolve these imports).
//
// REQUESTED as an operator-approved devDependency addition:
//   vitest, jsdom, @testing-library/react
//
// Until then, src/components/InstallPrompt.logic.test.js is the real,
// currently-passing substitute: it exercises the exact same behaviors
// (max-2-shows, dismiss persistence, iOS vs. Chromium branch selection)
// via the pure functions InstallPrompt.jsx is built from, without
// requiring a DOM renderer. Only the literal "does it render into a DOM
// on a simulated beforeinstallprompt event" assertion below is NOT
// covered by that substitute.
//
// -------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InstallPrompt from './InstallPrompt.jsx'

function fireBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn()
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  localStorage.clear()
})

describe('InstallPrompt (RTL)', () => {
  it('renders nothing until a beforeinstallprompt (or iOS) signal arrives', () => {
    render(<InstallPrompt />)
    expect(screen.queryByRole('dialog', { name: /install civic/i })).toBeNull()
  })

  it('renders the Chromium install banner on a simulated beforeinstallprompt event', async () => {
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    expect(await screen.findByRole('dialog', { name: /install civic/i })).toBeInTheDocument()
    expect(screen.getByText(/install civic for quick access/i)).toBeInTheDocument()
  })

  it('dismiss persists: dismissing hides the prompt and it stays hidden on remount', async () => {
    const { unmount } = render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    fireEvent.click(await screen.findByText(/not now/i))
    expect(screen.queryByRole('dialog')).toBeNull()

    unmount()
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    // dismissed persists across "sessions" (remounts) via localStorage
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('max-2-shows honored: a third mount+event never shows the prompt again', async () => {
    for (let i = 0; i < 2; i++) {
      const { unmount } = render(<InstallPrompt />)
      fireBeforeInstallPrompt()
      await screen.findByRole('dialog')
      unmount()
    }

    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

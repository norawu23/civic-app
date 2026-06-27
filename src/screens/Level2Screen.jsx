import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

// ─── Progress pips ────────────────────────────────────────────────────────────

function ProgressPips({ total, current }) {
  return (
    <div style={styles.pipsRow}>
      {Array.from({ length: total }, (_, i) => {
        let bg
        if (i < current) bg = '#ffffff'
        else if (i === current) bg = 'rgba(255,255,255,0.55)'
        else bg = 'rgba(255,255,255,0.18)'
        return <div key={i} style={{ ...styles.pip, background: bg }} />
      })}
    </div>
  )
}

// ─── Completion screen ────────────────────────────────────────────────────────

function CompletionScreen({ topicTitle, onContinue }) {
  return (
    <div style={styles.completionWrap}>
      <div style={styles.unlockCircle}>🔓</div>
      <h2 style={styles.unlockTitle}>Opinion Builder Unlocked</h2>
      <p style={styles.unlockSub}>
        You've explored the key perspectives on {topicTitle}. Now it's time to build your own view.
      </p>
      <button style={styles.opinionBtn} onClick={onContinue}>
        Go to Opinion Builder →
      </button>
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function Level2Screen({ topicId, onBack, onComplete }) {
  const cards = TOPICS[topicId].levels.level2.cards
  const subtitle = TOPICS[topicId].levels.level2.title
  const topicTitle = TOPICS[topicId].title

  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)

  const card = cards[index]
  const isLast = index === cards.length - 1

  const handleNext = () => {
    if (isLast) setDone(true)
    else setIndex(i => i + 1)
  }

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>←</button>
        <div style={styles.headerMid}>
          <span style={styles.headerTitle}>{topicTitle} · Level 2</span>
          {!done && <ProgressPips total={cards.length} current={index} />}
        </div>
        <div style={{ width: '40px', flexShrink: 0 }} />
      </div>

      {done ? (
        <CompletionScreen topicTitle={topicTitle} onContinue={onComplete} />
      ) : (
        <div style={styles.body}>
          {/* Card — key forces remount on index change, resetting scroll */}
          <div key={index} style={styles.card}>
            <p style={styles.cardEyebrow}>
              {index + 1} of {cards.length} &middot; {subtitle}
            </p>
            <h2 style={styles.cardTitle}>{card.title}</h2>
            <p style={styles.cardContent}>{card.content}</p>
          </div>

          <button style={styles.nextBtn} onClick={handleNext}>
            {isLast ? 'Finish →' : 'Next →'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-bg)',
    fontFamily: 'sans-serif',
  },

  /* Header */
  header: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--color-navy)',
    padding: '1rem 1rem 1.25rem',
    gap: '0.5rem',
  },
  backBtn: {
    width: '44px',
    height: '44px',
    flexShrink: 0,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '12px',
    color: '#ffffff',
    fontSize: '1.1rem',
    cursor: 'pointer',
  },
  headerMid: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.6rem',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: '0.875rem',
    fontWeight: '600',
    letterSpacing: '0.01em',
  },
  pipsRow: {
    display: 'flex',
    gap: '6px',
  },
  pip: {
    width: '28px',
    height: '5px',
    borderRadius: '3px',
    transition: 'background 0.3s',
  },

  /* Body */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem',
    gap: '1.25rem',
    overflow: 'auto',
  },

  /* Reading card */
  card: {
    flex: 1,
    background: 'var(--color-card)',
    border: '1px solid #e9ecef',
    borderRadius: '16px',
    borderLeft: '4px solid var(--color-blue)',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.875rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  cardEyebrow: {
    margin: 0,
    fontSize: '0.7rem',
    fontWeight: '700',
    color: 'var(--color-blue)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.35rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
    lineHeight: 1.25,
  },
  cardContent: {
    margin: 0,
    fontSize: '0.975rem',
    color: '#374151',
    lineHeight: 1.8,
  },

  /* Next button */
  nextBtn: {
    flexShrink: 0,
    width: '100%',
    padding: '14px 20px',
    background: 'var(--color-navy)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '16px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
  },

  /* Completion */
  completionWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2.5rem 1.5rem',
    gap: '0.875rem',
  },
  unlockCircle: {
    fontSize: '3.5rem',
    lineHeight: 1,
    marginBottom: '0.25rem',
  },
  unlockTitle: {
    margin: 0,
    fontSize: '1.6rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
    textAlign: 'center',
  },
  unlockSub: {
    margin: '0 0 1rem',
    fontSize: '0.9rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: '280px',
  },
  opinionBtn: {
    padding: '14px 2rem',
    background: 'var(--color-blue)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '16px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default Level2Screen

import { TOPICS } from '../data/topics.js'

function ColdTakePill({ value }) {
  const isYes = value === 'yes'
  return (
    <span
      style={{
        ...styles.coldTakePill,
        background: isYes ? '#f0fdf4' : '#fef2f2',
        color: isYes ? '#15803d' : '#b91c1c',
        border: `1px solid ${isYes ? '#86efac' : '#fca5a5'}`,
      }}
    >
      {isYes ? '👍 Yes' : '👎 No'}
    </span>
  )
}

function OpinionHubScreen({ topicId, ob1Progress, ob2Progress, onStartOB2 }) {
  const ob1 = TOPICS[topicId].opinionBuilders[0]
  const ob2 = TOPICS[topicId].opinionBuilders[1]
  const topicTitle = TOPICS[topicId].title
  const ob2Done = ob2Progress?.completed ?? false

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <p style={styles.headerEyebrow}>What Do You Think?</p>
        <p style={styles.headerTitle}>{topicTitle} · Opinion Builders</p>
      </div>

      <div style={styles.body}>
        {/* OB1 — completed */}
        <p style={styles.sectionLabel}>Completed</p>

        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <div style={styles.cardTitleGroup}>
              <span style={styles.cardTitle}>Opinion Builder 1</span>
              <span style={styles.doneBadge}>✓ Done</span>
            </div>
            <span style={styles.requiredPill}>Required</span>
          </div>
          <p style={styles.cardQuestion}>{ob1.question}</p>
          {ob1Progress?.coldTake && (
            <div style={styles.coldTakeRow}>
              <span style={styles.coldTakeLabel}>Your cold take</span>
              <ColdTakePill value={ob1Progress.coldTake} />
            </div>
          )}
        </div>

        {/* OB2 — optional */}
        <p style={{ ...styles.sectionLabel, marginTop: '0.375rem' }}>Optional</p>

        <div style={{ ...styles.card, ...styles.ob2Card }}>
          <div style={styles.cardTopRow}>
            <div style={styles.cardTitleGroup}>
              <span style={styles.cardTitle}>Opinion Builder 2</span>
              {ob2Done && <span style={styles.doneBadge}>✓ Done</span>}
            </div>
            <span style={styles.bonusXpPill}>+200 XP</span>
          </div>
          <p style={styles.cardQuestion}>{ob2.question}</p>

          {ob2Done ? (
            <div style={styles.coldTakeRow}>
              <span style={styles.coldTakeLabel}>Your cold take</span>
              <ColdTakePill value={ob2Progress.coldTake} />
            </div>
          ) : (
            <button style={styles.startBtn} onClick={onStartOB2}>
              Start Opinion Builder 2 →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#f5f7fa',
    fontFamily: 'sans-serif',
  },

  /* Header */
  header: {
    background: '#1A3C5E',
    padding: '1.25rem 1.25rem 1.25rem',
  },
  headerEyebrow: {
    margin: '0 0 0.2rem',
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  headerTitle: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '700',
    color: '#ffffff',
  },

  /* Body */
  body: {
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  sectionLabel: {
    margin: '0.25rem 0 0.25rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  /* Cards */
  card: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '1rem 1.125rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  ob2Card: {
    border: '1.5px solid #bfdbfe',
    background: '#f8fbff',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  cardTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  cardTitle: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: '#111827',
  },
  doneBadge: {
    fontSize: '0.65rem',
    fontWeight: '700',
    color: '#16a34a',
    background: '#dcfce7',
    padding: '0.15rem 0.45rem',
    borderRadius: '20px',
    letterSpacing: '0.02em',
  },
  requiredPill: {
    fontSize: '0.65rem',
    fontWeight: '600',
    color: '#6b7280',
    background: '#f3f4f6',
    padding: '0.15rem 0.5rem',
    borderRadius: '20px',
    flexShrink: 0,
  },
  bonusXpPill: {
    fontSize: '0.68rem',
    fontWeight: '700',
    color: '#ffffff',
    background: '#f59e0b',
    padding: '0.2rem 0.5rem',
    borderRadius: '20px',
    letterSpacing: '0.03em',
    flexShrink: 0,
  },
  cardQuestion: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#374151',
    lineHeight: 1.55,
  },
  coldTakeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    paddingTop: '0.125rem',
  },
  coldTakeLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#9ca3af',
  },
  coldTakePill: {
    fontSize: '0.78rem',
    fontWeight: '700',
    padding: '0.2rem 0.6rem',
    borderRadius: '20px',
  },
  startBtn: {
    marginTop: '0.125rem',
    width: '100%',
    padding: '0.8rem',
    background: '#185FA5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },
}

export default OpinionHubScreen

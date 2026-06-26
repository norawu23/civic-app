import { TOPICS } from '../data/topics.js'

// ─── Content card ─────────────────────────────────────────────────────────────

function ContentCard({ icon, title, detail, complete, locked, score, total, actionLabel, onAction }) {
  return (
    <div style={{ ...styles.card, opacity: locked ? 0.5 : 1 }}>
      <div style={{ ...styles.cardIconBox, background: locked ? '#e5e7eb' : '#EFF6FF' }}>
        <span style={styles.cardIcon}>{locked ? '🔒' : icon}</span>
      </div>

      <div style={styles.cardBody}>
        <div style={styles.cardTitleRow}>
          <span style={styles.cardTitle}>{title}</span>
          {complete && <span style={styles.doneBadge}>✓ Done</span>}
        </div>
        <p style={styles.cardDetail}>
          {detail}
          {complete && score != null ? ` · ${score}/${total}` : ''}
        </p>
      </div>

      <button
        style={{ ...styles.cardBtn, ...(locked ? styles.cardBtnDisabled : {}) }}
        onClick={locked ? undefined : onAction}
        disabled={locked}
      >
        {locked ? 'Locked' : actionLabel}
      </button>
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function LearnScreen({ topicId, progress, onNavigate }) {
  const data = TOPICS[topicId]
  const topicTitle = data.title
  const l1CardCount = data.levels.level1.flashcards.length
  const l1QuizCount = data.levels.level1.quiz.length
  const l3CardCount = data.levels.level3.cards.length
  const l3QuizCount = data.levels.level3.quiz.length
  const ob1Id = data.opinionBuilders[0]?.id

  const topicProgress = progress?.topics?.[topicId] ?? {}
  const l1 = topicProgress.levels?.['1'] ?? {}
  const flashcardsDone = l1.flashcardsComplete ?? false
  const quizDone = l1.quizComplete ?? false
  const opinionUnlocked = quizDone
  const ob1Done = ob1Id ? (progress?.opinionBuilders?.[ob1Id]?.completed ?? false) : false
  const l3 = topicProgress.levels?.['3'] ?? {}
  const l3Done = l3.quizComplete ?? false
  const l3Score = l3.quizScore ?? null

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <p style={styles.headerEyebrow}>Learn</p>
        <p style={styles.headerTitle}>{topicTitle}</p>
      </div>

      <div style={styles.body}>
        {/* Level 1 */}
        <p style={styles.sectionLabel}>Level 1 — How It Works</p>

        <ContentCard
          icon="🃏"
          title="Flashcards"
          detail={`${l1CardCount} terms`}
          complete={flashcardsDone}
          locked={false}
          actionLabel={flashcardsDone ? 'Review' : 'Start'}
          onAction={() => onNavigate('lesson')}
        />

        <ContentCard
          icon="📝"
          title="Level 1 Quiz"
          detail={`${l1QuizCount} questions`}
          complete={quizDone}
          locked={!flashcardsDone}
          score={l1.quizScore}
          total={l1QuizCount}
          actionLabel={quizDone ? 'Review' : 'Take quiz'}
          onAction={() => onNavigate('quiz')}
        />

        {/* Level 2 */}
        <p style={{ ...styles.sectionLabel, marginTop: '0.5rem' }}>Level 2 — Opinion Builder</p>

        <div style={{ ...styles.opinionCard, opacity: opinionUnlocked ? 1 : 0.5 }}>
          <div style={{ ...styles.cardIconBox, background: opinionUnlocked ? '#EFF6FF' : '#e5e7eb' }}>
            <span style={styles.cardIcon}>{opinionUnlocked ? '💬' : '🔒'}</span>
          </div>
          <div style={styles.cardBody}>
            <span style={styles.cardTitle}>Opinion Builder</span>
            <p style={styles.cardDetail}>
              {opinionUnlocked
                ? 'Available in the Opinion tab'
                : 'Complete Level 1 to unlock'}
            </p>
          </div>
          {opinionUnlocked && (
            <span style={styles.opinionArrow}>→</span>
          )}
        </div>

        {/* Level 3 */}
        <p style={{ ...styles.sectionLabel, marginTop: '0.5rem' }}>Level 3 — Current Events</p>

        <ContentCard
          icon="📰"
          title="Current Events"
          detail={`${l3CardCount} articles · ${l3QuizCount} questions`}
          complete={l3Done}
          locked={!ob1Done}
          score={l3Done ? l3Score : null}
          total={l3QuizCount}
          actionLabel={l3Done ? 'Review' : 'Start'}
          onAction={() => onNavigate('level3')}
        />
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    padding: '1.5rem 1.25rem 1.25rem',
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
    fontSize: '1.3rem',
    fontWeight: '700',
    color: '#ffffff',
  },

  /* Body */
  body: {
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  sectionLabel: {
    margin: '0.25rem 0 0.25rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  /* Content cards */
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem 0.875rem 0.875rem 1rem',
  },
  cardIconBox: {
    flexShrink: 0,
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIcon: {
    fontSize: '1.3rem',
    lineHeight: 1,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.2rem',
  },
  cardTitle: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#111827',
  },
  doneBadge: {
    fontSize: '0.65rem',
    fontWeight: '700',
    color: '#16a34a',
    background: '#dcfce7',
    padding: '0.15rem 0.4rem',
    borderRadius: '20px',
    letterSpacing: '0.02em',
  },
  cardDetail: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#9ca3af',
  },
  cardBtn: {
    flexShrink: 0,
    padding: '0.45rem 0.875rem',
    background: '#185FA5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.8rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  cardBtnDisabled: {
    background: '#e5e7eb',
    color: '#9ca3af',
    cursor: 'default',
  },

  /* Opinion Builder teaser */
  opinionCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem 0.875rem 0.875rem 1rem',
  },
  opinionArrow: {
    flexShrink: 0,
    fontSize: '1.1rem',
    color: '#9ca3af',
    paddingRight: '0.25rem',
  },
}

export default LearnScreen

const TOPICS = [
  {
    id: 'immigration',
    icon: '🗽',
    name: 'Immigration',
    level: 2,
    progress: 66,
    locked: false,
    badge: { label: 'Unlocked', color: '#16a34a', bg: '#dcfce7' },
  },
  {
    id: 'taxes',
    icon: '🧾',
    name: 'Taxes',
    level: 1,
    progress: 33,
    locked: false,
    badge: null,
  },
  {
    id: 'gerrymandering',
    icon: '🗺️',
    name: 'Gerrymandering',
    level: 1,
    progress: 0,
    locked: true,
    badge: null,
  },
]

function ProgressBar({ percent, locked }) {
  return (
    <div style={styles.progressTrack}>
      <div
        style={{
          ...styles.progressFill,
          width: `${percent}%`,
          background: locked ? '#9ca3af' : '#185FA5',
        }}
      />
    </div>
  )
}

function TopicCard({ topic }) {
  const dimmed = topic.locked

  return (
    <div style={{ ...styles.card, opacity: dimmed ? 0.5 : 1 }}>
      <div style={styles.cardLeft}>
        <div style={{ ...styles.iconBox, background: dimmed ? '#e5e7eb' : '#EFF6FF' }}>
          <span style={styles.icon}>{dimmed ? '🔒' : topic.icon}</span>
        </div>
      </div>

      <div style={styles.cardBody}>
        <div style={styles.cardHeader}>
          <span style={styles.topicName}>{topic.name}</span>
          {topic.badge && (
            <span style={{ ...styles.badge, color: topic.badge.color, background: topic.badge.bg }}>
              {topic.badge.label}
            </span>
          )}
        </div>

        <div style={styles.levelRow}>
          <span style={{ ...styles.levelText, color: dimmed ? '#9ca3af' : '#185FA5' }}>
            Level {topic.level}
          </span>
          <span style={styles.progressPercent}>{topic.locked ? 'Locked' : `${topic.progress}%`}</span>
        </div>

        <ProgressBar percent={topic.progress} locked={dimmed} />
      </div>
    </div>
  )
}

function HomeScreen() {
  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.greeting}>Good morning</h1>
        <p style={styles.subtext}>Keep your streak alive today</p>
      </div>

      {/* Streak bar */}
      <div style={styles.streakBar}>
        <div style={styles.streakLeft}>
          <span style={styles.fireEmoji}>🔥</span>
          <div>
            <p style={styles.streakTitle}>12-day streak</p>
            <p style={styles.streakSub}>Complete today's lesson to keep it</p>
          </div>
        </div>
        <div style={styles.xpBadge}>
          <span style={styles.xpText}>480 XP</span>
        </div>
      </div>

      {/* Topics section */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Your topics</p>

        {TOPICS.map(topic => (
          <TopicCard key={topic.id} topic={topic} />
        ))}
      </div>

      {/* CTA button */}
      <div style={styles.buttonRow}>
        <button style={styles.ctaButton}>
          Continue immigration &rarr; Level 2
        </button>
      </div>
    </div>
  )
}

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#f5f7fa',
    paddingBottom: '1.5rem',
  },

  /* Header */
  header: {
    background: '#1A3C5E',
    padding: '2rem 1.25rem 1.5rem',
  },
  greeting: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: '-0.01em',
  },
  subtext: {
    margin: '0.25rem 0 0',
    fontSize: '0.875rem',
    color: 'rgba(255,255,255,0.7)',
  },

  /* Streak bar */
  streakBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: '1rem 1.25rem',
    padding: '0.875rem 1rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
  },
  streakLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  fireEmoji: {
    fontSize: '1.75rem',
    lineHeight: 1,
  },
  streakTitle: {
    margin: 0,
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#1A3C5E',
  },
  streakSub: {
    margin: '0.1rem 0 0',
    fontSize: '0.75rem',
    color: '#6b7280',
  },
  xpBadge: {
    background: '#1A3C5E',
    borderRadius: '20px',
    padding: '0.35rem 0.75rem',
  },
  xpText: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: '0.03em',
  },

  /* Topics section */
  section: {
    padding: '0 1.25rem',
  },
  sectionTitle: {
    margin: '0 0 0.75rem',
    fontSize: '0.7rem',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  /* Cards */
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '0.75rem',
  },
  cardLeft: {
    flexShrink: 0,
  },
  iconBox: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: '1.5rem',
    lineHeight: 1,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.25rem',
  },
  topicName: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#111827',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    padding: '0.2rem 0.5rem',
    borderRadius: '20px',
    letterSpacing: '0.02em',
  },
  levelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '0.4rem',
  },
  levelText: {
    fontSize: '0.75rem',
    fontWeight: '500',
  },
  progressPercent: {
    fontSize: '0.7rem',
    color: '#9ca3af',
  },
  progressTrack: {
    height: '6px',
    background: '#e5e7eb',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.3s ease',
  },

  /* CTA button */
  buttonRow: {
    padding: '1.25rem 1.25rem 0',
  },
  ctaButton: {
    width: '100%',
    padding: '0.875rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },
}

export default HomeScreen

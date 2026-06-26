import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

// Static display config — icons/names for all topics including those without data yet
const TOPIC_CONFIG = [
  { id: 'immigration',   icon: '🗽', name: 'Immigration'    },
  { id: 'taxes',         icon: '💰', name: 'Taxes'          },
  { id: 'gerrymandering', icon: '🗳️', name: 'Gerrymandering' },
  { id: 'gunRights',     icon: '⚖️', name: 'Gun Rights'     },
  { id: 'climateChange', icon: '🌍', name: 'Climate Change'  },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Derive the UI-facing topic list from raw progress state.
// Uses a 4-milestone model (L1 flashcards, L1 quiz, OB1, L3 quiz) for all 3-level topics.
function deriveTopics(progress) {
  const topicsState = progress.topics
  const obs = progress.opinionBuilders ?? {}

  return TOPIC_CONFIG.map(({ id, icon, name }) => {
    const data = topicsState[id] ?? { unlocked: false, currentLevel: null, levels: {} }
    const locked = !data.unlocked
    const level = data.currentLevel ?? 1

    let pct = 0
    if (!locked) {
      const ob1Id = TOPICS[id]?.opinionBuilders?.[0]?.id
      const l1 = data.levels?.['1'] ?? {}
      const l3 = data.levels?.['3'] ?? {}
      const ob1Done = ob1Id ? (obs[ob1Id]?.completed ?? false) : false
      let done = 0
      if (l1.flashcardsComplete) done++
      if (l1.quizComplete) done++
      if (ob1Done) done++
      if (l3.quizComplete) done++
      pct = Math.round((done / 4) * 100)
    }

    const badge = (!locked && id !== 'immigration')
      ? { label: 'Unlocked', color: '#16a34a', bg: '#dcfce7' }
      : null

    return { id, icon, name, level, progress: pct, locked, badge }
  })
}

// Returns the CTA label + target topicId for the first incomplete unlocked topic,
// or null if everything is done.
function ctaInfo(topicsState, opinionBuilders) {
  for (const { id } of TOPIC_CONFIG) {
    const topicData = topicsState[id] ?? {}
    if (!topicData.unlocked) continue

    const l1 = topicData.levels?.['1'] ?? {}
    const l3 = topicData.levels?.['3'] ?? {}
    const ob1Id = TOPICS[id]?.opinionBuilders?.[0]?.id
    const ob1Done = ob1Id ? (opinionBuilders?.[ob1Id]?.completed ?? false) : false
    const title = TOPICS[id]?.title ?? id

    if (l3.quizComplete) continue  // this topic is done — try the next

    if (ob1Done) return { label: `Continue ${title} → Level 3`, topicId: id }
    if (l1.quizComplete) return { label: `Continue ${title} → Level 2`, topicId: id }
    if (l1.flashcardsComplete) return { label: `Take the ${title} Level 1 Quiz`, topicId: id }
    return { label: `Start ${title} flashcards → Level 1`, topicId: id }
  }
  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function TopicCard({ topic, isActive, onTap }) {
  const [pressed, setPressed] = useState(false)
  const dimmed = topic.locked
  return (
    <div
      style={{
        ...styles.card,
        opacity: dimmed ? 0.5 : 1,
        cursor: dimmed ? 'default' : 'pointer',
        border: isActive && !dimmed ? '2px solid #185FA5' : '1px solid #e5e7eb',
        background: isActive && !dimmed ? '#f0f7ff' : '#ffffff',
        transform: pressed && !dimmed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.12s ease, border-color 0.15s, background 0.15s',
      }}
      onClick={!dimmed ? onTap : undefined}
      onMouseDown={!dimmed ? () => setPressed(true) : undefined}
      onMouseUp={!dimmed ? () => setPressed(false) : undefined}
      onMouseLeave={!dimmed ? () => setPressed(false) : undefined}
      onTouchStart={!dimmed ? () => setPressed(true) : undefined}
      onTouchEnd={!dimmed ? () => setPressed(false) : undefined}
    >
      <div style={styles.cardLeft}>
        <div style={{ ...styles.iconBox, background: dimmed ? '#e5e7eb' : (isActive ? '#dbeafe' : '#EFF6FF') }}>
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
          <span style={styles.progressPercent}>
            {topic.locked ? 'Locked' : `${topic.progress}%`}
          </span>
        </div>

        <ProgressBar percent={topic.progress} locked={dimmed} />
      </div>

      {isActive && !dimmed && (
        <span style={styles.activeArrow}>›</span>
      )}
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function HomeScreen({ progress, onTopicSelect, activeTopic }) {
  const { user, topics: topicsState } = progress
  const topics = deriveTopics(progress)
  const cta = ctaInfo(topicsState, progress.opinionBuilders)

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.greeting}>{greeting()}</h1>
        <p style={styles.subtext}>Keep your streak alive today</p>
      </div>

      {/* Streak bar */}
      <div style={styles.streakBar}>
        <div style={styles.streakLeft}>
          <span style={styles.fireEmoji}>🔥</span>
          <div>
            <p style={styles.streakTitle}>{user.streak}-day streak</p>
            <p style={styles.streakSub}>Complete today's lesson to keep it</p>
          </div>
        </div>
        <div style={styles.xpBadge}>
          <span style={styles.xpText}>{user.totalXP} XP</span>
        </div>
      </div>

      {/* Topics */}
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Your topics</p>
        {topics.map(topic => (
          <TopicCard
            key={topic.id}
            topic={topic}
            isActive={topic.id === activeTopic}
            onTap={() => onTopicSelect(topic.id)}
          />
        ))}
      </div>

      {/* CTA — navigates directly to the right screen for the next actionable topic */}
      {cta && (
        <div style={styles.buttonRow}>
          <button style={styles.ctaButton} onClick={() => onTopicSelect(cta.topicId)}>
            {cta.label}
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
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    background: '#f5f7fa',
    paddingBottom: '1.5rem',
  },
  header: {
    background: '#1A3C5E',
    padding: '2rem 1.25rem 1.5rem',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    flexShrink: 0,
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
  cardLeft: { flexShrink: 0 },
  iconBox: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: '1.5rem', lineHeight: 1 },
  cardBody: { flex: 1, minWidth: 0 },
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
  activeArrow: {
    flexShrink: 0,
    fontSize: '1.4rem',
    color: '#185FA5',
    fontWeight: '700',
    lineHeight: 1,
    paddingRight: '0.125rem',
  },
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

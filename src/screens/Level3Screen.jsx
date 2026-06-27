import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

// ─── Progress pips (cards phase) ─────────────────────────────────────────────

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

function CompletionScreen({ topicTitle, score, total, onComplete }) {
  const pct = score / total
  const isStrong = pct >= 0.8

  const message =
    pct === 1
      ? "Perfect score! You've fully mastered the current events."
      : pct >= 0.8
      ? "Strong work! You have a solid grasp of what's happening now."
      : pct >= 0.6
      ? 'Good effort. Revisiting these events will deepen your understanding.'
      : 'Keep at it! Re-reading the cards will help lock this in.'

  return (
    <div style={styles.completionWrap}>
      <div
        style={{
          ...styles.scoreCircle,
          background: isStrong ? '#185FA5' : '#f3f4f6',
          border: isStrong ? 'none' : '3px solid #e5e7eb',
        }}
      >
        <span style={{ ...styles.scoreNum, color: isStrong ? '#ffffff' : '#1A3C5E' }}>
          {score}
        </span>
        <span style={{ ...styles.scoreOutOf, color: isStrong ? 'rgba(255,255,255,0.65)' : '#9ca3af' }}>
          /{total}
        </span>
      </div>

      <h2 style={styles.completionTitle}>{topicTitle} Complete!</h2>
      <p style={styles.completionSub}>
        You scored {score} out of {total} on the current events quiz.
      </p>
      <p style={styles.completionMsg}>{message}</p>

      <button style={styles.completeBtn} onClick={onComplete}>
        Complete Topic →
      </button>
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function Level3Screen({ topicId, onBack, onComplete }) {
  const cards = TOPICS[topicId].levels.level3.cards
  const questions = TOPICS[topicId].levels.level3.quiz
  const subtitle = TOPICS[topicId].levels.level3.title
  const topicTitle = TOPICS[topicId].title

  const [phase, setPhase] = useState('cards') // 'cards' | 'quiz' | 'done'
  const [cardIndex, setCardIndex] = useState(0)
  const [quizIndex, setQuizIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [score, setScore] = useState(0)

  // ── Card logic ──
  const card = cards[cardIndex]
  const isLastCard = cardIndex === cards.length - 1

  const handleNextCard = () => {
    if (isLastCard) setPhase('quiz')
    else setCardIndex(i => i + 1)
  }

  // ── Quiz logic ──
  const question = questions[quizIndex]
  const revealed = selectedIndex !== null
  const isLastQuestion = quizIndex === questions.length - 1

  const handleSelect = (idx) => {
    if (revealed) return
    setSelectedIndex(idx)
    if (idx === question.correctIndex) setScore(s => s + 1)
  }

  const handleNextQuestion = () => {
    if (isLastQuestion) {
      setPhase('done')
    } else {
      setQuizIndex(i => i + 1)
      setSelectedIndex(null)
    }
  }

  // ── Quiz option styles (matching QuizScreen) ──
  const optionStyle = (idx) => {
    if (!revealed) return styles.option
    if (idx === question.correctIndex) return { ...styles.option, ...styles.optionCorrect }
    if (idx === selectedIndex) return { ...styles.option, ...styles.optionWrong }
    return { ...styles.option, ...styles.optionDimmed }
  }

  const bulletStyle = (idx) => {
    if (!revealed) return styles.bullet
    if (idx === question.correctIndex) return { ...styles.bullet, ...styles.bulletCorrect }
    if (idx === selectedIndex) return { ...styles.bullet, ...styles.bulletWrong }
    return { ...styles.bullet, ...styles.bulletDimmed }
  }

  // ── Completion ──
  if (phase === 'done') {
    return (
      <div style={styles.screen}>
        <CompletionScreen
          topicTitle={topicTitle}
          score={score}
          total={questions.length}
          onComplete={() => onComplete(score, questions.length)}
        />
      </div>
    )
  }

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <button
          style={styles.backBtn}
          onClick={
            phase === 'cards'
              ? onBack
              : () => { setPhase('cards'); setCardIndex(cards.length - 1); setSelectedIndex(null) }
          }
        >
          ←
        </button>

        <div style={styles.headerMid}>
          {phase === 'cards' ? (
            <>
              <span style={styles.headerTitle}>{topicTitle} · Level 3</span>
              <ProgressPips total={cards.length} current={cardIndex} />
            </>
          ) : (
            <>
              <span style={styles.headerTitle}>Level 3 Quiz</span>
              <span style={styles.questionCount}>
                Question {quizIndex + 1} of {questions.length}
              </span>
            </>
          )}
        </div>

        <div style={{ width: '40px', flexShrink: 0 }} />
      </div>

      {/* Cards phase */}
      {phase === 'cards' && (
        <div style={styles.body}>
          <div key={cardIndex} style={styles.card}>
            <p style={styles.cardEyebrow}>
              {cardIndex + 1} of {cards.length} &middot; {subtitle}
            </p>
            <h2 style={styles.cardTitle}>{card.title}</h2>
            <p style={styles.cardContent}>{card.content}</p>
            <a
              href={card.source.url}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.readMoreLink}
            >
              {card.source.label} →
            </a>
          </div>

          <button style={styles.nextBtn} onClick={handleNextCard}>
            {isLastCard ? 'Take Quiz →' : 'Next →'}
          </button>
        </div>
      )}

      {/* Quiz phase */}
      {phase === 'quiz' && (
        <div style={styles.quizBody}>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${(quizIndex / questions.length) * 100}%`,
              }}
            />
          </div>

          <p style={styles.questionText}>{question.question}</p>

          <div style={styles.optionsList}>
            {question.options.map((opt, idx) => (
              <button key={idx} style={optionStyle(idx)} onClick={() => handleSelect(idx)}>
                <span style={bulletStyle(idx)}>{String.fromCharCode(65 + idx)}</span>
                <span style={styles.optionText}>{opt}</span>
                {revealed && idx === question.correctIndex && (
                  <span style={styles.iconCorrect}>✓</span>
                )}
                {revealed && idx === selectedIndex && idx !== question.correctIndex && (
                  <span style={styles.iconWrong}>✗</span>
                )}
              </button>
            ))}
          </div>

          <button
            style={{ ...styles.nextBtn, ...(revealed ? {} : styles.nextBtnDisabled) }}
            onClick={handleNextQuestion}
            disabled={!revealed}
          >
            {isLastQuestion ? 'See results' : 'Next question →'}
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
  questionCount: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: '0.75rem',
  },
  pipsRow: {
    display: 'flex',
    gap: '6px',
  },
  pip: {
    width: '22px',
    height: '5px',
    borderRadius: '3px',
    transition: 'background 0.3s',
  },

  /* Cards body */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem',
    gap: '1.25rem',
    overflow: 'auto',
  },
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
    overflow: 'auto',
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
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
    lineHeight: 1.3,
  },
  cardContent: {
    margin: 0,
    fontSize: '0.95rem',
    color: '#374151',
    lineHeight: 1.8,
    flex: 1,
  },
  readMoreLink: {
    display: 'inline-block',
    marginTop: '0.25rem',
    fontSize: '0.775rem',
    fontWeight: '600',
    color: 'var(--color-blue)',
    textDecoration: 'none',
    lineHeight: 1.4,
    borderBottom: '1px solid rgba(24,95,165,0.3)',
    paddingBottom: '1px',
  },

  /* Shared next button */
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
  nextBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },

  /* Quiz body */
  quizBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '0 1.25rem 1.75rem',
    overflow: 'auto',
  },
  progressTrack: {
    height: '4px',
    background: '#e9ecef',
    marginBottom: '1.75rem',
    borderRadius: '2px',
  },
  progressFill: {
    height: '100%',
    background: 'var(--color-blue)',
    transition: 'width 0.35s ease',
    borderRadius: '2px',
  },
  questionText: {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--color-text)',
    lineHeight: 1.6,
    margin: '0 0 1.25rem',
  },
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    flex: 1,
  },
  option: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '1rem 1rem',
    background: 'var(--color-card)',
    border: '1.5px solid #e9ecef',
    borderRadius: '16px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  optionCorrect: {
    background: 'rgba(76,175,80,0.08)',
    border: '1.5px solid var(--color-green)',
    cursor: 'default',
    boxShadow: 'none',
  },
  optionWrong: {
    background: 'rgba(255,107,107,0.08)',
    border: '1.5px solid var(--color-coral)',
    cursor: 'default',
    boxShadow: 'none',
  },
  optionDimmed: {
    background: '#fafafa',
    border: '1.5px solid #f0f0f0',
    cursor: 'default',
    opacity: 0.5,
    boxShadow: 'none',
  },
  bullet: {
    flexShrink: 0,
    marginTop: '1px',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: '#f0f0f0',
    color: 'var(--color-text-secondary)',
    fontSize: '0.72rem',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletCorrect: { background: 'var(--color-green)', color: '#ffffff' },
  bulletWrong:   { background: 'var(--color-coral)', color: '#ffffff' },
  bulletDimmed:  { background: '#e5e7eb', color: '#9ca3af' },
  optionText: {
    flex: 1,
    fontSize: '0.875rem',
    color: 'var(--color-text)',
    lineHeight: 1.5,
  },
  iconCorrect: {
    flexShrink: 0,
    color: 'var(--color-green)',
    fontWeight: '700',
    fontSize: '1rem',
    marginTop: '1px',
  },
  iconWrong: {
    flexShrink: 0,
    color: 'var(--color-coral)',
    fontWeight: '700',
    fontSize: '1rem',
    marginTop: '1px',
  },

  /* Completion */
  completionWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2.5rem 1.5rem',
    gap: '0.625rem',
  },
  scoreCircle: {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '1rem',
  },
  scoreNum: {
    fontSize: '2.5rem',
    fontWeight: '800',
    lineHeight: 1,
  },
  scoreOutOf: {
    fontSize: '1.1rem',
    fontWeight: '600',
    alignSelf: 'flex-end',
    marginBottom: '0.3rem',
    marginLeft: '2px',
  },
  completionTitle: {
    margin: '0 0 0.25rem',
    fontSize: '1.6rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
    textAlign: 'center',
  },
  completionSub: {
    margin: 0,
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  completionMsg: {
    margin: '0 0 1.5rem',
    fontSize: '0.875rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: '280px',
  },
  completeBtn: {
    width: '100%',
    maxWidth: '320px',
    padding: '14px 20px',
    background: 'var(--color-blue)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '16px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default Level3Screen

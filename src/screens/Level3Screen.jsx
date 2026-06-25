import { useState } from 'react'
import data from '../data/immigration.json'

const CARDS = data.levels.level3.cards
const QUESTIONS = data.levels.level3.quiz
const SUBTITLE = data.levels.level3.title // "What's Happening Now"

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

function CompletionScreen({ score, total, onComplete }) {
  const pct = score / total
  const isStrong = pct >= 0.8

  const message =
    pct === 1
      ? "Perfect score! You've fully mastered current immigration events."
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

      <h2 style={styles.completionTitle}>Immigration Complete!</h2>
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

function Level3Screen({ onBack, onComplete }) {
  const [phase, setPhase] = useState('cards') // 'cards' | 'quiz' | 'done'
  const [cardIndex, setCardIndex] = useState(0)
  const [quizIndex, setQuizIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [score, setScore] = useState(0)

  // ── Card logic ──
  const card = CARDS[cardIndex]
  const isLastCard = cardIndex === CARDS.length - 1

  const handleNextCard = () => {
    if (isLastCard) setPhase('quiz')
    else setCardIndex(i => i + 1)
  }

  // ── Quiz logic ──
  const question = QUESTIONS[quizIndex]
  const revealed = selectedIndex !== null
  const isLastQuestion = quizIndex === QUESTIONS.length - 1

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
          score={score}
          total={QUESTIONS.length}
          onComplete={() => onComplete(score, QUESTIONS.length)}
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
              : () => { setPhase('cards'); setCardIndex(CARDS.length - 1); setSelectedIndex(null) }
          }
        >
          ←
        </button>

        <div style={styles.headerMid}>
          {phase === 'cards' ? (
            <>
              <span style={styles.headerTitle}>Immigration · Level 3</span>
              <ProgressPips total={CARDS.length} current={cardIndex} />
            </>
          ) : (
            <>
              <span style={styles.headerTitle}>Level 3 Quiz</span>
              <span style={styles.questionCount}>
                Question {quizIndex + 1} of {QUESTIONS.length}
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
              {cardIndex + 1} of {CARDS.length} &middot; {SUBTITLE}
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
                width: `${(quizIndex / QUESTIONS.length) * 100}%`,
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
    background: '#f5f7fa',
    fontFamily: 'sans-serif',
  },

  /* Header */
  header: {
    display: 'flex',
    alignItems: 'center',
    background: '#1A3C5E',
    padding: '1rem 1rem 1.25rem',
    gap: '0.5rem',
  },
  backBtn: {
    width: '40px',
    height: '40px',
    flexShrink: 0,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '10px',
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
    padding: '1.25rem',
    gap: '1rem',
    overflow: 'auto',
  },
  card: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    borderLeft: '4px solid #185FA5',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    overflow: 'auto',
  },
  cardEyebrow: {
    margin: 0,
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#185FA5',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#1A3C5E',
    lineHeight: 1.3,
  },
  cardContent: {
    margin: 0,
    fontSize: '0.95rem',
    color: '#374151',
    lineHeight: 1.75,
    flex: 1,
  },
  readMoreLink: {
    display: 'inline-block',
    marginTop: '0.25rem',
    fontSize: '0.775rem',
    fontWeight: '600',
    color: '#185FA5',
    textDecoration: 'none',
    lineHeight: 1.4,
    borderBottom: '1px solid rgba(24,95,165,0.3)',
    paddingBottom: '1px',
  },

  /* Shared next button */
  nextBtn: {
    flexShrink: 0,
    width: '100%',
    padding: '0.9rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
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
    padding: '0 1.25rem 1.5rem',
    overflow: 'auto',
  },
  progressTrack: {
    height: '3px',
    background: '#e5e7eb',
    marginBottom: '1.5rem',
  },
  progressFill: {
    height: '100%',
    background: '#185FA5',
    transition: 'width 0.35s ease',
  },
  questionText: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#111827',
    lineHeight: 1.55,
    margin: '0 0 1.25rem',
  },
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    flex: 1,
  },
  option: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '0.875rem 1rem',
    background: '#ffffff',
    border: '1.5px solid #e5e7eb',
    borderRadius: '12px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
  },
  optionCorrect: {
    background: '#f0fdf4',
    border: '1.5px solid #16a34a',
    cursor: 'default',
  },
  optionWrong: {
    background: '#fef2f2',
    border: '1.5px solid #ef4444',
    cursor: 'default',
  },
  optionDimmed: {
    background: '#fafafa',
    border: '1.5px solid #f3f4f6',
    cursor: 'default',
    opacity: 0.55,
  },
  bullet: {
    flexShrink: 0,
    marginTop: '1px',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: '0.72rem',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletCorrect: { background: '#16a34a', color: '#ffffff' },
  bulletWrong: { background: '#ef4444', color: '#ffffff' },
  bulletDimmed: { background: '#e5e7eb', color: '#9ca3af' },
  optionText: {
    flex: 1,
    fontSize: '0.875rem',
    color: '#111827',
    lineHeight: 1.45,
  },
  iconCorrect: {
    flexShrink: 0,
    color: '#16a34a',
    fontWeight: '700',
    fontSize: '1rem',
    marginTop: '1px',
  },
  iconWrong: {
    flexShrink: 0,
    color: '#ef4444',
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
    padding: '2rem 1.5rem',
    gap: '0.5rem',
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
    color: '#1A3C5E',
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
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: '280px',
  },
  completeBtn: {
    width: '100%',
    maxWidth: '320px',
    padding: '0.9rem',
    background: '#185FA5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default Level3Screen

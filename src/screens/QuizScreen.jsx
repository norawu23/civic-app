import { useState } from 'react'
import data from '../data/immigration.json'

const QUESTIONS = data.levels.level1.quiz

function scoreMessage(score, total) {
  const pct = score / total
  if (pct === 1) return "Perfect score! You've completely mastered Level 1."
  if (pct >= 0.8) return "Great work! You're nearly there."
  if (pct >= 0.6) return "Good effort — a quick review will lock this in."
  return "Keep at it! Revisiting the flashcards will help."
}

function ResultsScreen({ score, total, onReview, onContinue }) {
  const pct = score / total
  const isStrong = pct >= 0.8

  return (
    <div style={styles.resultsWrap}>
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

      <h2 style={styles.scoreLine}>{score} out of {total}</h2>
      <p style={styles.scoreMsg}>{scoreMessage(score, total)}</p>

      <div style={styles.resultsBtns}>
        <button style={styles.reviewBtn} onClick={onReview}>
          Review flashcards
        </button>
        <button style={styles.continueBtn} onClick={onContinue}>
          Continue →
        </button>
      </div>
    </div>
  )
}

function QuizScreen({ onBack, onHome, onQuizComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  const question = QUESTIONS[currentIndex]
  const revealed = selectedIndex !== null
  const isLast = currentIndex === QUESTIONS.length - 1

  const handleSelect = (idx) => {
    if (revealed) return
    setSelectedIndex(idx)
    if (idx === question.correctIndex) {
      setScore(s => s + 1)
    }
  }

  const handleNext = () => {
    if (isLast) {
      onQuizComplete?.(score, QUESTIONS.length)
      setFinished(true)
    } else {
      setCurrentIndex(i => i + 1)
      setSelectedIndex(null)
    }
  }

  const optionStyle = (idx) => {
    const base = styles.option
    if (!revealed) return base
    if (idx === question.correctIndex) return { ...base, ...styles.optionCorrect }
    if (idx === selectedIndex) return { ...base, ...styles.optionWrong }
    return { ...base, ...styles.optionDimmed }
  }

  const bulletStyle = (idx) => {
    if (!revealed) return styles.bullet
    if (idx === question.correctIndex) return { ...styles.bullet, ...styles.bulletCorrect }
    if (idx === selectedIndex) return { ...styles.bullet, ...styles.bulletWrong }
    return { ...styles.bullet, ...styles.bulletDimmed }
  }

  const progressWidth = `${(currentIndex / QUESTIONS.length) * 100}%`

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>←</button>
        <div style={styles.headerMid}>
          <span style={styles.headerTitle}>Immigration · Level 1 Quiz</span>
          {!finished && (
            <span style={styles.questionCount}>
              Question {currentIndex + 1} of {QUESTIONS.length}
            </span>
          )}
        </div>
        <div style={{ width: '40px', flexShrink: 0 }} />
      </div>

      {finished ? (
        <ResultsScreen
          score={score}
          total={QUESTIONS.length}
          onReview={onBack}
          onContinue={onHome}
        />
      ) : (
        <div style={styles.body}>
          {/* Thin progress strip */}
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: progressWidth }} />
          </div>

          {/* Question */}
          <p style={styles.questionText}>{question.question}</p>

          {/* Options */}
          <div style={styles.optionsList}>
            {question.options.map((opt, idx) => (
              <button
                key={idx}
                style={optionStyle(idx)}
                onClick={() => handleSelect(idx)}
              >
                <span style={bulletStyle(idx)}>
                  {String.fromCharCode(65 + idx)}
                </span>
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

          {/* Next button */}
          <button
            style={{ ...styles.nextBtn, ...(revealed ? {} : styles.nextBtnDisabled) }}
            onClick={handleNext}
            disabled={!revealed}
          >
            {isLast ? 'See results' : 'Next question →'}
          </button>
        </div>
      )}
    </div>
  )
}

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
    gap: '0.25rem',
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

  /* Body */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '0 1.25rem 1.5rem',
    overflow: 'auto',
  },

  /* Progress strip */
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

  /* Question */
  questionText: {
    fontSize: '1.05rem',
    fontWeight: '600',
    color: '#111827',
    lineHeight: 1.5,
    margin: '0 0 1.25rem',
  },

  /* Options */
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    flex: 1,
  },
  option: {
    display: 'flex',
    alignItems: 'center',
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

  /* Option bullet */
  bullet: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: '0.75rem',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletCorrect: {
    background: '#16a34a',
    color: '#ffffff',
  },
  bulletWrong: {
    background: '#ef4444',
    color: '#ffffff',
  },
  bulletDimmed: {
    background: '#e5e7eb',
    color: '#9ca3af',
  },

  optionText: {
    flex: 1,
    fontSize: '0.9rem',
    color: '#111827',
    lineHeight: 1.4,
  },
  iconCorrect: {
    flexShrink: 0,
    color: '#16a34a',
    fontWeight: '700',
    fontSize: '1rem',
  },
  iconWrong: {
    flexShrink: 0,
    color: '#ef4444',
    fontWeight: '700',
    fontSize: '1rem',
  },

  /* Next button */
  nextBtn: {
    marginTop: '1.25rem',
    width: '100%',
    padding: '0.9rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    flexShrink: 0,
  },
  nextBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },

  /* Results */
  resultsWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1.5rem',
  },
  scoreCircle: {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '1.25rem',
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
  scoreLine: {
    margin: '0 0 0.5rem',
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#1A3C5E',
  },
  scoreMsg: {
    margin: '0 0 2rem',
    fontSize: '0.9rem',
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 1.55,
    maxWidth: '280px',
  },
  resultsBtns: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    width: '100%',
  },
  reviewBtn: {
    padding: '0.875rem',
    background: '#ffffff',
    border: '1.5px solid #1A3C5E',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#1A3C5E',
    cursor: 'pointer',
  },
  continueBtn: {
    padding: '0.875rem',
    background: '#1A3C5E',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#ffffff',
    cursor: 'pointer',
  },
}

export default QuizScreen

import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

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

function QuizScreen({ topicId, onBack, onHome, onQuizComplete }) {
  const questions = TOPICS[topicId].levels.level1.quiz
  const topicTitle = TOPICS[topicId].title

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  const question = questions[currentIndex]
  const revealed = selectedIndex !== null
  const isLast = currentIndex === questions.length - 1

  const handleSelect = (idx) => {
    if (revealed) return
    setSelectedIndex(idx)
    if (idx === question.correctIndex) {
      setScore(s => s + 1)
    }
  }

  const handleNext = () => {
    if (isLast) {
      onQuizComplete?.(score, questions.length)
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

  const progressWidth = `${(currentIndex / questions.length) * 100}%`

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>←</button>
        <div style={styles.headerMid}>
          <span style={styles.headerTitle}>{topicTitle} · Level 1 Quiz</span>
          {!finished && (
            <span style={styles.questionCount}>
              Question {currentIndex + 1} of {questions.length}
            </span>
          )}
        </div>
        <div style={{ width: '40px', flexShrink: 0 }} />
      </div>

      {finished ? (
        <ResultsScreen
          score={score}
          total={questions.length}
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
    padding: '0 1.25rem 1.75rem',
    overflow: 'auto',
  },

  /* Progress strip */
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

  /* Question */
  questionText: {
    fontSize: '1.05rem',
    fontWeight: '600',
    color: 'var(--color-text)',
    lineHeight: 1.55,
    margin: '0 0 1.25rem',
  },

  /* Options */
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    flex: 1,
  },
  option: {
    display: 'flex',
    alignItems: 'center',
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

  /* Option bullet */
  bullet: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: '#f0f0f0',
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletCorrect: {
    background: 'var(--color-green)',
    color: '#ffffff',
  },
  bulletWrong: {
    background: 'var(--color-coral)',
    color: '#ffffff',
  },
  bulletDimmed: {
    background: '#e5e7eb',
    color: '#9ca3af',
  },

  optionText: {
    flex: 1,
    fontSize: '0.9rem',
    color: 'var(--color-text)',
    lineHeight: 1.45,
  },
  iconCorrect: {
    flexShrink: 0,
    color: 'var(--color-green)',
    fontWeight: '700',
    fontSize: '1rem',
  },
  iconWrong: {
    flexShrink: 0,
    color: 'var(--color-coral)',
    fontWeight: '700',
    fontSize: '1rem',
  },

  /* Next button */
  nextBtn: {
    marginTop: '1.5rem',
    width: '100%',
    padding: '14px 20px',
    background: 'var(--color-navy)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '16px',
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
    padding: '2.5rem 1.5rem',
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
    color: 'var(--color-navy)',
  },
  scoreMsg: {
    margin: '0 0 2rem',
    fontSize: '0.9rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: '280px',
  },
  resultsBtns: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    width: '100%',
  },
  reviewBtn: {
    padding: '14px 20px',
    background: 'var(--color-card)',
    border: '1.5px solid var(--color-navy)',
    borderRadius: '16px',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--color-navy)',
    cursor: 'pointer',
  },
  continueBtn: {
    padding: '14px 20px',
    background: 'var(--color-navy)',
    border: 'none',
    borderRadius: '16px',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#ffffff',
    cursor: 'pointer',
  },
}

export default QuizScreen

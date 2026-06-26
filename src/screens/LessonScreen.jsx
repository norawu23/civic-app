import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

function ProgressPips({ total, completedCount }) {
  return (
    <div style={styles.pipsRow}>
      {Array.from({ length: total }, (_, i) => {
        let bg
        if (i < completedCount) bg = '#ffffff'
        else if (i === completedCount) bg = 'rgba(255,255,255,0.5)'
        else bg = 'rgba(255,255,255,0.18)'
        return <div key={i} style={{ ...styles.pip, background: bg }} />
      })}
    </div>
  )
}

function FlipCard({ card, isFlipped, onFlip }) {
  return (
    <div style={styles.perspective} onClick={onFlip}>
      <div
        style={{
          ...styles.cardInner,
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front — shows term */}
        <div style={styles.cardFace}>
          <p style={styles.tapHint}>Tap to reveal definition</p>
          <h2 style={styles.term}>{card.term}</h2>
          <p style={styles.tapHintBottom}>↕</p>
        </div>

        {/* Back — shows definition */}
        <div style={{ ...styles.cardFace, ...styles.cardFaceBack }}>
          <p style={styles.termLabel}>{card.term}</p>
          <p style={styles.definition}>{card.definition}</p>
        </div>
      </div>
    </div>
  )
}

function CompletionScreen({ cardCount, onContinueToQuiz }) {
  return (
    <div style={styles.completionWrap}>
      <div style={styles.checkCircle}>✓</div>
      <h2 style={styles.niceWork}>Nice work!</h2>
      <p style={styles.completionSub}>
        You've mastered all {cardCount} flashcards
      </p>
      <button style={styles.quizButton} onClick={onContinueToQuiz}>
        Continue to Quiz
      </button>
    </div>
  )
}

function LessonScreen({ topicId, onBack, onNavigate, onFlashcardsComplete, initialCompleted = false }) {
  const allCards = TOPICS[topicId].levels.level1.flashcards
  const topicTitle = TOPICS[topicId].title

  const [queue, setQueue] = useState([...allCards])
  const [gotItCount, setGotItCount] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [completed, setCompleted] = useState(initialCompleted)

  const currentCard = queue[0]

  const advance = (wasFlipped, fn) => {
    setIsFlipped(false)
    if (wasFlipped) {
      setTimeout(fn, 220)
    } else {
      fn()
    }
  }

  const handleGotIt = () => {
    const wasFlipped = isFlipped
    advance(wasFlipped, () => {
      const newQueue = queue.slice(1)
      setGotItCount(c => c + 1)
      if (newQueue.length === 0) {
        onFlashcardsComplete?.()
        setCompleted(true)
      } else {
        setQueue(newQueue)
      }
    })
  }

  const handleStillLearning = () => {
    const wasFlipped = isFlipped
    advance(wasFlipped, () => {
      setQueue(q => {
        const [first, ...rest] = q
        return [...rest, first]
      })
    })
  }

  return (
    <div style={styles.screen}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>←</button>
        <div style={styles.headerMid}>
          <span style={styles.headerTitle}>{topicTitle} · Level 1</span>
          <ProgressPips total={allCards.length} completedCount={gotItCount} />
        </div>
        <div style={{ width: '40px', flexShrink: 0 }} />
      </div>

      {completed ? (
        <CompletionScreen
          cardCount={allCards.length}
          onContinueToQuiz={() => onNavigate('quiz')}
        />
      ) : (
        <div style={styles.body}>
          <p style={styles.cardCountLabel}>
            {gotItCount} of {allCards.length} learned
          </p>

          <FlipCard
            card={currentCard}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped(f => !f)}
          />

          <div style={styles.buttonRow}>
            <button style={styles.stillLearningBtn} onClick={handleStillLearning}>
              Still learning
            </button>
            <button style={styles.gotItBtn} onClick={handleGotIt}>
              Got it ✓
            </button>
          </div>
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
    width: '44px',
    height: '44px',
    flexShrink: 0,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '1.1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
    gap: '4px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  pip: {
    width: '18px',
    height: '5px',
    borderRadius: '3px',
    transition: 'background 0.3s',
  },

  /* Body */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '1.5rem 1.25rem',
    gap: '1.25rem',
    overflowY: 'auto',
    minHeight: 0,
  },
  cardCountLabel: {
    textAlign: 'center',
    fontSize: '0.75rem',
    color: '#9ca3af',
    margin: 0,
    letterSpacing: '0.03em',
  },

  /* Flip card */
  perspective: {
    perspective: '1200px',
    height: '260px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  cardInner: {
    position: 'relative',
    width: '100%',
    height: '100%',
    transformStyle: 'preserve-3d',
    WebkitTransformStyle: 'preserve-3d',
    transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  cardFace: {
    position: 'absolute',
    inset: 0,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1.75rem',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  cardFaceBack: {
    transform: 'rotateY(180deg)',
    background: '#EFF6FF',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingTop: '1.5rem',
    overflowY: 'auto',
  },
  tapHint: {
    margin: '0 0 1rem',
    fontSize: '0.7rem',
    color: '#9ca3af',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  tapHintBottom: {
    margin: '1.25rem 0 0',
    fontSize: '1rem',
    color: '#d1d5db',
  },
  term: {
    margin: 0,
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#1A3C5E',
    textAlign: 'center',
    lineHeight: 1.2,
  },
  termLabel: {
    margin: '0 0 0.625rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#185FA5',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  definition: {
    margin: 0,
    fontSize: '0.975rem',
    color: '#374151',
    lineHeight: 1.65,
  },

  /* Buttons */
  buttonRow: {
    display: 'flex',
    gap: '0.75rem',
  },
  stillLearningBtn: {
    flex: 1,
    padding: '0.875rem',
    background: '#ffffff',
    border: '1.5px solid #e5e7eb',
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer',
  },
  gotItBtn: {
    flex: 1,
    padding: '0.875rem',
    background: '#185FA5',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#ffffff',
    cursor: 'pointer',
  },

  /* Completion */
  completionWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1.5rem',
    gap: '0.625rem',
  },
  checkCircle: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background: '#185FA5',
    color: '#ffffff',
    fontSize: '2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '0.5rem',
  },
  niceWork: {
    margin: 0,
    fontSize: '1.75rem',
    fontWeight: '700',
    color: '#1A3C5E',
  },
  completionSub: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#6b7280',
    textAlign: 'center',
  },
  quizButton: {
    marginTop: '1.25rem',
    padding: '0.875rem 2.5rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default LessonScreen

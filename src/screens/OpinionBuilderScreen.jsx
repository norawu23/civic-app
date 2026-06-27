import { useState } from 'react'
import { TOPICS } from '../data/topics.js'

const TOTAL_STEPS = 8
// 0: Cold Take | 1-4: Context Cards | 5: Flip Card | 6: Evolved Take | 7: Completion

// ─── Progress bar ──────────────────────────────────────────────────────────────

function StepProgress({ step }) {
  return (
    <div style={styles.progressWrap}>
      <div style={styles.pipsRow}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          let bg
          if (i < step) bg = '#ffffff'
          else if (i === step) bg = 'rgba(255,255,255,0.55)'
          else bg = 'rgba(255,255,255,0.18)'
          return <div key={i} style={{ ...styles.pip, background: bg }} />
        })}
      </div>
      <span style={styles.stepCounter}>Step {step + 1} of {TOTAL_STEPS}</span>
    </div>
  )
}

// ─── Step 1: Cold Take ─────────────────────────────────────────────────────────

function ColdTakeStep({ ob, onSelect }) {
  return (
    <div style={styles.stepWrap}>
      <p style={styles.eyebrow}>Your cold take</p>
      <div style={styles.questionCard}>
        <p style={styles.question}>{ob.question}</p>
      </div>
      <p style={styles.nudge}>What's your gut reaction?</p>
      <div style={styles.coldBtnRow}>
        <button
          style={{ ...styles.coldBtn, ...styles.coldBtnYes }}
          onClick={() => onSelect('yes')}
        >
          <span style={styles.coldBtnEmoji}>👍</span>
          <span style={styles.coldBtnLabel}>Yes</span>
        </button>
        <button
          style={{ ...styles.coldBtn, ...styles.coldBtnNo }}
          onClick={() => onSelect('no')}
        >
          <span style={styles.coldBtnEmoji}>👎</span>
          <span style={styles.coldBtnLabel}>No</span>
        </button>
      </div>
    </div>
  )
}

// ─── Steps 2-5: Context Cards ──────────────────────────────────────────────────

const RESPONSES = [
  { label: 'This changes my thinking', icon: '🔄' },
  { label: 'This does not change my thinking', icon: '→' },
  { label: "It's complicated", icon: '🤔' },
]

function ContextCardStep({ ob, cardIndex, onSelect }) {
  const card = ob.contextCards[cardIndex]
  return (
    <div style={styles.stepWrap}>
      <p style={styles.eyebrow}>
        Context · {cardIndex + 1} of {ob.contextCards.length}
      </p>
      <div style={styles.contextCard}>
        <p style={styles.contextTitle}>{card.title}</p>
        <p style={styles.contextContent}>{card.content}</p>
      </div>
      <p style={styles.nudge}>How does this land for you?</p>
      <div style={styles.responseBtns}>
        {RESPONSES.map(({ label, icon }) => (
          <button key={label} style={styles.responseBtn} onClick={onSelect}>
            <span style={styles.responseBtnIcon}>{icon}</span>
            <span style={styles.responseBtnLabel}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Step 6: Flip Card ─────────────────────────────────────────────────────────

function FlipCardStep({ ob, coldTake, onContinue }) {
  return (
    <div style={styles.stepWrap}>
      <p style={styles.eyebrow}>A perspective to consider</p>
      <div style={styles.flipCard}>
        <p style={styles.flipCardTag}>
          You started with &ldquo;{coldTake === 'yes' ? 'Yes' : 'No'}&rdquo;
        </p>
        <p style={styles.flipCardText}>{ob.flipCards[coldTake]}</p>
      </div>
      <button style={styles.consideredBtn} onClick={onContinue}>
        I have considered this
      </button>
    </div>
  )
}

// ─── Step 7: Evolved Take ──────────────────────────────────────────────────────

function EvolvedTakeStep({ ob, selected, onSelect, bonusText, onBonusChange, onComplete }) {
  const canComplete = selected !== null || bonusText.length >= 50
  const charsLeft = Math.max(0, 50 - bonusText.length)
  const bonusQualifies = bonusText.length >= 50

  return (
    <div style={styles.stepWrap}>
      <p style={styles.eyebrow}>Your evolved take</p>
      <p style={styles.nudge}>How has your thinking evolved? Select an option or write your own.</p>

      <div style={styles.evolvedList}>
        {ob.evolvedTake.standardOptions.map((opt, idx) => (
          <button
            key={idx}
            style={{
              ...styles.evolvedOption,
              ...(selected === idx ? styles.evolvedOptionSelected : {}),
            }}
            onClick={() => onSelect(selected === idx ? null : idx)}
          >
            <span
              style={{
                ...styles.optionDot,
                ...(selected === idx ? styles.optionDotSelected : {}),
              }}
            />
            <span style={styles.optionText}>{opt}</span>
          </button>
        ))}
      </div>

      <div style={styles.bonusBox}>
        <div style={styles.bonusHeaderRow}>
          <p style={styles.bonusLabel}>Write your own for bonus XP</p>
          <span style={styles.xpPill}>+200 XP</span>
        </div>
        <p style={styles.bonusPrompt}>{ob.evolvedTake.bonusPrompt}</p>
        <textarea
          style={styles.textarea}
          value={bonusText}
          onChange={e => onBonusChange(e.target.value)}
          placeholder="Write your evolved take here..."
          rows={5}
        />
        <p
          style={{
            ...styles.charCount,
            color: bonusQualifies ? '#16a34a' : '#9ca3af',
          }}
        >
          {bonusText.length} characters
          {bonusText.length > 0 && !bonusQualifies && ` — ${charsLeft} more to unlock bonus XP`}
          {bonusQualifies && ' — bonus XP unlocked ✓'}
        </p>
      </div>

      <button
        style={{
          ...styles.completeBtn,
          ...(!canComplete ? styles.completeBtnDisabled : {}),
        }}
        disabled={!canComplete}
        onClick={onComplete}
      >
        Complete
      </button>
    </div>
  )
}

// ─── Step 8: Completion ────────────────────────────────────────────────────────

function CompletionStep({ ob, coldTake, selected, bonusText, xpEarned, onBack }) {
  const evolvedText =
    bonusText.length >= 50
      ? bonusText.slice(0, 220) + (bonusText.length > 220 ? '…' : '')
      : ob.evolvedTake.standardOptions[selected]

  return (
    <div style={styles.completionWrap}>
      <div style={styles.xpCircle}>
        <span style={styles.xpPlus}>+{xpEarned}</span>
        <span style={styles.xpLabel}>XP</span>
      </div>

      <h2 style={styles.congrats}>Opinion built!</h2>
      <p style={styles.congratsSub}>
        {xpEarned === 200
          ? 'Bonus XP earned for your original response.'
          : 'Complete more opinion builders to earn bonus XP.'}
      </p>

      <div style={styles.summaryCard}>
        <p style={styles.summaryHeading}>How your thinking evolved</p>

        <div style={styles.summaryRow}>
          <span style={styles.summaryRowLabel}>Cold take</span>
          <span
            style={{
              ...styles.coldTakePill,
              background: coldTake === 'yes' ? '#f0fdf4' : '#fef2f2',
              color: coldTake === 'yes' ? '#16a34a' : '#dc2626',
              border: `1px solid ${coldTake === 'yes' ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {coldTake === 'yes' ? '👍 Yes' : '👎 No'}
          </span>
        </div>

        <div style={styles.summaryDivider}>↓ evolved ↓</div>

        <div style={styles.summaryRow}>
          <span style={styles.summaryRowLabel}>Evolved take</span>
        </div>
        <p style={styles.summaryEvolvedText}>{evolvedText}</p>
      </div>

      <button style={styles.homeBtn} onClick={onBack}>
        Back to home
      </button>
    </div>
  )
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

function OpinionBuilderScreen({ topicId, obIndex = 0, onComplete, onOpinionComplete }) {
  const ob = TOPICS[topicId].opinionBuilders[obIndex]
  const topicTitle = TOPICS[topicId].title

  const [step, setStep] = useState(0)
  const [coldTake, setColdTake] = useState(null)
  const [selected, setSelected] = useState(null)
  const [bonusText, setBonusText] = useState('')
  const [xpEarned, setXpEarned] = useState(0)

  const next = () => setStep(s => s + 1)

  const handleColdTake = (choice) => {
    setColdTake(choice)
    next()
  }

  const handleComplete = () => {
    const xp = bonusText.length >= 50 ? 200 : 100
    const evolvedText = bonusText.length >= 50
      ? bonusText
      : (selected !== null ? ob.evolvedTake.standardOptions[selected] : '')
    setXpEarned(xp)
    onOpinionComplete?.(coldTake, xp, evolvedText)
    next()
  }

  const renderStep = () => {
    if (step === 0) {
      return <ColdTakeStep ob={ob} onSelect={handleColdTake} />
    }
    if (step >= 1 && step <= 4) {
      return <ContextCardStep ob={ob} cardIndex={step - 1} onSelect={next} />
    }
    if (step === 5) {
      return <FlipCardStep ob={ob} coldTake={coldTake} onContinue={next} />
    }
    if (step === 6) {
      return (
        <EvolvedTakeStep
          ob={ob}
          selected={selected}
          onSelect={setSelected}
          bonusText={bonusText}
          onBonusChange={setBonusText}
          onComplete={handleComplete}
        />
      )
    }
    if (step === 7) {
      return (
        <CompletionStep
          ob={ob}
          coldTake={coldTake}
          selected={selected}
          bonusText={bonusText}
          xpEarned={xpEarned}
          onBack={onComplete}
        />
      )
    }
  }

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <p style={styles.headerEyebrow}>What Do You Think?</p>
        <p style={styles.headerTitle}>{topicTitle} · Opinion Builder {obIndex + 1}</p>
        <StepProgress step={step} />
      </div>

      <div style={styles.body}>
        {renderStep()}
      </div>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
    background: 'var(--color-bg)',
    fontFamily: 'sans-serif',
  },

  /* Header */
  header: {
    background: 'var(--color-navy)',
    padding: '1.25rem 1.5rem 1rem',
    flexShrink: 0,
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
    margin: '0 0 1rem',
    fontSize: '1rem',
    fontWeight: '700',
    color: '#ffffff',
  },

  /* Progress */
  progressWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  pipsRow: {
    display: 'flex',
    gap: '5px',
    flex: 1,
  },
  pip: {
    flex: 1,
    height: '5px',
    borderRadius: '3px',
    transition: 'background 0.3s',
  },
  stepCounter: {
    flexShrink: 0,
    fontSize: '0.7rem',
    color: 'rgba(255,255,255,0.6)',
    whiteSpace: 'nowrap',
  },

  /* Body */
  body: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },

  /* Shared step layout */
  stepWrap: {
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  eyebrow: {
    margin: 0,
    fontSize: '0.68rem',
    fontWeight: '700',
    color: 'var(--color-blue)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  nudge: {
    margin: 0,
    fontSize: '0.875rem',
    color: 'var(--color-text-secondary)',
  },

  /* Cold Take */
  questionCard: {
    background: 'var(--color-card)',
    border: '1px solid #e9ecef',
    borderRadius: '16px',
    padding: '1.375rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  question: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '600',
    color: 'var(--color-text)',
    lineHeight: 1.55,
  },
  coldBtnRow: {
    display: 'flex',
    gap: '0.875rem',
  },
  coldBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '1rem 0.5rem',
    minHeight: '80px',
    border: '2px solid transparent',
    borderRadius: '16px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '700',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  coldBtnYes: {
    background: 'rgba(76,175,80,0.1)',
    border: '2px solid var(--color-green)',
    color: '#2e7d32',
  },
  coldBtnNo: {
    background: 'rgba(255,107,107,0.1)',
    border: '2px solid var(--color-coral)',
    color: '#c62828',
  },
  coldBtnEmoji: {
    fontSize: '2rem',
    lineHeight: 1,
  },
  coldBtnLabel: {
    fontSize: '1rem',
    fontWeight: '700',
  },

  /* Context Card */
  contextCard: {
    background: 'var(--color-card)',
    border: '1px solid #e9ecef',
    borderRadius: '16px',
    padding: '1.375rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  contextTitle: {
    margin: '0 0 0.75rem',
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
  },
  contextContent: {
    margin: 0,
    fontSize: '0.925rem',
    color: '#374151',
    lineHeight: 1.7,
  },
  responseBtns: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  responseBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem 1.125rem',
    background: 'var(--color-card)',
    border: '1.5px solid #e9ecef',
    borderRadius: '16px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  responseBtnIcon: {
    fontSize: '1rem',
    flexShrink: 0,
    width: '20px',
    textAlign: 'center',
  },
  responseBtnLabel: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
  },

  /* Flip Card */
  flipCard: {
    background: '#EFF6FF',
    border: '1.5px solid #bfdbfe',
    borderRadius: '16px',
    padding: '1.375rem',
  },
  flipCardTag: {
    margin: '0 0 0.75rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    color: 'var(--color-blue)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  flipCardText: {
    margin: 0,
    fontSize: '0.925rem',
    color: '#1e3a5f',
    lineHeight: 1.75,
  },
  consideredBtn: {
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

  /* Evolved Take */
  evolvedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  evolvedOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '1rem 1.125rem',
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
  evolvedOptionSelected: {
    background: '#EFF6FF',
    border: '1.5px solid var(--color-blue)',
    boxShadow: 'none',
  },
  optionDot: {
    flexShrink: 0,
    marginTop: '3px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '2px solid #d1d5db',
    background: 'transparent',
  },
  optionDotSelected: {
    border: '2px solid var(--color-blue)',
    background: 'var(--color-blue)',
    boxShadow: 'inset 0 0 0 3px #EFF6FF',
  },
  optionText: {
    fontSize: '0.875rem',
    color: 'var(--color-text)',
    lineHeight: 1.5,
  },

  /* Bonus section */
  bonusBox: {
    background: '#fffbeb',
    border: '1.5px solid #fde68a',
    borderRadius: '16px',
    padding: '1.125rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  bonusHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bonusLabel: {
    margin: 0,
    fontSize: '0.85rem',
    fontWeight: '700',
    color: '#92400e',
  },
  xpPill: {
    background: 'var(--color-gold)',
    color: '#ffffff',
    fontSize: '0.7rem',
    fontWeight: '700',
    padding: '0.2rem 0.5rem',
    borderRadius: '20px',
    letterSpacing: '0.03em',
  },
  bonusPrompt: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#78350f',
    lineHeight: 1.6,
  },
  textarea: {
    width: '100%',
    padding: '0.875rem',
    border: '1.5px solid #fde68a',
    borderRadius: '12px',
    fontSize: '0.875rem',
    color: 'var(--color-text)',
    lineHeight: 1.6,
    resize: 'vertical',
    fontFamily: 'sans-serif',
    background: '#ffffff',
    boxSizing: 'border-box',
    outline: 'none',
  },
  charCount: {
    margin: 0,
    fontSize: '0.72rem',
    transition: 'color 0.2s',
  },

  /* Complete button */
  completeBtn: {
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
  completeBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },

  /* Completion */
  completionWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2.5rem 1.5rem 2rem',
    gap: '0.75rem',
  },
  xpCircle: {
    width: '92px',
    height: '92px',
    borderRadius: '50%',
    background: 'var(--color-gold)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '0.625rem',
  },
  xpPlus: {
    fontSize: '1.5rem',
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 1,
  },
  xpLabel: {
    fontSize: '0.75rem',
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: '0.05em',
  },
  congrats: {
    margin: 0,
    fontSize: '1.6rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
  },
  congratsSub: {
    margin: '0 0 0.75rem',
    fontSize: '0.875rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
  },
  summaryCard: {
    width: '100%',
    background: 'var(--color-card)',
    border: '1px solid #e9ecef',
    borderRadius: '16px',
    padding: '1.25rem',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  summaryHeading: {
    margin: 0,
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  },
  summaryRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryRowLabel: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
  },
  coldTakePill: {
    fontSize: '0.8rem',
    fontWeight: '700',
    padding: '0.25rem 0.625rem',
    borderRadius: '20px',
  },
  summaryDivider: {
    fontSize: '0.72rem',
    color: '#9ca3af',
    textAlign: 'center',
    letterSpacing: '0.05em',
  },
  summaryEvolvedText: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#374151',
    lineHeight: 1.65,
  },
  homeBtn: {
    marginTop: '0.5rem',
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
}

export default OpinionBuilderScreen

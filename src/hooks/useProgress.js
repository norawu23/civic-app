import { useState, useCallback } from 'react'

const STORAGE_KEY = 'civic_progress'

// ─── Static config ──────────────────────────────────────────────────────────

// How many levels each topic has (drives unlock-next-level logic)
const TOPIC_LEVEL_COUNTS = {
  immigration: 3,
  taxes: 3,
  gerrymandering: 3,
  gunRights: 3,
  climateChange: 3,
}

// Order in which topics unlock when the previous topic's final level is done
const TOPIC_UNLOCK_ORDER = ['immigration', 'taxes', 'gerrymandering', 'gunRights', 'climateChange']

// XP awarded for each action
const XP = {
  flashcards: 50,
  quiz: 50,
  quizPerfectBonus: 25,
}

// ─── Default state for brand-new users ──────────────────────────────────────

const DEFAULT_STATE = {
  user: {
    totalXP: 0,
    streak: 1,
    lastLoginDate: null,
  },
  topics: {
    immigration: {
      unlocked: true,
      currentLevel: 1,
      levels: {
        '1': { flashcardsComplete: false, quizComplete: false, quizScore: null },
      },
    },
    taxes: {
      unlocked: false,
      currentLevel: null,
      levels: {},
    },
    gerrymandering: {
      unlocked: false,
      currentLevel: null,
      levels: {},
    },
    gunRights: {
      unlocked: false,
      currentLevel: null,
      levels: {},
    },
    climateChange: {
      unlocked: false,
      currentLevel: null,
      levels: {},
    },
  },
  opinionBuilders: {
    'imm-ob-01': { completed: false },
    'imm-ob-02': { completed: false },
    'tax-ob-01': { completed: false },
    'tax-ob-02': { completed: false },
    'ger-ob-01': { completed: false },
    'ger-ob-02': { completed: false },
    'gun-ob-01': { completed: false },
    'gun-ob-02': { completed: false },
    'cli-ob-01': { completed: false },
    'cli-ob-02': { completed: false },
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function localDateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable — silently continue
  }
}

function applyStreakCheck(state) {
  const today = localDateStr(0)
  const yesterday = localDateStr(-1)
  const { lastLoginDate, streak } = state.user

  if (lastLoginDate === today) return state // already checked in today

  const newStreak = lastLoginDate === yesterday ? streak + 1 : 1

  return {
    ...state,
    user: { ...state.user, streak: newStreak, lastLoginDate: today },
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProgress() {
  const [progress, setProgress] = useState(() => {
    const stored = loadFromStorage()
    const base = stored ?? DEFAULT_STATE
    const checked = applyStreakCheck(base)
    // Persist right away if streak changed (or on first ever load)
    if (!stored || checked !== base) saveToStorage(checked)
    return checked
  })

  // Atomic update: apply an updater fn, save, and return new state
  const update = useCallback((updater) => {
    setProgress(prev => {
      const next = updater(prev)
      if (next !== prev) saveToStorage(next)
      return next
    })
  }, [])

  // ── completeFlashcards ─────────────────────────────────────────────────────
  // Idempotent. Awards 50 XP the first time.
  const completeFlashcards = useCallback((topicId, level) => {
    console.log('[CIVIC] completeFlashcards called', { topicId, level })
    update(prev => {
      const levelKey = String(level)
      const topicData = prev.topics[topicId]
      if (!topicData) {
        console.warn('[CIVIC] completeFlashcards: topic not found', topicId)
        return prev
      }

      const levelData = topicData.levels[levelKey] || {}
      if (levelData.flashcardsComplete) {
        console.log('[CIVIC] completeFlashcards: already done, skipping')
        return prev
      }

      console.log('[CIVIC] completeFlashcards: marking done, +50 XP')
      return {
        ...prev,
        user: { ...prev.user, totalXP: prev.user.totalXP + XP.flashcards },
        topics: {
          ...prev.topics,
          [topicId]: {
            ...topicData,
            levels: {
              ...topicData.levels,
              [levelKey]: { ...levelData, flashcardsComplete: true },
            },
          },
        },
      }
    })
  }, [update])

  // ── completeQuiz ───────────────────────────────────────────────────────────
  // Idempotent. Awards 50 XP (+25 bonus for perfect score).
  // Advances currentLevel and unlocks the next level or the next topic.
  const completeQuiz = useCallback((topicId, level, score, total) => {
    console.log('[CIVIC] completeQuiz called', { topicId, level, score, total })
    update(prev => {
      const levelKey = String(level)
      const topicData = prev.topics[topicId]
      if (!topicData) {
        console.warn('[CIVIC] completeQuiz: topic not found', topicId)
        return prev
      }

      const levelData = topicData.levels[levelKey] || {}
      if (levelData.quizComplete) {
        console.log('[CIVIC] completeQuiz: already done, skipping')
        return prev
      }

      const isPerfect = score === total
      const xpGained = XP.quiz + (isPerfect ? XP.quizPerfectBonus : 0)

      const levelCount = TOPIC_LEVEL_COUNTS[topicId] ?? 1
      const hasNextLevel = level < levelCount
      const nextLevelKey = String(level + 1)

      const topicIdx = TOPIC_UNLOCK_ORDER.indexOf(topicId)
      const nextTopicId = !hasNextLevel ? TOPIC_UNLOCK_ORDER[topicIdx + 1] : null

      // Update the current topic
      const updatedTopicLevels = {
        ...topicData.levels,
        [levelKey]: { ...levelData, quizComplete: true, quizScore: score },
      }
      if (hasNextLevel) {
        updatedTopicLevels[nextLevelKey] = {
          flashcardsComplete: false,
          quizComplete: false,
          quizScore: null,
        }
      }

      const updatedTopics = {
        ...prev.topics,
        [topicId]: {
          ...topicData,
          currentLevel: hasNextLevel ? level + 1 : level,
          levels: updatedTopicLevels,
        },
      }

      // Unlock the next topic if this was the final level
      if (nextTopicId && updatedTopics[nextTopicId] && !updatedTopics[nextTopicId].unlocked) {
        updatedTopics[nextTopicId] = {
          ...updatedTopics[nextTopicId],
          unlocked: true,
          currentLevel: 1,
          levels: {
            '1': { flashcardsComplete: false, quizComplete: false, quizScore: null },
          },
        }
      }

      console.log('[CIVIC] completeQuiz: marking done', { xpGained, hasNextLevel, nextTopicId })
      return {
        ...prev,
        user: { ...prev.user, totalXP: prev.user.totalXP + xpGained },
        topics: updatedTopics,
      }
    })
  }, [update])

  // ── completeOpinionBuilder ─────────────────────────────────────────────────
  // Idempotent. Awards the provided XP (100 standard / 200 bonus) once.
  const completeOpinionBuilder = useCallback((obId, coldTake, xp) => {
    console.log('[CIVIC] completeOpinionBuilder called', { obId, coldTake, xp })
    update(prev => {
      if (prev.opinionBuilders[obId]?.completed) {
        console.log('[CIVIC] completeOpinionBuilder: already done, skipping')
        return prev
      }

      console.log('[CIVIC] completeOpinionBuilder: marking done', { obId, xp })
      return {
        ...prev,
        user: { ...prev.user, totalXP: prev.user.totalXP + xp },
        opinionBuilders: {
          ...prev.opinionBuilders,
          [obId]: { completed: true, coldTake, xpEarned: xp },
        },
      }
    })
  }, [update])

  return { progress, completeFlashcards, completeQuiz, completeOpinionBuilder }
}

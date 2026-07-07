import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { TOPIC_UNLOCK_ORDER } from '../data/registry.js'

const STORAGE_KEY = 'civic_progress'

// ─── Static config ──────────────────────────────────────────────────────────

const TOPIC_LEVEL_COUNTS = {
  immigration: 3,
  taxes: 3,
  gerrymandering: 3,
  gunRights: 3,
  climateChange: 3,
}

// TOPIC_UNLOCK_ORDER now lives in src/data/registry.js (H1, D-005 §3) —
// single source, also consumed by scripts/content/seed.mjs for
// topics_catalog.position and (later) by C2 for DEFAULT_PROGRESS generation.

const XP = {
  flashcards: 50,
  quiz: 50,
  quizPerfectBonus: 25,
}

// ─── Default state (exported so useAuth can seed Supabase on signup) ─────────

export const DEFAULT_PROGRESS = {
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
    taxes:         { unlocked: false, currentLevel: null, levels: {} },
    gerrymandering: { unlocked: false, currentLevel: null, levels: {} },
    gunRights:     { unlocked: false, currentLevel: null, levels: {} },
    climateChange:  { unlocked: false, currentLevel: null, levels: {} },
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

  if (lastLoginDate === today) return state

  const newStreak = lastLoginDate === yesterday ? streak + 1 : 1
  return {
    ...state,
    user: { ...state.user, streak: newStreak, lastLoginDate: today },
  }
}

async function saveToSupabase(userId, progressData) {
  const { error } = await supabase
    .from('progress')
    .upsert(
      { user_id: userId, progress_data: progressData, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (error) {
    console.warn('[CIVIC] Supabase save failed, falling back to localStorage', error)
    saveToStorage(progressData)
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

// user: the Supabase auth user object (or null when logged out)
export function useProgress(user) {
  const [progress, setProgress] = useState(() => {
    const stored = loadFromStorage()
    const base = stored ?? DEFAULT_PROGRESS
    const checked = applyStreakCheck(base)
    if (!stored || checked !== base) saveToStorage(checked)
    return checked
  })

  // Keep a ref so the update callback always has the current user without
  // needing to be recreated every time user changes.
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])

  // Load from Supabase on login, reset to localStorage on logout.
  useEffect(() => {
    if (!user) {
      const stored = loadFromStorage()
      const base = stored ?? DEFAULT_PROGRESS
      setProgress(applyStreakCheck(base))
      return
    }

    supabase
      .from('progress')
      .select('progress_data')
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data?.progress_data) return
        const checked = applyStreakCheck(data.progress_data)
        setProgress(checked)
        if (checked !== data.progress_data) {
          saveToSupabase(user.id, checked)
        }
      })
  }, [user?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Atomic update: apply updater, persist, return new state.
  const update = useCallback((updater) => {
    setProgress(prev => {
      const next = updater(prev)
      if (next === prev) return prev
      if (userRef.current) {
        saveToSupabase(userRef.current.id, next)
      } else {
        saveToStorage(next)
      }
      return next
    })
  }, [])

  // ── completeFlashcards ─────────────────────────────────────────────────────

  const completeFlashcards = useCallback((topicId, level) => {
    update(prev => {
      const levelKey = String(level)
      const topicData = prev.topics[topicId]
      if (!topicData) return prev

      const levelData = topicData.levels[levelKey] || {}
      if (levelData.flashcardsComplete) return prev

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

  const completeQuiz = useCallback((topicId, level, score, total) => {
    update(prev => {
      const levelKey = String(level)
      const topicData = prev.topics[topicId]
      if (!topicData) return prev

      const levelData = topicData.levels[levelKey] || {}
      if (levelData.quizComplete) return prev

      const isPerfect = score === total
      const xpGained = XP.quiz + (isPerfect ? XP.quizPerfectBonus : 0)

      const levelCount = TOPIC_LEVEL_COUNTS[topicId] ?? 1
      const hasNextLevel = level < levelCount
      const nextLevelKey = String(level + 1)

      const topicIdx = TOPIC_UNLOCK_ORDER.indexOf(topicId)
      const nextTopicId = !hasNextLevel ? TOPIC_UNLOCK_ORDER[topicIdx + 1] : null

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

      return {
        ...prev,
        user: { ...prev.user, totalXP: prev.user.totalXP + xpGained },
        topics: updatedTopics,
      }
    })
  }, [update])

  // ── completeOpinionBuilder ─────────────────────────────────────────────────
  // evolvedTake: the text the user selected or wrote in the evolved take step

  const completeOpinionBuilder = useCallback((obId, coldTake, xp, evolvedTake = '') => {
    update(prev => {
      if (prev.opinionBuilders[obId]?.completed) return prev

      return {
        ...prev,
        user: { ...prev.user, totalXP: prev.user.totalXP + xp },
        opinionBuilders: {
          ...prev.opinionBuilders,
          [obId]: { completed: true, coldTake, xpEarned: xp, evolvedTake },
        },
      }
    })
  }, [update])

  return { progress, completeFlashcards, completeQuiz, completeOpinionBuilder }
}

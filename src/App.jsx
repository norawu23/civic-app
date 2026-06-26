import { useState } from 'react'
import { useProgress } from './hooks/useProgress'
import { TOPICS } from './data/topics.js'
import HomeScreen from './screens/HomeScreen'
import LearnScreen from './screens/LearnScreen'
import OpinionBuilderScreen from './screens/OpinionBuilderScreen'
import OpinionHubScreen from './screens/OpinionHubScreen'
import ProfileScreen from './screens/ProfileScreen'
import LessonScreen from './screens/LessonScreen'
import QuizScreen from './screens/QuizScreen'
import Level2Screen from './screens/Level2Screen'
import Level3Screen from './screens/Level3Screen'

function LockedOpinionScreen({ topicTitle, flashcardsDone, quizDone, onNavigate }) {
  return (
    <div style={lockedStyles.screen}>
      <div style={lockedStyles.header}>
        <p style={lockedStyles.headerEyebrow}>What Do You Think?</p>
        <p style={lockedStyles.headerTitle}>Opinion Builder</p>
      </div>

      <div style={lockedStyles.body}>
        <div style={lockedStyles.lockCircle}>🔒</div>
        <h2 style={lockedStyles.heading}>Finish Level 1 first</h2>
        <p style={lockedStyles.sub}>
          Complete the {topicTitle} flashcards and quiz to unlock the Opinion Builder.
        </p>

        <div style={lockedStyles.checklist}>
          <div style={lockedStyles.checkRow}>
            <span style={{ ...lockedStyles.checkIcon, color: flashcardsDone ? '#16a34a' : '#9ca3af' }}>
              {flashcardsDone ? '✓' : '○'}
            </span>
            <span style={{ ...lockedStyles.checkLabel, color: flashcardsDone ? '#111827' : '#6b7280' }}>
              {topicTitle} flashcards
            </span>
          </div>
          <div style={lockedStyles.checkRow}>
            <span style={{ ...lockedStyles.checkIcon, color: quizDone ? '#16a34a' : '#9ca3af' }}>
              {quizDone ? '✓' : '○'}
            </span>
            <span style={{ ...lockedStyles.checkLabel, color: quizDone ? '#111827' : '#6b7280' }}>
              {topicTitle} Level 1 Quiz
            </span>
          </div>
        </div>

        <button style={lockedStyles.btn} onClick={() => onNavigate('lesson')}>
          {flashcardsDone ? 'Go to quiz →' : 'Start lesson →'}
        </button>
      </div>
    </div>
  )
}

const lockedStyles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#f5f7fa',
    fontFamily: 'sans-serif',
  },
  header: {
    background: '#1A3C5E',
    padding: '1.25rem 1.25rem 1rem',
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
    margin: 0,
    fontSize: '1rem',
    fontWeight: '700',
    color: '#ffffff',
  },
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2.5rem 1.5rem',
    gap: '0.75rem',
  },
  lockCircle: {
    fontSize: '3rem',
    lineHeight: 1,
    marginBottom: '0.5rem',
  },
  heading: {
    margin: 0,
    fontSize: '1.4rem',
    fontWeight: '700',
    color: '#1A3C5E',
  },
  sub: {
    margin: '0 0 0.5rem',
    fontSize: '0.9rem',
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 1.55,
    maxWidth: '280px',
  },
  checklist: {
    width: '100%',
    maxWidth: '280px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    marginBottom: '0.5rem',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  checkIcon: {
    fontSize: '1rem',
    fontWeight: '700',
    width: '20px',
    textAlign: 'center',
    flexShrink: 0,
  },
  checkLabel: {
    fontSize: '0.875rem',
    fontWeight: '500',
  },
  btn: {
    marginTop: '0.25rem',
    padding: '0.875rem 2rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'learn', label: 'Learn' },
  { id: 'opinion', label: 'Opinion' },
  { id: 'profile', label: 'Profile' },
]

function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [currentScreen, setCurrentScreen] = useState(null) // null | 'lesson' | 'quiz' | 'level2' | 'ob2' | 'level3'
  const [activeTopic, setActiveTopic] = useState('immigration')

  const { progress, completeFlashcards, completeQuiz, completeOpinionBuilder } = useProgress()

  // Derive topic-specific values from the active topic
  const topicStaticData = TOPICS[activeTopic]
  const topicTitle = topicStaticData?.title ?? activeTopic
  const ob1Id = topicStaticData?.opinionBuilders?.[0]?.id
  const ob2Id = topicStaticData?.opinionBuilders?.[1]?.id

  const topicProgress = progress.topics[activeTopic] ?? {}
  const l1Progress = topicProgress.levels?.['1'] ?? {}
  const flashcardsDone = l1Progress.flashcardsComplete ?? false
  const quizDone = l1Progress.quizComplete ?? false
  const ob1Done = ob1Id ? (progress.opinionBuilders?.[ob1Id]?.completed ?? false) : false

  // Navigate to the right screen based on where the user is in the chosen topic's curriculum
  const handleTopicSelect = (topicId) => {
    const topicData = progress.topics[topicId]
    if (!topicData?.unlocked) return

    const staticData = TOPICS[topicId]
    const topicOb1Id = staticData?.opinionBuilders?.[0]?.id
    const tl1 = topicData.levels?.['1'] ?? {}
    const tl3 = topicData.levels?.['3'] ?? {}
    const topicOb1Done = topicOb1Id
      ? (progress.opinionBuilders?.[topicOb1Id]?.completed ?? false)
      : false

    setActiveTopic(topicId)

    if (tl3.quizComplete) return  // all done — stay on Home
    if (topicOb1Done) { setCurrentScreen('level3'); return }
    if (tl1.quizComplete) { setCurrentScreen(null); setActiveTab('opinion'); return }
    if (tl1.flashcardsComplete) { setCurrentScreen('quiz'); return }
    setCurrentScreen('lesson')
  }

  if (currentScreen === 'lesson') {
    return (
      <div style={styles.app}>
        <LessonScreen
          topicId={activeTopic}
          initialCompleted={flashcardsDone}
          onFlashcardsComplete={() => completeFlashcards(activeTopic, 1)}
          onBack={() => setCurrentScreen(null)}
          onNavigate={setCurrentScreen}
        />
      </div>
    )
  }

  if (currentScreen === 'quiz') {
    return (
      <div style={styles.app}>
        <QuizScreen
          topicId={activeTopic}
          onQuizComplete={(score, total) => completeQuiz(activeTopic, 1, score, total)}
          onBack={() => setCurrentScreen('lesson')}
          onHome={() => setCurrentScreen('level2')}
        />
      </div>
    )
  }

  if (currentScreen === 'level2') {
    return (
      <div style={styles.app}>
        <Level2Screen
          topicId={activeTopic}
          onBack={() => setCurrentScreen(null)}
          onComplete={() => { setCurrentScreen(null); setActiveTab('opinion') }}
        />
      </div>
    )
  }

  if (currentScreen === 'ob2') {
    return (
      <div style={styles.app}>
        <OpinionBuilderScreen
          topicId={activeTopic}
          obIndex={1}
          onOpinionComplete={(coldTake, xp) =>
            completeOpinionBuilder(ob2Id, coldTake, xp)
          }
          onComplete={() => setCurrentScreen(null)}
        />
      </div>
    )
  }

  if (currentScreen === 'level3') {
    return (
      <div style={styles.app}>
        <Level3Screen
          topicId={activeTopic}
          onBack={() => setCurrentScreen(null)}
          onComplete={(score, total) => {
            completeQuiz(activeTopic, 3, score, total)
            setCurrentScreen(null)
            setActiveTab('home')
          }}
        />
      </div>
    )
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return (
          <HomeScreen
            progress={progress}
            onTopicSelect={handleTopicSelect}
            activeTopic={activeTopic}
          />
        )
      case 'learn':
        return (
          <LearnScreen
            topicId={activeTopic}
            progress={progress}
            onNavigate={setCurrentScreen}
          />
        )
      case 'opinion':
        if (!quizDone) {
          return (
            <LockedOpinionScreen
              topicTitle={topicTitle}
              flashcardsDone={flashcardsDone}
              quizDone={quizDone}
              onNavigate={setCurrentScreen}
            />
          )
        }
        if (ob1Done) {
          return (
            <OpinionHubScreen
              topicId={activeTopic}
              ob1Progress={progress.opinionBuilders[ob1Id]}
              ob2Progress={progress.opinionBuilders[ob2Id]}
              onStartOB2={() => setCurrentScreen('ob2')}
            />
          )
        }
        return (
          <OpinionBuilderScreen
            topicId={activeTopic}
            obIndex={0}
            onOpinionComplete={(coldTake, xp) =>
              completeOpinionBuilder(ob1Id, coldTake, xp)
            }
            onComplete={() => setCurrentScreen('level3')}
          />
        )
      case 'profile':
        return <ProfileScreen />
    }
  }

  return (
    <div style={styles.app}>
      <main style={styles.main}>
        {renderScreen()}
      </main>

      <nav style={styles.nav}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.navButton,
              ...(activeTab === tab.id ? styles.navButtonActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    maxWidth: '480px',
    margin: '0 auto',
    fontFamily: 'sans-serif',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    background: '#f5f7fa',
  },
  nav: {
    display: 'flex',
    backgroundColor: '#1A3C5E',
    padding: '0.5rem 0',
  },
  navButton: {
    flex: 1,
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.85rem',
    fontWeight: '500',
    padding: '0.6rem 0.25rem',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  navButtonActive: {
    color: '#ffffff',
    borderTop: '2px solid #ffffff',
  },
}

export default App

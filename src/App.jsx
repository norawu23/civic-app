import { useState } from 'react'
import HomeScreen from './screens/HomeScreen'
import LearnScreen from './screens/LearnScreen'
import OpinionScreen from './screens/OpinionScreen'
import ProfileScreen from './screens/ProfileScreen'

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'learn', label: 'Learn' },
  { id: 'opinion', label: 'Opinion' },
  { id: 'profile', label: 'Profile' },
]

function App() {
  const [activeTab, setActiveTab] = useState('home')

  const renderScreen = () => {
    switch (activeTab) {
      case 'home': return <HomeScreen />
      case 'learn': return <LearnScreen />
      case 'opinion': return <OpinionScreen />
      case 'profile': return <ProfileScreen />
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

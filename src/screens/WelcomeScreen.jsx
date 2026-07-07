import CivBear from '../components/CivBear.jsx'
import InstallPrompt from '../components/InstallPrompt.jsx'

function WelcomeScreen({ onCreateAccount, onContinueAsGuest }) {
  return (
    <div style={styles.screen}>
      <div style={styles.hero}>
        <CivBear mood="wave" size={180} />
        <p style={styles.tagline}>
          Learn civics. Form your own opinions. 5 minutes a day.
        </p>
      </div>

      <InstallPrompt />

      <div style={styles.actions}>
        <button style={styles.primaryBtn} onClick={onCreateAccount}>
          Create account
        </button>
        <button style={styles.ghostBtn} onClick={onContinueAsGuest}>
          Continue as guest
        </button>
      </div>
    </div>
  )
}

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1A3C5E',
    fontFamily: 'sans-serif',
    padding: '0 1.5rem',
    paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))',
    boxSizing: 'border-box',
  },
  hero: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2rem',
  },
  tagline: {
    margin: 0,
    fontSize: '1.2rem',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.88)',
    textAlign: 'center',
    lineHeight: 1.55,
    maxWidth: '260px',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  primaryBtn: {
    width: '100%',
    padding: '1rem',
    background: '#ffffff',
    color: '#1A3C5E',
    border: 'none',
    borderRadius: '14px',
    fontSize: '1rem',
    fontWeight: '700',
    cursor: 'pointer',
  },
  ghostBtn: {
    width: '100%',
    padding: '1rem',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    border: '1.5px solid rgba(255,255,255,0.2)',
    borderRadius: '14px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default WelcomeScreen

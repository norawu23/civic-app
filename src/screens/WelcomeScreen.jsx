function WelcomeScreen({ onCreateAccount, onContinueAsGuest }) {
  return (
    <div style={styles.screen}>
      <div style={styles.hero}>
        <div style={styles.iconBox}>
          <span style={styles.iconText}>CIVIC</span>
        </div>
        <p style={styles.tagline}>
          Learn civics. Form your own opinions. 5 minutes a day.
        </p>
      </div>

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
  iconBox: {
    width: '96px',
    height: '96px',
    background: '#185FA5',
    borderRadius: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
  },
  iconText: {
    color: '#ffffff',
    fontSize: '1.3rem',
    fontWeight: '800',
    letterSpacing: '0.14em',
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

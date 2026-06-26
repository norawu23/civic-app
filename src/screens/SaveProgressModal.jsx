function SaveProgressModal({ onCreateAccount, onDismiss }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.sheet}>
        <div style={styles.handle} />
        <h2 style={styles.title}>Save your evolved take</h2>
        <p style={styles.description}>
          Create a free account to save your progress and evolved takes across any device.
        </p>
        <div style={styles.buttons}>
          <button style={styles.primaryBtn} onClick={onCreateAccount}>
            Create account
          </button>
          <button style={styles.ghostBtn} onClick={onDismiss}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-end',
    zIndex: 200,
  },
  sheet: {
    width: '100%',
    background: '#ffffff',
    borderRadius: '20px 20px 0 0',
    padding: '1rem 1.5rem calc(2rem + env(safe-area-inset-bottom))',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    fontFamily: 'sans-serif',
  },
  handle: {
    width: '36px',
    height: '4px',
    background: '#e5e7eb',
    borderRadius: '2px',
    alignSelf: 'center',
    marginBottom: '0.5rem',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#1A3C5E',
  },
  description: {
    margin: '0 0 0.25rem',
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.6,
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    marginTop: '0.25rem',
  },
  primaryBtn: {
    width: '100%',
    padding: '0.95rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '700',
    cursor: 'pointer',
  },
  ghostBtn: {
    width: '100%',
    padding: '0.95rem',
    background: 'transparent',
    color: '#9ca3af',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
}

export default SaveProgressModal

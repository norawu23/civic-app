function LearnScreen() {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Learn</h1>
      <p style={styles.subtitle}>Explore civic topics</p>
    </div>
  )
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  title: {
    fontSize: '2rem',
    color: '#1A3C5E',
    marginBottom: '0.5rem',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#666',
  },
}

export default LearnScreen

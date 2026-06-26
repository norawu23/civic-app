import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { TOPICS } from '../data/topics.js'

// ─── Constants ────────────────────────────────────────────────────────────────

// avatar_id 1-6 map to these emojis (IDs match the integer stored in Supabase)
const AVATAR_MAP = { 1: '🦅', 2: '🏛️', 3: '📜', 4: '⚖️', 5: '🗽', 6: '🌍' }
const AVATAR_IDS = [1, 2, 3, 4, 5, 6]

const TOTAL_TOPICS = 5

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMemberSince(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Pull completed OBs from progress and enrich with topic/question data
function deriveEvolvedTakes(opinionBuilders) {
  return Object.entries(opinionBuilders ?? {})
    .filter(([, ob]) => ob.completed && ob.evolvedTake)
    .map(([obId, ob]) => {
      const topicId = Object.keys(TOPICS).find(tid =>
        TOPICS[tid].opinionBuilders.some(o => o.id === obId)
      )
      const topicData = topicId ? TOPICS[topicId] : null
      const obData = topicData?.opinionBuilders.find(o => o.id === obId)
      return {
        obId,
        topic: topicData?.title ?? obId,
        question: obData?.question ?? '',
        coldTake: ob.coldTake,
        evolvedTake: ob.evolvedTake,
        xpEarned: ob.xpEarned ?? 0,
      }
    })
}

// ─── Auth forms ───────────────────────────────────────────────────────────────

function AuthScreen({ signUp, signIn }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (m) => { setMode(m); setError(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        if (!username.trim()) { setError('Username is required'); setLoading(false); return }
        await signUp(email, password, username.trim())
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <p style={styles.headerEyebrow}>Profile</p>
        <p style={styles.headerTitle}>Your civic profile</p>
      </div>

      <div style={styles.authBody}>
        {/* Mode toggle */}
        <div style={styles.toggleRow}>
          <button
            style={{ ...styles.toggleBtn, ...(mode === 'signin' ? styles.toggleBtnActive : {}) }}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            style={{ ...styles.toggleBtn, ...(mode === 'signup' ? styles.toggleBtnActive : {}) }}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
        </div>

        <form style={styles.form} onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Username</label>
              <input
                style={styles.input}
                type="text"
                placeholder="your_username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
          )}

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.passwordWrap}>
              <input
                style={styles.passwordInput}
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                style={styles.revealBtn}
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && <p style={styles.errorText}>{error}</p>}

          <button
            type="submit"
            style={{ ...styles.submitBtn, ...(loading ? styles.submitBtnDisabled : {}) }}
            disabled={loading}
          >
            {loading
              ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
              : (mode === 'signup' ? 'Create account →' : 'Sign in →')}
          </button>
        </form>

        <p style={styles.switchLink}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            style={styles.switchLinkBtn}
            onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

// ─── Avatar picker ─────────────────────────────────────────────────────────────

function AvatarPicker({ currentId, onSelect, onClose }) {
  return (
    <div style={styles.pickerOverlay} onClick={onClose}>
      <div style={styles.pickerCard} onClick={e => e.stopPropagation()}>
        <p style={styles.pickerTitle}>Choose your avatar</p>
        <div style={styles.pickerGrid}>
          {AVATAR_IDS.map(id => (
            <button
              key={id}
              style={{
                ...styles.pickerItem,
                ...(id === currentId ? styles.pickerItemActive : {}),
              }}
              onClick={() => onSelect(id)}
            >
              {AVATAR_MAP[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value }) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  )
}

// ─── Evolved take card ─────────────────────────────────────────────────────────

function EvolvedTakeCard({ take }) {
  const isYes = take.coldTake === 'yes'
  return (
    <div style={styles.takeCard}>
      <div style={styles.takeTopRow}>
        <span style={styles.takeTopic}>{take.topic}</span>
        {take.xpEarned === 200 && <span style={styles.bonusPill}>+200 XP bonus</span>}
      </div>
      <p style={styles.takeQuestion}>{take.question}</p>
      <div style={styles.takeColdRow}>
        <span style={styles.takeColdLabel}>Cold take</span>
        <span style={{
          ...styles.coldTakePill,
          background: isYes ? '#f0fdf4' : '#fef2f2',
          color: isYes ? '#15803d' : '#b91c1c',
          border: `1px solid ${isYes ? '#bbf7d0' : '#fecaca'}`,
        }}>
          {isYes ? '👍 Yes' : '👎 No'}
        </span>
      </div>
      <div style={styles.takeEvolvedBox}>
        <p style={styles.takeEvolvedLabel}>↓ evolved take</p>
        <p style={styles.takeEvolvedText}>{take.evolvedTake}</p>
      </div>
    </div>
  )
}

// ─── Logged-in profile view ───────────────────────────────────────────────────

function ProfileView({ user, progress, signOut }) {
  const [profile, setProfile] = useState(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('username, avatar_id, created_at')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data) setProfile(data) })
  }, [user.id])

  const handleAvatarSelect = async (id) => {
    setAvatarOpen(false)
    setProfile(prev => ({ ...prev, avatar_id: id }))
    await supabase.from('profiles').update({ avatar_id: id }).eq('id', user.id)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try { await signOut() } catch { setSigningOut(false) }
  }

  // Compute stats
  const totalXP = progress?.user?.totalXP ?? 0
  const streak = progress?.user?.streak ?? 0
  const topicsCompleted = Object.values(progress?.topics ?? {})
    .filter(t => t.levels?.['3']?.quizComplete).length

  const evolvedTakes = deriveEvolvedTakes(progress?.opinionBuilders)
  const memberSince = formatMemberSince(profile?.created_at)

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <div style={styles.headerRow}>
          <div>
            <p style={styles.headerEyebrow}>Profile</p>
            <p style={styles.headerTitle}>Your civic profile</p>
          </div>
          <button
            style={{ ...styles.signOutBtn, ...(signingOut ? styles.signOutBtnDisabled : {}) }}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>

      <div style={styles.profileBody}>
        {/* Avatar + identity */}
        <div style={styles.identitySection}>
          <button style={styles.avatarBtn} onClick={() => setAvatarOpen(true)}>
            <span style={styles.avatarEmoji}>{AVATAR_MAP[profile?.avatar_id] ?? '🦅'}</span>
            <span style={styles.avatarEditHint}>tap to change</span>
          </button>
          <div>
            <p style={styles.username}>{profile?.username ?? user.email?.split('@')[0]}</p>
            {memberSince && <p style={styles.memberSince}>Member since {memberSince}</p>}
          </div>
        </div>

        {/* Stats */}
        <div style={styles.statsRow}>
          <StatCard label="Total XP" value={totalXP} />
          <StatCard label={streak === 1 ? 'Day streak' : 'Day streak'} value={`${streak}🔥`} />
          <StatCard label="Topics done" value={`${topicsCompleted}/${TOTAL_TOPICS}`} />
        </div>

        {/* Evolved takes */}
        <p style={styles.sectionTitle}>Your evolved takes</p>

        {evolvedTakes.length === 0 ? (
          <div style={styles.emptyTakes}>
            <span style={styles.emptyIcon}>💬</span>
            <p style={styles.emptyText}>
              Complete an Opinion Builder to see your evolved takes here.
            </p>
          </div>
        ) : (
          evolvedTakes.map(take => (
            <EvolvedTakeCard key={take.obId} take={take} />
          ))
        )}
      </div>

      {avatarOpen && (
        <AvatarPicker
          currentId={profile?.avatar_id ?? 1}
          onSelect={handleAvatarSelect}
          onClose={() => setAvatarOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function ProfileScreen({ user, progress, signUp, signIn, signOut }) {
  if (!user) {
    return <AuthScreen signUp={signUp} signIn={signIn} />
  }
  return <ProfileView user={user} progress={progress} signOut={signOut} />
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
    background: '#f5f7fa',
    fontFamily: 'sans-serif',
  },

  /* Shared header */
  header: {
    background: '#1A3C5E',
    padding: '1.5rem 1.25rem 1.25rem',
    flexShrink: 0,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
    fontSize: '1.3rem',
    fontWeight: '700',
    color: '#ffffff',
  },
  signOutBtn: {
    marginTop: '0.125rem',
    padding: '0.4rem 0.875rem',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '0.8rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
  signOutBtnDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },

  /* Auth layout */
  authBody: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 1.25rem',
    gap: '1rem',
  },
  toggleRow: {
    display: 'flex',
    background: '#e5e7eb',
    borderRadius: '10px',
    padding: '3px',
    gap: '3px',
  },
  toggleBtn: {
    flex: 1,
    padding: '0.6rem',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  toggleBtnActive: {
    background: '#ffffff',
    color: '#1A3C5E',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.875rem',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#374151',
    letterSpacing: '0.01em',
  },
  input: {
    padding: '0.75rem 0.875rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9rem',
    color: '#111827',
    background: '#ffffff',
    outline: 'none',
    fontFamily: 'sans-serif',
    boxSizing: 'border-box',
    width: '100%',
  },
  passwordWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  passwordInput: {
    padding: '0.75rem 3.5rem 0.75rem 0.875rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9rem',
    color: '#111827',
    background: '#ffffff',
    outline: 'none',
    fontFamily: 'sans-serif',
    boxSizing: 'border-box',
    width: '100%',
  },
  revealBtn: {
    position: 'absolute',
    right: '0.75rem',
    background: 'none',
    border: 'none',
    padding: '0.25rem',
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#185FA5',
    cursor: 'pointer',
    lineHeight: 1,
  },
  errorText: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#dc2626',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '0.625rem 0.75rem',
    lineHeight: 1.5,
  },
  submitBtn: {
    padding: '0.9rem',
    background: '#1A3C5E',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '0.25rem',
  },
  submitBtnDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },
  switchLink: {
    margin: 0,
    textAlign: 'center',
    fontSize: '0.85rem',
    color: '#6b7280',
  },
  switchLinkBtn: {
    background: 'none',
    border: 'none',
    color: '#185FA5',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    padding: 0,
  },

  /* Profile layout */
  profileBody: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  identitySection: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '1rem 1.25rem',
  },
  avatarBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    background: '#EFF6FF',
    border: '2px solid #bfdbfe',
    borderRadius: '50%',
    width: '68px',
    height: '68px',
    cursor: 'pointer',
    flexShrink: 0,
    justifyContent: 'center',
    padding: 0,
  },
  avatarEmoji: {
    fontSize: '2rem',
    lineHeight: 1,
  },
  avatarEditHint: {
    fontSize: '0.5rem',
    color: '#185FA5',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    lineHeight: 1,
  },
  username: {
    margin: '0 0 0.2rem',
    fontSize: '1.1rem',
    fontWeight: '700',
    color: '#111827',
  },
  memberSince: {
    margin: 0,
    fontSize: '0.775rem',
    color: '#9ca3af',
  },

  statsRow: {
    display: 'flex',
    gap: '0.625rem',
  },
  statCard: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem 0.5rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
  },
  statValue: {
    fontSize: '1.25rem',
    fontWeight: '800',
    color: '#1A3C5E',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: '0.65rem',
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    textAlign: 'center',
  },

  sectionTitle: {
    margin: '0.25rem 0 0',
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  /* Evolved take cards */
  takeCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '1rem 1.125rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  takeTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  takeTopic: {
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#185FA5',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  bonusPill: {
    fontSize: '0.65rem',
    fontWeight: '700',
    color: '#ffffff',
    background: '#f59e0b',
    padding: '0.15rem 0.5rem',
    borderRadius: '20px',
    letterSpacing: '0.02em',
  },
  takeQuestion: {
    margin: 0,
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#111827',
    lineHeight: 1.45,
  },
  takeColdRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
  },
  takeColdLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#9ca3af',
  },
  coldTakePill: {
    fontSize: '0.78rem',
    fontWeight: '700',
    padding: '0.2rem 0.6rem',
    borderRadius: '20px',
  },
  takeEvolvedBox: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '0.75rem',
  },
  takeEvolvedLabel: {
    margin: '0 0 0.375rem',
    fontSize: '0.65rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  takeEvolvedText: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#374151',
    lineHeight: 1.6,
  },

  /* Empty state */
  emptyTakes: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '2rem 1.5rem',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
  },
  emptyIcon: {
    fontSize: '2rem',
    lineHeight: 1,
  },
  emptyText: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 1.55,
    maxWidth: '240px',
  },

  /* Avatar picker overlay */
  pickerOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'flex-end',
    zIndex: 100,
  },
  pickerCard: {
    width: '100%',
    maxWidth: '480px',
    margin: '0 auto',
    background: '#ffffff',
    borderRadius: '20px 20px 0 0',
    padding: '1.5rem 1.25rem 2rem',
  },
  pickerTitle: {
    margin: '0 0 1.25rem',
    fontSize: '0.75rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    textAlign: 'center',
  },
  pickerGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.875rem',
    flexWrap: 'wrap',
  },
  pickerItem: {
    width: '60px',
    height: '60px',
    borderRadius: '14px',
    border: '2px solid #e5e7eb',
    background: '#f9fafb',
    fontSize: '1.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  pickerItemActive: {
    border: '2px solid #185FA5',
    background: '#EFF6FF',
  },
}

export default ProfileScreen

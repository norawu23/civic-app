import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { TOPICS } from '../data/topics.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function topicsCompleted(progressData) {
  return Object.values(progressData?.topics ?? {})
    .filter(t => t.levels?.['3']?.quizComplete).length
}

function topicTitleForOb(obId) {
  const topicId = Object.keys(TOPICS).find(tid =>
    TOPICS[tid].opinionBuilders.some(o => o.id === obId)
  )
  return topicId ? TOPICS[topicId].title : obId
}

function extractEvolvedTakes(mergedRows) {
  const takes = []
  for (const row of mergedRows) {
    const obs = row.progressData?.opinionBuilders ?? {}
    for (const [obId, ob] of Object.entries(obs)) {
      if (ob.completed && ob.evolvedTake) {
        takes.push({
          key: `${row.id}-${obId}`,
          username: row.username,
          topic: topicTitleForOb(obId),
          coldTake: ob.coldTake,
          evolvedTake: ob.evolvedTake,
          updatedAt: row.updatedAt,
        })
      }
    }
  }
  // No per-take timestamp in schema — sort by the user's progress row updated_at
  // as a best-available approximation of recency.
  return takes.sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value }) {
  return (
    <div style={s.summaryCard}>
      <span style={s.summaryValue}>{value}</span>
      <span style={s.summaryLabel}>{label}</span>
    </div>
  )
}

function SectionTitle({ children }) {
  return <p style={s.sectionTitle}>{children}</p>
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function AdminScreen({ isAdmin, onBack }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  // Hard redirect — component should never be reached by non-admins, but
  // guard here as a second layer.
  useEffect(() => {
    if (isAdmin === false) onBack()
  }, [isAdmin, onBack])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false

    async function load() {
      const [profilesRes, progressRes] = await Promise.all([
        supabase.from('profiles').select('id, username, created_at'),
        supabase.from('progress').select('user_id, progress_data, updated_at'),
      ])

      if (cancelled) return

      if (profilesRes.error || progressRes.error) {
        setError((profilesRes.error ?? progressRes.error).message)
        return
      }

      const progressByUser = new Map(
        progressRes.data.map(r => [r.user_id, r])
      )

      const merged = profilesRes.data.map(p => {
        const pr = progressByUser.get(p.id)
        const pd = pr?.progress_data
        return {
          id: p.id,
          username: p.username ?? '(no username)',
          createdAt: p.created_at,
          totalXP: pd?.user?.totalXP ?? 0,
          streak: pd?.user?.streak ?? 0,
          topicsCompleted: topicsCompleted(pd),
          updatedAt: pr?.updated_at,
          progressData: pd,
        }
      })

      // Newest registrations first
      merged.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))

      if (!cancelled) setRows(merged)
    }

    load()
    return () => { cancelled = true }
  }, [isAdmin])

  // ── Render helpers ──────────────────────────────────────────────────────────

  const header = (
    <div style={s.header}>
      <button style={s.backBtn} onClick={onBack}>←</button>
      <div>
        <p style={s.headerEyebrow}>Admin</p>
        <p style={s.headerTitle}>Analytics</p>
      </div>
    </div>
  )

  if (error) {
    return (
      <div style={s.screen}>
        {header}
        <div style={s.body}>
          <p style={s.errorText}>Failed to load: {error}</p>
          <p style={s.errorHint}>
            Make sure the profiles and progress tables have RLS policies
            allowing admin users to SELECT all rows.
          </p>
        </div>
      </div>
    )
  }

  if (!rows) {
    return (
      <div style={s.screen}>
        {header}
        <div style={s.body}>
          <p style={s.loadingText}>Loading…</p>
        </div>
      </div>
    )
  }

  const takes = extractEvolvedTakes(rows)

  return (
    <div style={s.screen}>
      {header}

      <div style={s.body}>
        {/* Summary row */}
        <div style={s.summaryRow}>
          <SummaryCard label="Registered users" value={rows.length} />
          <SummaryCard label="Evolved takes" value={takes.length} />
        </div>

        {/* Users table */}
        <SectionTitle>All users ({rows.length})</SectionTitle>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Username', 'Joined', 'XP', 'Streak', 'Topics'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id} style={i % 2 === 1 ? s.trAlt : undefined}>
                  <td style={s.td}>{u.username}</td>
                  <td style={s.tdMono}>{fmt(u.createdAt)}</td>
                  <td style={s.tdNum}>{u.totalXP}</td>
                  <td style={s.tdNum}>{u.streak}</td>
                  <td style={s.tdNum}>{u.topicsCompleted}/5</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Evolved takes list */}
        <SectionTitle>Recent evolved takes ({takes.length})</SectionTitle>

        {takes.length === 0 ? (
          <p style={s.emptyText}>No evolved takes submitted yet.</p>
        ) : (
          takes.map(take => (
            <div key={take.key} style={s.takeCard}>
              <div style={s.takeTopRow}>
                <span style={s.takeUsername}>{take.username}</span>
                <span style={s.takeTopic}>{take.topic}</span>
                <span
                  style={{
                    ...s.coldPill,
                    background: take.coldTake === 'yes' ? '#d1fae5' : '#fee2e2',
                    color: take.coldTake === 'yes' ? '#065f46' : '#991b1b',
                  }}
                >
                  {take.coldTake === 'yes' ? '👍 Yes' : '👎 No'}
                </span>
              </div>
              <p style={s.takeText}>{take.evolvedTake}</p>
            </div>
          ))
        )}

        <div style={{ height: '2rem' }} />
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-bg)',
    fontFamily: 'sans-serif',
  },

  header: {
    background: 'var(--color-navy)',
    padding: '1rem 1.25rem 1.25rem',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.875rem',
  },
  backBtn: {
    marginTop: '0.2rem',
    width: '36px',
    height: '36px',
    flexShrink: 0,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '1.1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEyebrow: {
    margin: '0 0 0.15rem',
    fontSize: '0.68rem',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  headerTitle: {
    margin: 0,
    fontSize: '1.3rem',
    fontWeight: '700',
    color: '#ffffff',
  },

  body: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.875rem',
  },

  // Summary cards
  summaryRow: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '0.25rem',
  },
  summaryCard: {
    flex: 1,
    background: 'var(--color-navy)',
    borderRadius: '14px',
    padding: '1rem 0.75rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.3rem',
  },
  summaryValue: {
    fontSize: '1.8rem',
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 1,
  },
  summaryLabel: {
    fontSize: '0.65rem',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    textAlign: 'center',
  },

  sectionTitle: {
    margin: '0.5rem 0 0.25rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  // Users table
  tableWrap: {
    overflowX: 'auto',
    borderRadius: '12px',
    border: '1px solid #e9ecef',
    background: 'var(--color-card)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
    minWidth: '340px',
  },
  th: {
    padding: '0.625rem 0.75rem',
    background: 'var(--color-navy)',
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '0.55rem 0.75rem',
    color: 'var(--color-text)',
    borderBottom: '1px solid #f0f0f0',
    verticalAlign: 'middle',
  },
  tdMono: {
    padding: '0.55rem 0.75rem',
    color: 'var(--color-text-secondary)',
    fontSize: '0.75rem',
    borderBottom: '1px solid #f0f0f0',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  },
  tdNum: {
    padding: '0.55rem 0.75rem',
    color: 'var(--color-navy)',
    fontWeight: '600',
    textAlign: 'right',
    borderBottom: '1px solid #f0f0f0',
    verticalAlign: 'middle',
  },
  trAlt: {
    background: '#f8f9fa',
  },

  // Evolved take cards
  takeCard: {
    background: 'var(--color-card)',
    border: '1px solid #e9ecef',
    borderRadius: '12px',
    padding: '0.875rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
  },
  takeTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  takeUsername: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--color-navy)',
  },
  takeTopic: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--color-blue)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flex: 1,
  },
  coldPill: {
    fontSize: '0.68rem',
    fontWeight: '700',
    padding: '0.15rem 0.5rem',
    borderRadius: '20px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  takeText: {
    margin: 0,
    fontSize: '0.82rem',
    color: '#374151',
    lineHeight: 1.6,
  },

  // States
  loadingText: {
    margin: '2rem auto',
    fontSize: '0.9rem',
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
  },
  errorText: {
    margin: 0,
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--color-coral)',
  },
  errorHint: {
    margin: 0,
    fontSize: '0.78rem',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
  },
  emptyText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#9ca3af',
  },
}

export default AdminScreen

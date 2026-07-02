import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_PROGRESS } from './useProgress'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Look up the admin flag whenever the signed-in user changes (and clear
  // it immediately on sign-out, rather than waiting on a stale value).
  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      return
    }

    let cancelled = false
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        setIsAdmin(!error && data?.is_admin === true)
      })

    return () => { cancelled = true }
  }, [user?.id])

  const signUp = useCallback(async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error

    // Note: if email confirmation is enabled in your Supabase project, data.session
    // will be null here. Disable email confirmation in Authentication → Settings for
    // a frictionless MVP experience.
    if (data.user) {
      const [profileResult, progressResult] = await Promise.all([
        supabase.from('profiles').insert({ id: data.user.id, username, avatar_id: 1 }),
        supabase.from('progress').insert({ user_id: data.user.id, progress_data: DEFAULT_PROGRESS }),
      ])
      if (profileResult.error) throw profileResult.error
      if (progressResult.error) throw progressResult.error
    }

    return data
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  return { user, isAdmin, loading, signUp, signIn, signOut }
}

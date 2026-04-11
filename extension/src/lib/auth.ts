// ============================================================
// lib/auth.ts — Gerenciamento de sessão Supabase na extensão
// A extensão usa chrome.storage.local (não localStorage)
// pois service workers não têm acesso ao localStorage do DOM
// ============================================================

import { createClient, Session } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fzphfdvlsvxqrpwpmfuv.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6cGhmZHZsc3Z4cXJwd3BtZnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDk5MjgsImV4cCI6MjA5MTMyNTkyOH0.4Ezmk0bPL-0EfXWba8xurEcNr5x-7VIRVb1BcrTZfZ0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // gerenciamos manualmente via chrome.storage
    autoRefreshToken: false,
  },
})

const STORAGE_KEY = 'lemon_meet_session'

export async function getStoredSession(): Promise<Session | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const session = result[STORAGE_KEY] as Session | undefined
      if (!session) { resolve(null); return }

      // Verifica se o token expirou
      const expiresAt = session.expires_at ?? 0
      if (Date.now() / 1000 > expiresAt - 60) {
        // Tenta renovar
        supabase.auth
          .refreshSession({ refresh_token: session.refresh_token })
          .then(({ data, error }) => {
            if (error || !data.session) {
              clearStoredSession().then(() => resolve(null))
              return
            }
            storeSession(data.session).then(() => resolve(data.session))
          })
        return
      }

      resolve(session)
    })
  })
}

export async function storeSession(session: Session): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: session }, resolve)
  })
}

export async function clearStoredSession(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve)
  })
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    throw new Error(error?.message || 'Falha ao autenticar')
  }
  await storeSession(data.session)
  return data.session
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut().catch(() => {})
  await clearStoredSession()
}

// Importa a sessão do app web (localhost:5173) que já está logado com Google
export async function importSessionFromWebApp(): Promise<Session> {
  const SUPABASE_KEY = `sb-fzphfdvlsvxqrpwpmfuv-auth-token`

  // Verifica se já há uma aba do app aberta
  const tabs = await chrome.tabs.query({ url: 'http://localhost:5173/*' })

  if (!tabs.length || !tabs[0].id) {
    // Abre o app e avisa o usuário
    await chrome.tabs.create({ url: 'http://localhost:5173' })
    throw new Error('App aberto! Faça login com Google e clique em "Conectar extensão" novamente.')
  }

  const tabId = tabs[0].id

  // Lê a sessão do localStorage do app
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (key: string) => {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      try { return JSON.parse(raw) } catch { return null }
    },
    args: [SUPABASE_KEY],
  })

  const sessionData = results[0]?.result
  if (!sessionData?.access_token) {
    throw new Error('Sem sessão no app. Faça login com Google em localhost:5173 primeiro.')
  }

  const session = sessionData as Session
  await storeSession(session)
  return session
}

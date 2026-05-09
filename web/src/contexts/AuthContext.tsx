import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { invalidateMeetingsCache } from '@/lib/meetingsCache'

// REMOVIDO: tryAcceptInvite() - era para convites por email (antigo)
// Agora usamos apenas o fluxo de links com tokens, processado pelo Dashboard

// Função de limpeza SELETIVA para evitar cache entre usuários
function clearAllCaches(keepPendingInvite = false) {
  console.log('[Auth] 🧹 LIMPEZA SELETIVA DE CACHE')
  
  // Limpa cache in-memory
  invalidateMeetingsCache()
  
  // Lista de chaves para PRESERVAR (Supabase auth + preferências do usuário)
  const keysToPreserve: string[] = []
  
  // Preserva token de convite se necessário
  if (keepPendingInvite) {
    keysToPreserve.push('pending_team_join')
  }
  
  // Preserva preferência de onboarding
  keysToPreserve.push('lemon_onboarding_seen')
  
  // Preserva chaves do Supabase (auth tokens)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('sb-')) {
      keysToPreserve.push(key)
    }
  }
  
  console.log('[Auth] 🔒 Preservando chaves:', keysToPreserve)
  
  // Salva valores que precisam ser preservados
  const preserved: Record<string, string> = {}
  keysToPreserve.forEach(key => {
    const value = localStorage.getItem(key)
    if (value) preserved[key] = value
  })
  
  // Limpa localStorage
  localStorage.clear()
  
  // Limpa sessionStorage
  sessionStorage.clear()
  
  // Restaura valores preservados
  Object.entries(preserved).forEach(([key, value]) => {
    localStorage.setItem(key, value)
  })
  
  console.log('[Auth] ✅ Limpeza seletiva executada')
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Verificar sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[Auth] 🔍 Sessão inicial detectada:', session?.user?.email)
      
      // CRÍTICO: Limpa cache logo ao carregar se há sessão
      // Garante que não há cache de outro usuário ao iniciar
      if (session) {
        console.log('[Auth] 🧹 Limpando cache ao detectar sessão inicial')
        clearAllCaches(true) // Preserva token de convite
      }
      
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Escutar mudanças na autenticação
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] 🔔 Evento:', event, 'User:', session?.user?.email)
      
      const previousUserId = user?.id
      const newUserId = session?.user?.id
      
      // LIMPEZA ao fazer logout
      if (event === 'SIGNED_OUT') {
        console.log('[Auth] 🚪 LOGOUT detectado - Limpando cache')
        clearAllCaches(false) // Não preserva convite
      }
      
      // LIMPEZA SEMPRE ao fazer login (novo usuário OU troca de conta)
      if (event === 'SIGNED_IN') {
        if (previousUserId && newUserId && previousUserId !== newUserId) {
          console.warn('[Auth] ⚠️ MUDANÇA DE USUÁRIO! Previous:', previousUserId, 'New:', newUserId)
        } else {
          console.log('[Auth] 🔑 NOVO LOGIN - Limpando cache da sessão anterior')
        }
        clearAllCaches(true) // Preserva token de convite
      }
      
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      
      // Convites pendentes são processados pelo Dashboard via localStorage
    })

    return () => subscription.unsubscribe()
  }, [user?.id])

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      
      if (!error) {
        console.log('[Auth] ✅ Login bem-sucedido')
        // Verifica se há token de convite pendente
        const pendingToken = localStorage.getItem('pending_team_join')
        if (pendingToken) {
          console.log('[Auth] 🎟️ Token de convite detectado, será processado pelo Dashboard')
        }
      }
      
      return { error }
    } catch (error) {
      return { error: error as AuthError }
    }
  }

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      })
      return { error }
    } catch (error) {
      console.error('Error signing in with Google:', error)
      return { error: error as AuthError }
    }
  }

  const signOut = async () => {
    try {
      console.log('[Auth] 🚪 Fazendo logout...')
      clearAllCaches(false) // Limpa TUDO, inclusive token de convite
      await supabase.auth.signOut()
      setUser(null)
      setSession(null)
      console.log('[Auth] ✅ Logout completo')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signInWithGoogle,
        signInWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

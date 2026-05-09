import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { invalidateMeetingsCache } from '@/lib/meetingsCache'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

async function tryAcceptInvite(session: Session) {
  try {
    await fetch(`${API}/api/teams/accept-invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
  } catch {
    // não bloqueia o login
  }
}

// Função de limpeza TOTAL para evitar cache entre usuários
function clearAllCaches(keepPendingInvite = false) {
  console.log('[Auth] 🧹 LIMPEZA TOTAL DE CACHE E STORAGE')
  
  // Salva token de convite se necessário
  const pendingToken = keepPendingInvite ? localStorage.getItem('pending_team_join') : null
  
  // Limpa cache in-memory
  invalidateMeetingsCache()
  
  // Limpa localStorage COMPLETAMENTE
  localStorage.clear()
  
  // Limpa sessionStorage
  sessionStorage.clear()
  
  // Restaura token de convite se necessário
  if (pendingToken) {
    console.log('[Auth] 🎟️ Restaurando token de convite:', pendingToken)
    localStorage.setItem('pending_team_join', pendingToken)
  }
  
  console.log('[Auth] ✅ Limpeza completa executada')
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
      
      // LIMPEZA TOTAL ao fazer logout
      if (event === 'SIGNED_OUT') {
        console.log('[Auth] 🚪 LOGOUT detectado - Limpando TUDO')
        clearAllCaches(false) // Não preserva convite
      }
      
      // LIMPEZA TOTAL ao fazer login (exceto token de convite)
      if (event === 'SIGNED_IN') {
        console.log('[Auth] 🔑 LOGIN detectado - Limpando cache anterior')
        clearAllCaches(true) // Preserva token de convite
        
        // Se mudou de usuário, alerta extra
        if (previousUserId && newUserId && previousUserId !== newUserId) {
          console.warn('[Auth] ⚠️ MUDANÇA DE USUÁRIO! Previous:', previousUserId, 'New:', newUserId)
        }
      }
      
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      
      // Ativa convites pendentes quando o usuário loga
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        tryAcceptInvite(session)
      }
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

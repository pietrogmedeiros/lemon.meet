import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { useAuth } from './AuthContext'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export type Plan = 'trial' | 'starter' | 'professional'
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled'

export interface Subscription {
  id: string
  user_id: string
  plan: Plan
  status: SubscriptionStatus
  trial_ends_at: string | null
  plan_ends_at: string | null
  created_at: string
  updated_at: string
}

interface SubscriptionContextType {
  subscription: Subscription | null
  loading: boolean
  isTrial: boolean
  isExpired: boolean
  /** Dias restantes de trial. null se não estiver em trial. */
  daysLeft: number | null
  refetch: () => void
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined)

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSubscription = useCallback(async () => {
    if (!session) {
      setSubscription(null)
      setLoading(false)
      return
    }

    try {
      // init é idempotente: cria trial se não existir e corrige status expirado
      const res = await fetch(`${API}/api/subscription/init`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      setSubscription(data.subscription ?? null)
    } catch {
      // Falha silenciosa — não bloqueia o usuário por erro de rede
      setSubscription(null)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    setLoading(true)
    fetchSubscription()
  }, [fetchSubscription])

  const isTrial = subscription?.plan === 'trial'
  const isExpired = subscription?.status === 'expired'

  let daysLeft: number | null = null
  if (isTrial && !isExpired && subscription?.trial_ends_at) {
    const diff = new Date(subscription.trial_ends_at).getTime() - Date.now()
    daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  return (
    <SubscriptionContext.Provider
      value={{ subscription, loading, isTrial, isExpired, daysLeft, refetch: fetchSubscription }}
    >
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider')
  return ctx
}

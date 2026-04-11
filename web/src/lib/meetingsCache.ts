// Cache in-memory de reuniões compartilhado entre páginas
// Evita múltiplos fetches ao navegar entre Dashboard, Reuniões e Insights

import { supabase } from './supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const TTL_MS = 30_000 // 30 segundos

interface CacheEntry {
  data: Meeting[]
  expiresAt: number
  promise?: Promise<Meeting[]> // deduplica fetches simultâneos
}

export interface Meeting {
  id: string
  title: string | null
  platform: string | null
  status: string | null
  meet_link: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  insights?: unknown
  created_at: string
}

let cache: CacheEntry | null = null

export function invalidateMeetingsCache(): void {
  cache = null
}

export async function fetchMeetings(limit = 100): Promise<Meeting[]> {
  const now = Date.now()

  // Serve do cache se ainda válido
  if (cache && now < cache.expiresAt) {
    return cache.data
  }

  // Deduplica: se já há um fetch em andamento, aguarda o mesmo
  if (cache?.promise) {
    return cache.promise
  }

  const promise = (async (): Promise<Meeting[]> => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${API}/api/meetings?limit=${limit}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (!res.ok) throw new Error('Failed to fetch meetings')
    const json = await res.json()
    const meetings: Meeting[] = json.meetings ?? []

    cache = { data: meetings, expiresAt: Date.now() + TTL_MS }
    return meetings
  })()

  // Armazena a promise para deduplicação
  if (!cache) cache = { data: [], expiresAt: 0, promise }
  else cache.promise = promise

  try {
    return await promise
  } finally {
    if (cache) cache.promise = undefined
  }
}

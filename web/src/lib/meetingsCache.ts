// Cache in-memory de reuniões compartilhado entre páginas
// Evita múltiplos fetches ao navegar entre Dashboard, Reuniões e Insights

import { supabase } from './supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const TTL_MS = 30_000 // 30 segundos

interface CacheEntry {
  data: Meeting[]
  expiresAt: number
  userId: string // NOVO: vincula cache ao usuário
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
  user_id?: string | null
  user_name?: string | null
  user_avatar_url?: string | null
  team_id?: string | null
  transcript?: string | null
}

let cache: CacheEntry | null = null

export function invalidateMeetingsCache(): void {
  console.log('[MeetingsCache] 🗑️ Cache invalidado')
  cache = null
}

export async function fetchMeetings(limit = 100): Promise<Meeting[]> {
  const now = Date.now()
  
  console.log('[MeetingsCache] 🔍 Iniciando fetchMeetings...')
  console.log('[MeetingsCache] ⏰ Timestamp:', new Date().toISOString())
  
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.warn('[MeetingsCache] ❌ Sem sessão, não pode buscar reuniões')
    return []
  }

  const currentUserId = session.user.id
  const userEmail = session.user.email
  
  // 🔧 DEV USER: sem limite
  const isDevUser = userEmail?.toLowerCase().trim() === 'pietrogoncalvesmedeiros@gmail.com'
  if (isDevUser) {
    limit = 9999
    console.log('[MeetingsCache] 🔧 DEV USER detectado - removendo limite')
  }
  
  console.log('[MeetingsCache] 👤 Current user ID:', currentUserId)
  console.log('[MeetingsCache] 📧 Current user email:', userEmail)

  // SEGURANÇA REFORÇADA: SEMPRE invalida cache se não for do usuário atual
  if (cache) {
    console.log('[MeetingsCache] 📦 Cache existe')
    console.log('[MeetingsCache] 🔍 Cache userId:', cache.userId)
    console.log('[MeetingsCache] 🔍 Cache expiresAt:', new Date(cache.expiresAt).toISOString())
    
    if (cache.userId !== currentUserId) {
      console.error('[MeetingsCache] 🚨 CACHE DE OUTRO USUÁRIO DETECTADO!')
      console.error('[MeetingsCache] ❌ Cache userId:', cache.userId)
      console.error('[MeetingsCache] ✅ Current userId:', currentUserId)
      console.error('[MeetingsCache] 🧹 INVALIDANDO IMEDIATAMENTE')
      cache = null
    }
  } else {
    console.log('[MeetingsCache] 📭 Nenhum cache existente')
  }

  // Serve do cache se ainda válido E for do mesmo usuário
  if (cache && now < cache.expiresAt && cache.userId === currentUserId) {
    console.log('[MeetingsCache] ✅ Usando cache válido')
    return cache.data
  }

  if (cache && now >= cache.expiresAt) {
    console.log('[MeetingsCache] ⏱️ Cache expirado, buscando novamente')
    cache = null
  }

  // Deduplica: se já há um fetch em andamento, aguarda o mesmo
  if (cache?.promise && cache.userId === currentUserId) {
    console.log('[MeetingsCache] ⏳ Aguardando fetch em andamento')
    return cache.promise
  }

  console.log('[MeetingsCache] 🔄 Buscando reuniões do servidor...')
  console.log('[MeetingsCache] 📡 API URL:', `${API}/api/meetings?limit=${limit}`)
  
  const promise = (async (): Promise<Meeting[]> => {
    const res = await fetch(`${API}/api/meetings?limit=${limit}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (!res.ok) throw new Error('Failed to fetch meetings')
    const json = await res.json()
    const meetings: Meeting[] = json.meetings ?? []

    console.log('[MeetingsCache] ✅ Reuniões carregadas:', meetings.length)
    
    cache = { 
      data: meetings, 
      expiresAt: Date.now() + TTL_MS,
      userId: currentUserId // Vincula ao usuário
    }
    return meetings
  })()

  // Armazena a promise para deduplicação
  if (!cache) cache = { data: [], expiresAt: 0, userId: currentUserId, promise }
  else cache.promise = promise

  try {
    return await promise
  } finally {
    if (cache) cache.promise = undefined
  }
}

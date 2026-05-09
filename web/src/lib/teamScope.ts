import { supabase } from './supabase'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export interface TeamOption {
  id: string
  name: string
  isOwner?: boolean
}

export async function fetchUserTeams(): Promise<TeamOption[]> {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return []
  }

  const response = await fetch(`${API}/api/teams`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (!response.ok) {
    throw new Error('Falha ao carregar times do usuário')
  }

  const json = await response.json()
  return json.teams ?? []
}
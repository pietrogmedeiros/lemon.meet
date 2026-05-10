const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export interface TeamOption {
  id: string
  name: string
  isOwner?: boolean
}

export async function fetchUserTeams(accessToken?: string | null): Promise<TeamOption[]> {
  if (!accessToken) {
    return []
  }

  const response = await fetch(`${API}/api/teams`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error('Falha ao carregar times do usuário')
  }

  const json = await response.json()
  return json.teams ?? []
}
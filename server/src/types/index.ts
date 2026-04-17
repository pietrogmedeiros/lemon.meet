// Tipo para a tabela transcricoes do Supabase
export interface Transcricao {
  id: number
  created_at: string
  id_drive: string | null
  responsavel: string | null
  'r:agente1': string | null
  'r:agente2': string | null
  'r:agente3': string | null
  'r:agente4': string | null
  status: boolean | null
  email_lead: string | null
}

// Interface para resposta da API
export interface TranscricoesResponse {
  success: boolean
  transcricoes: Transcricao[]
  total: number
}

export interface TranscricaoResponse {
  success: boolean
  transcricao: Transcricao
}

// ── Rapport ──────────────────────────────────────────────────────────────────

export interface RapportCompany {
  name: string
  description: string
  mainProducts: string[]
  recentHighlights: string[]
  talkingPoints: string[]
}

export interface RapportPerson {
  name: string
  role: string
  background: string
  conversationStarters: string[]
}

export interface RapportData {
  company?: RapportCompany
  person?: RapportPerson
  rapportTips: string[]
  iceBreakers: string[]
  suggestedTopics: string[]
}

export interface MeetingRapport {
  id: string
  meeting_id: string
  user_id: string
  website_url: string | null
  linkedin_url: string | null
  instagram_url: string | null
  rapport_data: RapportData | null
  created_at: string
  updated_at: string
}

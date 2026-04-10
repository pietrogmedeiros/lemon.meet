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

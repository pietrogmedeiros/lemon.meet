// ============================================================
// meetingAccess.ts — Funções auxiliares para acesso a reuniões
// ============================================================

import { supabase } from '../config/supabase.js'

/**
 * Retorna query builder para buscar reuniões acessíveis ao usuário.
 * 
 * Busca reuniões onde:
 * - user_id está em memberIds (próprio usuário ou membros do time se admin) OU
 * - team_id é o mesmo do usuário (qualquer reunião do time)
 * 
 * Isso garante que membros comuns do time vejam reuniões de outros membros
 * quando são do mesmo team (ex: reuniões agendadas via calendário).
 */
export async function getMeetingsAccessQuery(userId: string, memberIds: string[]) {
  // Busca team_id do usuário
  const { data: teamMemberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
  
  const myTeamId = teamMemberships?.[0]?.team_id
  
  // Se tem team, busca por user_id OU team_id
  if (myTeamId) {
    return supabase
      .from('meetings')
      .select('*')
      .or(`user_id.in.(${memberIds.join(',')}),team_id.eq.${myTeamId}`)
  }
  
  // Sem team, só busca por user_id
  return supabase
    .from('meetings')
    .select('*')
    .in('user_id', memberIds)
}

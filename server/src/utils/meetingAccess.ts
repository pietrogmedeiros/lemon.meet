// ============================================================
// meetingAccess.ts — Funções auxiliares para acesso a reuniões
// ============================================================

import { supabase } from '../config/supabase.js'

/**
 * Retorna query builder para buscar reuniões acessíveis ao usuário.
 * 
 * REGRAS DE ACESSO:
 * - Owner/Admin do time: vê TODAS as reuniões do time (monitoramento total)
 * - Membro comum: vê apenas reuniões onde está presente (user_id ou participant_emails)
 * 
 * Isso permite que admins monitorem tudo, mas membros comuns só vejam
 * reuniões relevantes para eles.
 */
export async function getMeetingsAccessQuery(userId: string, memberIds: string[]) {
  // Verifica se é owner ou admin de algum time
  const [
    { data: ownedTeams },
    { data: adminMemberships },
  ] = await Promise.all([
    supabase
      .from('teams')
      .select('id')
      .eq('owner_id', userId),
    supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'active'),
  ])
  
  const isOwnerOrAdmin = (ownedTeams?.length ?? 0) > 0 || (adminMemberships?.length ?? 0) > 0
  
  // Busca team_id e email do usuário
  const [
    { data: teamMemberships },
    { data: authUser },
  ] = await Promise.all([
    supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1),
    supabase.auth.admin.getUserById(userId),
  ])
  
  const myTeamId = teamMemberships?.[0]?.team_id
  const myEmail = authUser.user?.email
  
  // Owner/Admin: vê tudo do time
  if (isOwnerOrAdmin && myTeamId) {
    return supabase
      .from('meetings')
      .select('*')
      .or(`user_id.in.(${memberIds.join(',')}),team_id.eq.${myTeamId}`)
  }
  
  // Membro comum: vê apenas onde participa
  if (myTeamId && myEmail) {
    return supabase
      .from('meetings')
      .select('*')
      .eq('team_id', myTeamId)
      .or(`user_id.eq.${userId},participant_emails.cs.{"${myEmail}"}`)
  }
  
  // Sem team, só busca por user_id
  return supabase
    .from('meetings')
    .select('*')
    .in('user_id', memberIds)
}

// ============================================================
// meetingAccess.ts — Funções auxiliares para acesso a reuniões
// ============================================================

import { supabase } from '../config/supabase.js'

interface AccessContext {
  isAdmin: boolean
  teamId: string | null
  email: string | null
  userId: string
  memberIds: string[]
}

/**
 * Busca contexto de acesso do usuário para construir queries de reuniões.
 */
export async function getAccessContext(userId: string, memberIds: string[]): Promise<AccessContext> {
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
  
  const isAdmin = (ownedTeams?.length ?? 0) > 0 || (adminMemberships?.length ?? 0) > 0
  
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
  
  return {
    isAdmin,
    teamId: teamMemberships?.[0]?.team_id ?? null,
    email: authUser.user?.email ?? null,
    userId,
    memberIds
  }
}

/**
 * Aplica filtros de acesso a uma query de reuniões baseado no contexto.
 */
export function applyAccessFilters(query: any, context: AccessContext) {
  const { isAdmin, teamId, email, userId, memberIds } = context
  
  // Owner/Admin: vê tudo do time
  if (isAdmin && teamId) {
    return query.or(`user_id.in.(${memberIds.join(',')}),team_id.eq.${teamId}`)
  }
  
  // Membro comum: vê apenas onde participa
  if (teamId && email) {
    return query
      .eq('team_id', teamId)
      .or(`user_id.eq.${userId},participant_emails.cs.{"${email}"}`)
  }
  
  // Sem team, só busca por user_id
  return query.in('user_id', memberIds)
}

// ============================================================
// meetingAccess.ts — Funções auxiliares para acesso a reuniões
// ============================================================

import { supabase } from '../config/supabase.js'

const DEV_USER_EMAIL = 'pietrogoncalvesmedeiros@gmail.com'

interface AccessContext {
  isAdmin: boolean
  teamId: string | null
  email: string | null
  userId: string
  memberIds: string[]
  isDevUser: boolean
}

/**
 * Busca contexto de acesso do usuário para construir queries de reuniões.
 */
export async function getAccessContext(userId: string, memberIds: string[]): Promise<AccessContext> {
  // Busca informações do usuário primeiro para verificar se é dev
  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  const email = authUser.user?.email ?? null
  const isDevUser = email?.toLowerCase().trim() === DEV_USER_EMAIL.toLowerCase()
  
  console.log(`[Access] 🔍 Verificando acesso - Email: "${email}" | UserId: ${userId} | IsDevUser: ${isDevUser}`)
  
  // 🔧 DEV USER: Acesso total a tudo
  if (isDevUser) {
    console.log(`[Access] 🔧 DEV USER detectado: ${email} - Acesso total liberado`)
    return {
      isAdmin: true,
      teamId: null,
      email,
      userId,
      memberIds,
      isDevUser: true
    }
  }
  
  console.log(`[Access] 👤 Usuário normal: ${email}`)
  
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
  
  // Busca team_id do usuário
  const { data: teamMemberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
  
  return {
    isAdmin,
    teamId: teamMemberships?.[0]?.team_id ?? null,
    email,
    userId,
    memberIds,
    isDevUser: false
  }
}

/**
 * Aplica filtros de acesso a uma query de reuniões baseado no contexto.
 */
export function applyAccessFilters(query: any, context: AccessContext) {
  const { isAdmin, teamId, email, userId, memberIds, isDevUser } = context
  
  // 🔧 DEV USER: Sem filtros - acesso total
  if (isDevUser) {
    console.log('[Access] 🔧 DEV USER: Retornando todas as reuniões sem filtros')
    return query
  }
  
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

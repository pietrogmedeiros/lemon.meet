import { supabase } from '../config/supabase.js'

/**
 * Retorna os user_ids acessíveis pelo usuário:
 * - Se for owner ou admin de um time → retorna todos os membros ativos do time
 * - Caso contrário → retorna apenas o próprio userId
 */
export async function getAccessibleMemberIds(userId: string): Promise<string[]> {
  // Busca todos os times onde o usuário é owner
  const { data: ownedTeams } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)

  // Busca todos os times onde o usuário é admin membro
  const { data: adminMemberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .eq('status', 'active')
    .not('team_id', 'is', null)

  const teamIds = [...new Set([
    ...(ownedTeams ?? []).map(team => team.id),
    ...(adminMemberships ?? []).map(membership => membership.team_id),
  ].filter(Boolean))] as string[]

  if (!teamIds.length) return [userId]

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds)
    .eq('status', 'active')
    .not('user_id', 'is', null)

  const memberIds = (members ?? []).map(m => m.user_id).filter(Boolean) as string[]
  if (!memberIds.includes(userId)) memberIds.push(userId)
  return memberIds.length > 0 ? memberIds : [userId]
}

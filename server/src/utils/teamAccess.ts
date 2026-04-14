import { supabase } from '../config/supabase.js'

/**
 * Retorna os user_ids acessíveis pelo usuário:
 * - Se for owner ou admin de um time → retorna todos os membros ativos do time
 * - Caso contrário → retorna apenas o próprio userId
 */
export async function getAccessibleMemberIds(userId: string): Promise<string[]> {
  // Verifica se é owner de algum time
  const { data: ownedTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle()

  let teamId: string | null = ownedTeam?.id ?? null

  // Se não é owner, verifica se é admin membro de algum time
  if (!teamId) {
    const { data: adminMembership } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('status', 'active')
      .maybeSingle()
    teamId = adminMembership?.team_id ?? null
  }

  if (!teamId) return [userId]

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .not('user_id', 'is', null)

  const memberIds = (members ?? []).map(m => m.user_id).filter(Boolean) as string[]
  if (!memberIds.includes(userId)) memberIds.push(userId)
  return memberIds.length > 0 ? memberIds : [userId]
}

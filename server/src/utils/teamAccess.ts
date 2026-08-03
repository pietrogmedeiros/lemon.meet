import { supabase } from '../config/supabase.js'

// Emails com acesso de super-admin/dev — bypassam todas as checagens de
// ownership/membership pra facilitar debug em produção.
const DEV_USER_EMAILS = new Set(['pietrogoncalvesmedeiros@gmail.com'])

/** Regra pura: o email é de super-admin/dev? Sem I/O. */
export function isDevEmail(email?: string | null): boolean {
  const normalized = email?.toLowerCase().trim()
  return !!normalized && DEV_USER_EMAILS.has(normalized)
}

/**
 * Checa se o userId é um super-admin/dev pelo email.
 * Centraliza a regra pra ser usada em todos os endpoints.
 *
 * ⚠️ PERF: o `authMiddleware` já resolve o email em TODA request (req.user.email).
 * Passe-o aqui — a checagem vira comparação em memória e economiza uma ida ao
 * Supabase (~110ms medidos) por request. A busca por userId só existe pra
 * callers que genuinamente não têm o email em mãos, e é cacheada por 60s.
 */
export async function isDevUser(userId: string, email?: string | null): Promise<boolean> {
  if (email !== undefined) return isDevEmail(email)

  const cached = devUserCache.get(userId)
  if (cached && Date.now() < cached.expiresAt) return cached.value

  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    const value = isDevEmail(data?.user?.email)
    devUserCache.set(userId, { value, expiresAt: Date.now() + DEV_USER_TTL_MS })
    return value
  } catch {
    return false
  }
}

const DEV_USER_TTL_MS = 60_000
const devUserCache = new Map<string, { value: boolean; expiresAt: number }>()

// Lista de TODOS os user ids (só usada no bypass de dev). Era um
// auth.admin.listUsers({perPage:1000}) por request — 151ms e 24KB medidos.
const ALL_USER_IDS_TTL_MS = 60_000
let allUserIdsCache: { ids: string[]; expiresAt: number } | null = null

async function getAllUserIds(): Promise<string[]> {
  if (allUserIdsCache && Date.now() < allUserIdsCache.expiresAt) return allUserIdsCache.ids

  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const ids = (data?.users ?? []).map(u => u.id)
  // Só cacheia resultado útil — lista vazia costuma ser falha transitória.
  if (ids.length > 0) allUserIdsCache = { ids, expiresAt: Date.now() + ALL_USER_IDS_TTL_MS }
  return ids
}

export interface UserTeamScope {
  ownedTeamIds: string[]
  memberTeamIds: string[]
  activeOwnerTeamId: string | null
}

async function getUserTeamScope(userId: string): Promise<UserTeamScope> {
  const [
    { data: ownedTeams },
    { data: memberships },
    { data: userProfile },
  ] = await Promise.all([
    supabase
      .from('teams')
      .select('id')
      .eq('owner_id', userId),
    supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('team_id', 'is', null),
    supabase.auth.admin.getUserById(userId),
  ])

  const ownedTeamIds = (ownedTeams ?? []).map(team => team.id)
  const ownedTeamIdSet = new Set(ownedTeamIds)
  const memberTeamIds = [...new Set(
    (memberships ?? [])
      .map(membership => membership.team_id)
      .filter((teamId): teamId is string => Boolean(teamId) && !ownedTeamIdSet.has(teamId))
  )]

  const rawActiveOwnerTeamId = userProfile.user?.user_metadata?.active_owner_team_id
  const activeOwnerTeamId = typeof rawActiveOwnerTeamId === 'string' && ownedTeamIdSet.has(rawActiveOwnerTeamId)
    ? rawActiveOwnerTeamId
    : null

  return {
    ownedTeamIds,
    memberTeamIds,
    activeOwnerTeamId,
  }
}

export async function getPreferredOwnerTeamId(userId: string): Promise<string | null> {
  const scope = await getUserTeamScope(userId)

  if (scope.activeOwnerTeamId) return scope.activeOwnerTeamId
  return scope.ownedTeamIds[0] ?? null
}

export async function resolveMeetingTeamId(userId: string, explicitTeamId?: string | null): Promise<string | null> {
  const scope = await getUserTeamScope(userId)
  const allowedTeamIds = new Set([...scope.ownedTeamIds, ...scope.memberTeamIds])

  if (explicitTeamId) {
    return allowedTeamIds.has(explicitTeamId) ? explicitTeamId : null
  }

  if (scope.ownedTeamIds.length === 1) {
    return scope.ownedTeamIds[0]
  }

  if (scope.activeOwnerTeamId) {
    return scope.activeOwnerTeamId
  }

  if (scope.ownedTeamIds.length > 0) {
    return scope.ownedTeamIds[0]
  }

  if (scope.memberTeamIds.length > 0) {
    return scope.memberTeamIds[0]
  }

  return null
}

export async function canCreateOwnedTeam(userId: string): Promise<{ ok: boolean; message?: string }> {
  const scope = await getUserTeamScope(userId)

  if (scope.memberTeamIds.length > 0) {
    return {
      ok: false,
      message: 'Usuário já participa de outro time e não pode criar um novo time próprio.',
    }
  }

  return { ok: true }
}

export async function canJoinTeamAsMember(userId: string, targetTeamId: string): Promise<{ ok: boolean; message?: string }> {
  const scope = await getUserTeamScope(userId)

  if (scope.ownedTeamIds.length > 0 && !scope.ownedTeamIds.includes(targetTeamId)) {
    return {
      ok: false,
      message: 'Usuário já participa de outro time como owner.',
    }
  }

  const otherMemberTeamIds = scope.memberTeamIds.filter(teamId => teamId !== targetTeamId)
  if (otherMemberTeamIds.length > 0) {
    return {
      ok: false,
      message: 'Usuário já participa de outro time.',
    }
  }

  return { ok: true }
}

/**
 * Retorna os user_ids acessíveis pelo usuário:
 * - Dev user → retorna TODOS os usuários (acesso total p/ debug)
 * - Owner ou admin de um time → retorna todos os membros ativos do time
 * - Caso contrário → retorna apenas o próprio userId
 */
export async function getAccessibleMemberIds(userId: string, email?: string | null): Promise<string[]> {
  // Dev/super-admin bypass: enxerga reuniões de todos os usuários
  if (await isDevUser(userId, email)) {
    const allIds = await getAllUserIds()
    if (allIds.length > 0) return allIds
    // Fallback se algo deu errado na listagem
    return [userId]
  }

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
      .eq('status', 'active')
      .not('team_id', 'is', null),
  ])

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

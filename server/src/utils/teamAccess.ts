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

// ── Papéis elevados ──────────────────────────────────────────────────────────
// 'owner' é o CO-DONO: tem os mesmos poderes de quem está em `teams.owner_id`
// (editar o time, convidar, promover admin) sem ser o dono da linha. Existe
// porque `teams.owner_id` é uma coluna única e o Hesley precisa mandar no time
// da Starbem igual ao Pietro. Quem lê papel para decidir visão do time inteiro
// tem que aceitar os DOIS — senão promover alguém a co-dono o REBAIXA.
export const PAPEIS_ELEVADOS = ['admin', 'owner'] as const

/** Regra pura: este usuário manda no time? Sem I/O, para poder testar. */
export function donoPeloPapel(
  ownerId: string | null | undefined,
  userId: string,
  papelDoMembro?: string | null,
): boolean {
  if (ownerId && ownerId === userId) return true
  return papelDoMembro === 'owner'
}

/**
 * Segundo caminho do co-dono: `user_metadata.co_owner_team_ids`.
 *
 * ⚠️ POR QUE EXISTE: `team_members.role` tem CHECK constraint no banco e
 * RECUSA 'owner' (conferido em 10/11/2026: "team_members_role_check"). Mudar a
 * constraint é DDL, que a service role não aplica pela API REST. O metadata do
 * Auth é gravável agora, já é usado para `active_owner_team_id`, e não exige
 * nenhuma janela de migração. Se a constraint for ampliada depois, o caminho
 * pelo papel continua valendo — os dois convivem.
 */
export function ehCoDonoPorMetadata(metadata: unknown, teamId: string): boolean {
  const lista = (metadata as { co_owner_team_ids?: unknown } | null | undefined)?.co_owner_team_ids
  return Array.isArray(lista) && lista.includes(teamId)
}

/** Times em que este usuário é co-dono, pelo metadata do Auth. */
export async function timesCoDono(userId: string): Promise<string[]> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    const lista = (data?.user?.user_metadata as { co_owner_team_ids?: unknown } | undefined)?.co_owner_team_ids
    return Array.isArray(lista) ? lista.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Dono do time: a linha `teams.owner_id`, membro ativo com papel 'owner' ou
 * co-dono no metadata. Use nas rotas que antes faziam `.eq('owner_id', userId)`.
 */
export async function ehDonoDoTime(userId: string, teamId: string): Promise<boolean> {
  const [{ data: team }, { data: membership }, coDono] = await Promise.all([
    supabase.from('teams').select('owner_id').eq('id', teamId).maybeSingle(),
    supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
    timesCoDono(userId),
  ])
  if (!team) return false
  if (donoPeloPapel(team.owner_id, userId, membership?.role)) return true
  // Co-dono pelo metadata só vale se ele é membro ATIVO do time.
  return !!membership && coDono.includes(teamId)
}

// ── Contas privadas ──────────────────────────────────────────────────────────
// Reuniões destas contas NUNCA aparecem para mais ninguém — nem para admin,
// nem para co-dono, nem para o dono do time. É a conta pessoal do Pietro, que
// é membro do time da Starbem só para operar o produto; as calls dele não são
// do cliente. O dono da conta continua vendo as próprias.
const EMAILS_PRIVADOS = new Set(['pietrogoncalvesmedeiros@gmail.com'])

/** Regra pura: as reuniões deste e-mail ficam fora da visão de time? */
export function ehEmailPrivado(email?: string | null): boolean {
  const normalized = email?.toLowerCase().trim()
  return !!normalized && EMAILS_PRIVADOS.has(normalized)
}

/** Regra pura: tira as contas privadas da lista, menos a de quem pediu. */
export function removerContasPrivadas(
  ids: string[],
  idsPrivados: string[],
  solicitante: string,
): string[] {
  const esconder = new Set(idsPrivados.filter(id => id !== solicitante))
  if (esconder.size === 0) return ids
  return ids.filter(id => !esconder.has(id))
}

const IDS_PRIVADOS_TTL_MS = 10 * 60_000
let idsPrivadosCache: { ids: string[]; expiresAt: number } | null = null

/** Resolve e-mail → user id das contas privadas (cacheado por 10 min). */
export async function idsDeContasPrivadas(): Promise<string[]> {
  if (idsPrivadosCache && Date.now() < idsPrivadosCache.expiresAt) return idsPrivadosCache.ids

  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const ids = (data?.users ?? []).filter(u => ehEmailPrivado(u.email)).map(u => u.id)
  // Lista vazia costuma ser falha transitória do Auth: não cacheia, e nesse
  // caso é melhor ESCONDER nada do que cachear "não tem conta privada".
  if (ids.length > 0) idsPrivadosCache = { ids, expiresAt: Date.now() + IDS_PRIVADOS_TTL_MS }
  return ids
}

/** Tira as contas privadas de uma lista de member ids (atalho com I/O). */
export async function filtrarContasPrivadas(ids: string[], solicitante: string): Promise<string[]> {
  if (ids.length === 0) return ids
  return removerContasPrivadas(ids, await idsDeContasPrivadas(), solicitante)
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
    if (allIds.length > 0) return filtrarContasPrivadas(allIds, userId)
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
      .in('role', [...PAPEIS_ELEVADOS])
      .eq('status', 'active')
      .not('team_id', 'is', null),
  ])

  const teamIds = [...new Set([
    ...(ownedTeams ?? []).map(team => team.id),
    ...(adminMemberships ?? []).map(membership => membership.team_id),
  ].filter(Boolean))] as string[]

  if (!teamIds.length) return [userId]
  // A partir daqui a lista passa a conter reuniões DE OUTRAS PESSOAS, então as
  // contas privadas saem fora.

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds)
    .eq('status', 'active')
    .not('user_id', 'is', null)

  const visiveis = await filtrarContasPrivadas(
    (members ?? []).map(m => m.user_id).filter(Boolean) as string[],
    userId,
  )
  const memberIds = [...visiveis]
  if (!memberIds.includes(userId)) memberIds.push(userId)
  return memberIds.length > 0 ? memberIds : [userId]
}

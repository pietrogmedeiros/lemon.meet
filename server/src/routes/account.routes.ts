// account.routes.ts — exclusão de conta pelo próprio usuário.
//
// POR QUE EXISTE: a diretriz 5.1.1(v) da Apple exige que todo app que permite
// CRIAR conta permita EXCLUIR a conta de dentro do app — mandar para o site ou
// pedir por e-mail não satisfaz. E a LGPD dá ao titular o direito de eliminação.
// Antes disso, a política prometia exclusão "mediante pedido por e-mail", o que
// dependia de alguém abrir uma caixa de correio.
//
// ⚠️ ISTO APAGA DADO DE VERDADE, SEM VOLTA. Não há lixeira, não há job de
// desfazer. Toda mudança aqui merece o dobro de cuidado.
//
// REGRA DE TIME (decidida pelo Pietro em 2026-08-27): se o usuário é dono de um
// time, ele ESCOLHE na hora da exclusão para quem a posse vai. Time em que ele é
// o único membro é apagado junto. Nenhum time fica órfão.

import { Router, type Response } from 'express'
import type express from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

type OwnedTeam = {
  id: string
  name: string | null
  candidates: { userId: string; email: string | null; role: string | null }[]
}

/** Times de que o usuário é DONO, com quem pode herdar cada um. */
async function loadOwnedTeams(userId: string): Promise<OwnedTeam[]> {
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, name')
    .eq('owner_id', userId)

  if (error) throw new Error(`falha ao ler times do usuário: ${error.message}`)
  if (!teams?.length) return []

  const out: OwnedTeam[] = []
  for (const t of teams as { id: string; name: string | null }[]) {
    const { data: members, error: memErr } = await supabase
      .from('team_members')
      .select('user_id, invited_email, role')
      .eq('team_id', t.id)
      .eq('status', 'active')

    if (memErr) throw new Error(`falha ao ler membros do time ${t.id}: ${memErr.message}`)

    const candidates = (members ?? [])
      .filter((m: any) => m.user_id && m.user_id !== userId)
      .map((m: any) => ({ userId: m.user_id, email: m.invited_email ?? null, role: m.role ?? null }))

    out.push({ id: t.id, name: t.name, candidates })
  }
  return out
}

// ── GET /api/account/deletion-preview ─────────────────────────
// O que a tela precisa saber ANTES de perguntar "tem certeza?": quanto será
// apagado e quais times exigem escolha de novo dono.
router.get('/deletion-preview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    const countOf = async (table: string, column = 'user_id'): Promise<number> => {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq(column, userId)
      if (error) {
        logger.warn(`[account] preview: contagem de ${table} falhou: ${error.message}`)
        return -1
      }
      return count ?? 0
    }

    const [meetings, ownedTeams] = await Promise.all([
      countOf('meetings'),
      loadOwnedTeams(userId),
    ])

    return res.json({
      success: true,
      preview: {
        meetings,
        // Time sem candidato será APAGADO junto — a tela precisa dizer isso em
        // voz alta, é a consequência mais fácil de alguém não perceber.
        teamsToTransfer: ownedTeams
          .filter((t) => t.candidates.length > 0)
          .map((t) => ({ id: t.id, name: t.name, candidates: t.candidates })),
        teamsToDelete: ownedTeams
          .filter((t) => t.candidates.length === 0)
          .map((t) => ({ id: t.id, name: t.name })),
      },
    })
  } catch (err) {
    logger.error('[account] erro no preview de exclusão:', err)
    return res.status(500).json({ success: false, message: 'Erro ao montar o resumo da exclusão' })
  }
})

// ── DELETE /api/account ───────────────────────────────────────
// body: { confirm: 'EXCLUIR', transfers: { [teamId]: newOwnerUserId } }
router.delete('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const userEmail = req.user!.email ?? null

  try {
    // Confirmação explícita no corpo: impede que um DELETE disparado por engano
    // (link pré-carregado, retry de cliente, teste de rota) apague uma conta.
    if (req.body?.confirm !== 'EXCLUIR') {
      return res.status(400).json({
        success: false,
        message: 'Confirmação ausente. Envie { "confirm": "EXCLUIR" } para prosseguir.',
      })
    }

    const transfers: Record<string, string> = req.body?.transfers ?? {}
    const ownedTeams = await loadOwnedTeams(userId)

    // ── Validação ANTES de apagar qualquer coisa ──
    // Nada é destruído enquanto a escolha de posse não estiver completa e válida.
    for (const team of ownedTeams) {
      if (team.candidates.length === 0) continue // será apagado junto

      const target = transfers[team.id]
      if (!target) {
        return res.status(400).json({
          success: false,
          message: `Escolha para quem transferir o time "${team.name ?? team.id}" antes de excluir a conta.`,
          teamId: team.id,
        })
      }
      if (target === userId) {
        return res.status(400).json({
          success: false,
          message: 'O novo dono do time não pode ser você mesmo.',
          teamId: team.id,
        })
      }
      if (!team.candidates.some((c) => c.userId === target)) {
        return res.status(400).json({
          success: false,
          message: `A pessoa escolhida não é membro ativo do time "${team.name ?? team.id}".`,
          teamId: team.id,
        })
      }
    }

    logger.warn(`[account] EXCLUSÃO INICIADA — user ${userId} (${userEmail}); times próprios: ${ownedTeams.length}`)

    // ── 1. Transferir posse (antes de apagar vínculos) ──
    for (const team of ownedTeams) {
      if (team.candidates.length === 0) continue
      const newOwner = transfers[team.id]

      const { error: ownerErr } = await supabase
        .from('teams')
        .update({ owner_id: newOwner })
        .eq('id', team.id)
      if (ownerErr) throw new Error(`falha ao transferir o time ${team.id}: ${ownerErr.message}`)

      // Quem herda precisa poder administrar o que herdou.
      const { error: roleErr } = await supabase
        .from('team_members')
        .update({ role: 'admin' })
        .eq('team_id', team.id)
        .eq('user_id', newOwner)
      if (roleErr) {
        logger.warn(`[account] time ${team.id} transferido, mas promover a admin falhou: ${roleErr.message}`)
      }
      logger.warn(`[account] time ${team.id} ("${team.name}") transferido para ${newOwner}`)
    }

    // ── 2. Apagar times em que o usuário estava sozinho ──
    const soloTeams = ownedTeams.filter((t) => t.candidates.length === 0).map((t) => t.id)
    for (const teamId of soloTeams) {
      const { data: cfgs } = await supabase
        .from('team_scheduling_config').select('id').eq('team_id', teamId)
      for (const cfg of (cfgs ?? []) as { id: string }[]) {
        await supabase.from('team_bookings').delete().eq('config_id', cfg.id)
        await supabase.from('team_scheduling_members').delete().eq('config_id', cfg.id)
      }
      await supabase.from('team_scheduling_config').delete().eq('team_id', teamId)

      const { data: wcfgs } = await supabase
        .from('webinar_configs').select('id').eq('team_id', teamId)
      for (const wc of (wcfgs ?? []) as { id: string }[]) {
        await supabase.from('webinar_registrations').delete().eq('config_id', wc.id)
        await supabase.from('webinar_sessions').delete().eq('config_id', wc.id)
      }
      await supabase.from('webinar_configs').delete().eq('team_id', teamId)

      await supabase.from('team_invite_links').delete().eq('team_id', teamId)
      await supabase.from('team_members').delete().eq('team_id', teamId)
      await supabase.from('teams').delete().eq('id', teamId)
      logger.warn(`[account] time ${teamId} apagado (usuário era o único membro)`)
    }

    // ── 3. Reuniões e tudo que pende delas ──
    // Por meeting_id, não por user_id: comentário/rapport que um COLEGA criou
    // numa reunião minha também precisa sair, senão fica apontando pro vazio.
    const { data: myMeetings, error: mErr } = await supabase
      .from('meetings').select('id').eq('user_id', userId)
    if (mErr) throw new Error(`falha ao listar reuniões: ${mErr.message}`)

    const meetingIds = (myMeetings ?? []).map((m: any) => m.id)
    const CHUNK = 100
    for (let i = 0; i < meetingIds.length; i += CHUNK) {
      const batch = meetingIds.slice(i, i + CHUNK)
      for (const table of [
        'transcript_segments',
        'meeting_fup_versions',
        'meeting_action_items',
        'meeting_ai_chats',
        'meeting_rapport',
        'notifications',
      ]) {
        const { error } = await supabase.from(table).delete().in('meeting_id', batch)
        if (error) logger.warn(`[account] limpeza de ${table} falhou: ${error.message}`)
      }
    }
    await supabase.from('meetings').delete().eq('user_id', userId)
    logger.warn(`[account] ${meetingIds.length} reunião(ões) apagadas`)

    // ── 4. Agendamentos futuros atribuídos a ele ──
    // Cancelados, não apagados: são compromissos com pessoas de fora, e o time
    // que fica precisa enxergar que caíram. Os passados são histórico do time.
    const { error: bookErr } = await supabase
      .from('team_bookings')
      .update({ status: 'cancelled' })
      .eq('assigned_to_user_id', userId)
      .gte('scheduled_start', new Date().toISOString())
      .neq('status', 'cancelled')
    if (bookErr) logger.warn(`[account] cancelar agendamentos futuros falhou: ${bookErr.message}`)

    // ── 5. Dados diretamente do usuário ──
    // Tokens de integração vêm primeiro: é o dado mais sensível da lista e o
    // único que dá acesso a sistema de terceiro se sobrar.
    for (const table of [
      'calendar_integrations',
      'hubspot_integrations',
      'pipedrive_integrations',
      'user_webhooks',
      'notifications',
      'meeting_action_items',
      'meeting_ai_chats',
      'meeting_rapport',
      'feature_request_upvotes',
      'feature_request_comments',
      'feature_requests',
      'user_feedback',
      'team_scheduling_members',
      'team_members',
      'user_subscriptions',
    ]) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId)
      if (error) logger.warn(`[account] limpeza de ${table} falhou: ${error.message}`)
    }

    // Convites que ele criou — sem dono, não devem seguir válidos.
    await supabase.from('team_invite_links').delete().eq('created_by', userId)

    // ── 6. A conta em si ──
    // Por último de propósito: enquanto o login existe, uma falha no meio ainda
    // é recuperável pelo suporte. Depois disso, não é.
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId)
    if (authErr) {
      logger.error(`[account] dados apagados mas a conta de login PERMANECE — user ${userId}: ${authErr.message}`)
      return res.status(500).json({
        success: false,
        message: 'Seus dados foram removidos, mas o login não pôde ser encerrado. Fale com o suporte.',
      })
    }

    logger.warn(`[account] EXCLUSÃO CONCLUÍDA — user ${userId} (${userEmail})`)
    return res.json({ success: true, message: 'Conta e dados removidos.' })
  } catch (err) {
    logger.error(`[account] EXCLUSÃO FALHOU no meio — user ${userId}:`, err)
    return res.status(500).json({
      success: false,
      message: 'A exclusão não foi concluída. Nada mais será removido; fale com o suporte.',
    })
  }
})

export default router

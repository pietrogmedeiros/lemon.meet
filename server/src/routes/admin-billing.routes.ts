// ============================================================
// admin-billing.routes.ts — Comprovação de uso para faturamento
//
// GET /api/admin/billing?month=YYYY-MM&teamId=<uuid|all>
//
// POR QUE EXISTE: clientes como a Starbem pagam por ACESSO (assento) e só
// liberam a NF mediante comprovação de que as pessoas usaram. Isso era
// levantado na mão, a cada mês, direto no banco.
//
// Gate: authMiddleware → adminMetricsGate (só DEV_USER_EMAILS).
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'

import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { adminMetricsGate } from '../middleware/admin-metrics.middleware.js'
import { isDevEmail } from '../utils/teamAccess.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

/** Fuso do negócio. O mês de cobrança é o mês de Brasília, não o UTC. */
const OFFSET_BRT_MS = 3 * 60 * 60 * 1000

/**
 * Limites do mês em UTC a partir de "YYYY-MM" em horário de Brasília.
 * ⚠️ Sem isso, uma reunião das 22h do dia 30 (01h UTC do dia 1º) cairia no mês
 * seguinte e a fatura fecharia errada.
 */
export function janelaDoMes(mes: string): { inicio: string; fim: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const ano = Number(m[1])
  const mesNum = Number(m[2])
  if (mesNum < 1 || mesNum > 12) return null
  const inicioBrt = Date.UTC(ano, mesNum - 1, 1, 0, 0, 0)
  const fimBrt = Date.UTC(mesNum === 12 ? ano + 1 : ano, mesNum === 12 ? 0 : mesNum, 1, 0, 0, 0)
  return {
    inicio: new Date(inicioBrt + OFFSET_BRT_MS).toISOString(),
    fim: new Date(fimBrt + OFFSET_BRT_MS).toISOString(),
  }
}

/**
 * Duração em minutos de uma reunião.
 * ⚠️ `duration_seconds` está NULO em 100% das linhas (conferido: 0 de 166 em
 * setembro/2026). A única fonte real é `ended_at - started_at`, e mesmo ela só
 * existe em ~57% dos casos. Por isso o relatório mostra minutos como
 * informação COMPLEMENTAR e nunca como base de cobrança.
 */
export function minutosDaReuniao(started: string | null, ended: string | null): number | null {
  if (!started || !ended) return null
  const ms = new Date(ended).getTime() - new Date(started).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.round(ms / 60000)
}

type LinhaUsuario = {
  userId: string
  email: string
  nome: string
  reunioes: number
  gravadas: number
  minutos: number
  minutosIncompletos: boolean
  primeira: string | null
  ultima: string | null
  /** Conta nossa (super-admin) dentro do time do cliente. Não entra na fatura:
   *  o Pietro é admin do time da Starbem e o uso dele apareceria como acesso
   *  faturável — cobrar o cliente pelo nosso próprio uso. */
  interno: boolean
}

router.get('/billing', authMiddleware, adminMetricsGate, async (req: AuthRequest, res: Response) => {
  try {
    const mes = String(req.query.month ?? '')
    const janela = janelaDoMes(mes)
    if (!janela) {
      res.status(400).json({ error: 'month_invalido', detalhe: 'Use o formato YYYY-MM.' })
      return
    }
    const teamId = String(req.query.teamId ?? 'all')

    const { data: times, error: errTimes } = await supabase
      .from('teams')
      .select('id, name')
      .order('name')
    if (errTimes) throw new Error(`falha ao listar times: ${errTimes.message}`)

    let consulta = supabase
      .from('meetings')
      .select('id, user_id, team_id, status, started_at, ended_at, skribby_bot_id')
      .gte('started_at', janela.inicio)
      .lt('started_at', janela.fim)
    if (teamId !== 'all') consulta = consulta.eq('team_id', teamId)

    const { data: reunioes, error } = await consulta
    if (error) throw new Error(`falha ao ler reuniões: ${error.message}`)

    // ⚠️ Reunião de time vira UMA LINHA POR MEMBRO com o mesmo skribby_bot_id
    // (fan-out). Para COBRANÇA isso é o certo — cada pessoa usou o produto —,
    // mas o total de reuniões distintas precisa ser contado à parte, senão a
    // fatura parece inflada para quem confere.
    const botsDistintos = new Set<string>()

    const porUsuario = new Map<string, LinhaUsuario>()
    for (const r of reunioes ?? []) {
      if (r.skribby_bot_id) botsDistintos.add(r.skribby_bot_id)
      const uid = r.user_id
      if (!uid) continue
      let linha = porUsuario.get(uid)
      if (!linha) {
        linha = {
          userId: uid, email: '', nome: '',
          reunioes: 0, gravadas: 0, minutos: 0, minutosIncompletos: false,
          primeira: null, ultima: null, interno: false,
        }
        porUsuario.set(uid, linha)
      }
      linha.reunioes++
      if (r.status === 'completed') linha.gravadas++
      const min = minutosDaReuniao(r.started_at, r.ended_at)
      if (min === null) linha.minutosIncompletos = true
      else linha.minutos += min
      const ini = r.started_at
      if (ini) {
        if (!linha.primeira || ini < linha.primeira) linha.primeira = ini
        if (!linha.ultima || ini > linha.ultima) linha.ultima = ini
      }
    }

    // Emails: uma chamada só, não uma por usuário.
    const { data: contas } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const mapa = new Map(
      (contas?.users ?? []).map((u) => [
        u.id,
        {
          email: u.email ?? '(sem e-mail)',
          nome: (u.user_metadata?.full_name as string) || (u.user_metadata?.name as string) || '',
        },
      ]),
    )
    for (const linha of porUsuario.values()) {
      const c = mapa.get(linha.userId)
      linha.email = c?.email ?? '(conta removida)'
      linha.nome = c?.nome || linha.email.split('@')[0]
      linha.interno = isDevEmail(linha.email)
    }

    const usuarios = [...porUsuario.values()].sort((a, b) => b.gravadas - a.gravadas || b.reunioes - a.reunioes)

    // ⚠️ ALERTA DE SUBFATURAMENTO — descoberto em 14/09/2026 ao conferir setembro.
    // O Kledson tinha 31 reuniões no mês, e-mail @starbem.app, `team_id` NULO e
    // nenhuma associação em `team_members`. Filtrando por time ele simplesmente
    // sumia da conta. Uma fatura a menos é pior que uma a mais: o cliente não
    // reclama, e a receita evapora em silêncio.
    //
    // Então: quando há filtro de time, procuramos gente COM atividade no mês,
    // FORA do filtro, cujo domínio de e-mail aparece DENTRO dele. É exatamente
    // o caso do Kledson.
    let alertas: { email: string; reunioes: number; gravadas: number; motivo: string }[] = []
    if (teamId !== 'all' && usuarios.length > 0) {
      const dominiosDoTime = new Set(
        usuarios.map((u) => u.email.split('@')[1]).filter((d): d is string => !!d && !d.includes('gmail')),
      )
      if (dominiosDoTime.size > 0) {
        const { data: todas } = await supabase
          .from('meetings')
          .select('user_id, status')
          .gte('started_at', janela.inicio)
          .lt('started_at', janela.fim)
        const dentro = new Set(usuarios.map((u) => u.userId))
        const fora = new Map<string, { reunioes: number; gravadas: number }>()
        for (const r of todas ?? []) {
          if (!r.user_id || dentro.has(r.user_id)) continue
          const at = fora.get(r.user_id) ?? { reunioes: 0, gravadas: 0 }
          at.reunioes++
          if (r.status === 'completed') at.gravadas++
          fora.set(r.user_id, at)
        }
        for (const [uid, at] of fora) {
          const conta = mapa.get(uid)
          const dom = conta?.email.split('@')[1]
          if (dom && dominiosDoTime.has(dom)) {
            alertas.push({
              email: conta!.email,
              reunioes: at.reunioes,
              gravadas: at.gravadas,
              motivo: 'mesmo domínio do time, mas fora do filtro (sem team_id ou em outro time)',
            })
          }
        }
        alertas.sort((a, b) => b.gravadas - a.gravadas)
      }
    }

    res.json({
      month: mes,
      teamId,
      teams: times ?? [],
      usuarios,
      alertas,
      totais: {
        // A base de cobrança: quem de fato teve reunião GRAVADA no mês.
        acessosFaturaveis: usuarios.filter((u) => u.gravadas > 0 && !u.interno).length,
        usuariosComAtividade: usuarios.length,
        reunioes: (reunioes ?? []).length,
        reunioesDistintas: botsDistintos.size || (reunioes ?? []).length,
        gravadas: usuarios.reduce((n, u) => n + u.gravadas, 0),
        minutos: usuarios.reduce((n, u) => n + u.minutos, 0),
      },
    })
  } catch (err: any) {
    logger.error('[AdminBilling] erro:', err)
    res.status(500).json({ error: 'billing_failed', detalhe: String(err?.message ?? err).slice(0, 200) })
  }
})

export default router

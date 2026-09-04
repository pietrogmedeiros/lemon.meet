// DailyDigestService.ts — envia o resumo do dia anterior às 07:47 (São Paulo).
//
// Regras de atenção, deliberadas:
//  - só recebe quem TEVE reunião no dia anterior. Dia vazio não gera e-mail;
//    resumo que chega sempre vira ruído e acaba filtrado.
//  - só assinatura ativa, mesma regra do cron de bots.
//  - um envio por dia por processo. Se o contêiner reiniciar depois do horário,
//    o dia já enviado não repete.
//
// Config (EasyPanel → Environment):
//   RESEND_API_KEY      chave da conta Resend
//   DIGEST_EMAIL_FROM   remetente; padrão "Lemon.meet <contato@lemon-meet.com>"
//   APP_URL             base dos links; padrão https://lemon-meet.web.app
//   DISABLE_DAILY_DIGEST=true desliga sem deploy

import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { buildDigest } from './dailyDigest.js'

const FUSO = 'America/Sao_Paulo'
const HORA = 7
const MINUTO = 47
const CHECK_MS = 60 * 1000

/** "2026-09-04" e "04/09" no fuso do usuário, sem depender do fuso do contêiner. */
function partesData(d: Date): { iso: string; label: string; hora: number; minuto: number } {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    label: `${p.day}/${p.month}`,
    hora: Number(p.hour),
    minuto: Number(p.minute),
  }
}

/** Início e fim do dia ANTERIOR, em UTC, para o fuso de São Paulo (UTC-3). */
export function janelaDiaAnterior(agora: Date): { ini: string; fim: string; label: string } {
  const hoje = partesData(agora)
  const [ano, mes, dia] = hoje.iso.split('-').map(Number)
  const inicioHojeUtc = Date.UTC(ano, mes - 1, dia, 3, 0, 0) // 00:00 -03 = 03:00 UTC
  const ini = new Date(inicioHojeUtc - 24 * 3600 * 1000)
  const fim = new Date(inicioHojeUtc)
  return { ini: ini.toISOString(), fim: fim.toISOString(), label: partesData(ini).label }
}

export class DailyDigestService {
  private timer: ReturnType<typeof setInterval> | null = null
  private ultimoEnvio: string | null = null

  start(): void {
    if (this.timer) return
    logger.info(`[DailyDigest] agendado para ${HORA}:${String(MINUTO).padStart(2, '0')} (${FUSO})`)
    this.timer = setInterval(() => {
      const agora = new Date()
      const { iso, hora, minuto } = partesData(agora)
      if (hora !== HORA || minuto !== MINUTO || this.ultimoEnvio === iso) return
      this.ultimoEnvio = iso
      this.enviarParaTodos(agora).catch((err) =>
        logger.error('[DailyDigest] falha no ciclo:', err),
      )
    }, CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Exposto para teste manual e para um eventual endpoint administrativo. */
  async enviarParaTodos(agora = new Date()): Promise<{ enviados: number; pulados: number }> {
    const { ini, fim, label } = janelaDiaAnterior(agora)
    logger.info(`[DailyDigest] montando resumo de ${label} (${ini} → ${fim})`)

    const { data: assinaturas } = await supabase
      .from('user_subscriptions')
      .select('user_id')
      .eq('status', 'active')

    let enviados = 0
    let pulados = 0
    for (const { user_id } of assinaturas ?? []) {
      try {
        const ok = await this.enviarParaUsuario(user_id, ini, fim, label)
        ok ? enviados++ : pulados++
      } catch (err) {
        pulados++
        logger.error(`[DailyDigest] erro para user ${user_id}:`, err)
      }
    }
    logger.info(`[DailyDigest] ${enviados} enviado(s), ${pulados} sem envio`)
    return { enviados, pulados }
  }

  private async enviarParaUsuario(
    userId: string,
    ini: string,
    fim: string,
    label: string,
  ): Promise<boolean> {
    const { data: meetings } = await supabase
      .from('meetings')
      .select('id,title,started_at,status,failure_reason,insights')
      .eq('user_id', userId)
      .gte('created_at', ini)
      .lt('created_at', fim)
      .order('started_at', { ascending: true })

    if (!meetings || meetings.length === 0) return false

    const ids = meetings.map((m) => m.id)
    const { data: itens } = await supabase
      .from('meeting_action_items')
      .select('text,meeting_id')
      .in('meeting_id', ids)
      .eq('status', 'pending')

    const titulos = new Map(meetings.map((m) => [m.id, m.title]))
    const { data: userData } = await supabase.auth.admin.getUserById(userId)
    const email = userData.user?.email
    if (!email) return false

    const nome =
      (userData.user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ??
      email.split('@')[0]

    const digest = buildDigest({
      nome,
      meetings: meetings as any,
      actionItems: (itens ?? []).map((i: any) => ({
        text: i.text,
        meetingTitle: titulos.get(i.meeting_id) ?? null,
      })),
      appUrl: process.env.APP_URL || 'https://lemon-meet.web.app',
      dataLabel: label,
    })
    if (!digest) return false

    return this.enviar(email, digest.subject, digest.html, digest.text)
  }

  private async enviar(to: string, subject: string, html: string, text: string): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      logger.warn('[DailyDigest] RESEND_API_KEY ausente — resumo NÃO enviado')
      return false
    }
    const from = process.env.DIGEST_EMAIL_FROM || 'Lemon.meet <contato@lemon-meet.com>'
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    })
    if (!res.ok) {
      // O motivo importa: domínio não verificado e chave inválida são consertos
      // diferentes, e um e-mail que não chega é indistinguível de dia sem reunião.
      logger.error(`[DailyDigest] Resend recusou (${res.status}): ${(await res.text()).slice(0, 200)}`)
      return false
    }
    logger.info(`[DailyDigest] enviado para ${to}: ${subject}`)
    return true
  }
}

export const dailyDigestService = new DailyDigestService()

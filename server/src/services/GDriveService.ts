// ============================================================
// GDriveService.ts — Salva insights de reuniões no Google Drive
//
// Cria (ou reutiliza) uma pasta chamada "Lemon.meet-insights"
// e faz upload de um arquivo .txt por reunião.
// ============================================================

import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_NAME      = 'Lemon.meet-insights'

class GDriveService {
  // ── Token helpers ────────────────────────────────────────────

  async getValidToken(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from('gdrive_integrations')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data) return null

    const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0
    if (Date.now() < expiresAt - 60_000) return data.access_token

    // Precisa renovar
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     process.env.GOOGLE_CALENDAR_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        refresh_token: data.refresh_token,
      }),
    })

    if (!res.ok) {
      logger.warn(`[GDrive] Falha ao renovar token para user ${userId}`)
      return null
    }

    const tokens = await res.json() as any
    const newExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

    await supabase.from('gdrive_integrations').update({
      access_token:     tokens.access_token,
      token_expires_at: newExpiresAt,
    }).eq('user_id', userId)

    return tokens.access_token
  }

  // ── Pasta ────────────────────────────────────────────────────

  private async getOrCreateFolder(token: string, userId: string): Promise<string> {
    // Usa cache do banco
    const { data: cached } = await supabase
      .from('gdrive_integrations')
      .select('folder_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (cached?.folder_id) return cached.folder_id

    // Busca pasta existente no Drive
    const query = encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )
    const searchRes = await fetch(`${DRIVE_FILES_URL}?q=${query}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const searchData = await searchRes.json() as any

    if (searchData.files?.length > 0) {
      const folderId = searchData.files[0].id as string
      await supabase.from('gdrive_integrations').update({ folder_id: folderId }).eq('user_id', userId)
      return folderId
    }

    // Cria pasta nova
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })
    const folder = await createRes.json() as any
    await supabase.from('gdrive_integrations').update({ folder_id: folder.id }).eq('user_id', userId)
    logger.info(`[GDrive] Pasta "${FOLDER_NAME}" criada: ${folder.id}`)
    return folder.id as string
  }

  // ── Upload de insight ─────────────────────────────────────────

  async saveInsightsToFolder(userId: string, meeting: any, insights: any): Promise<void> {
    try {
      const token = await this.getValidToken(userId)
      if (!token) return

      const folderId = await this.getOrCreateFolder(token, userId)

      const dateStr = meeting.started_at
        ? new Date(meeting.started_at).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
          })
        : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

      const title    = meeting.title ?? 'Reunião sem título'
      const fileName = `${title} - ${dateStr}.txt`

      const sentimentMap: Record<string, string> = {
        positive: '😊 Positivo',
        negative: '😟 Negativo',
        neutral:  '😐 Neutro',
      }

      const bantLines = insights.bantScore
        ? [
            '─────────────────────────────────────────',
            'SCORECARD BANT',
            '─────────────────────────────────────────',
            `Budget:    ${insights.bantScore.budget?.score ?? 0}/10 — ${insights.bantScore.budget?.evidence ?? ''}`,
            `Authority: ${insights.bantScore.authority?.score ?? 0}/10 — ${insights.bantScore.authority?.evidence ?? ''}`,
            `Need:      ${insights.bantScore.need?.score ?? 0}/10 — ${insights.bantScore.need?.evidence ?? ''}`,
            `Timeline:  ${insights.bantScore.timeline?.score ?? 0}/10 — ${insights.bantScore.timeline?.evidence ?? ''}`,
            '',
          ]
        : []

      const actionLines = (insights.actionItems ?? []).map((a: string, i: number) => `${i + 1}. ${a}`)

      const content = [
        `REUNIÃO: ${title}`,
        `Data: ${dateStr}`,
        `Plataforma: ${(meeting.platform ?? '').replace('_', ' ')}`,
        `Duração: ${meeting.duration_seconds ? Math.floor(meeting.duration_seconds / 60) + ' min' : 'N/A'}`,
        '',
        '─────────────────────────────────────────',
        'SCORE COMERCIAL',
        '─────────────────────────────────────────',
        `Score: ${insights.commercialQuality ?? '–'}/10`,
        `Sentimento: ${sentimentMap[insights.sentiment] ?? insights.sentiment ?? '–'}`,
        `Probabilidade de fechamento: ${insights.closingProbability ?? '–'}%`,
        '',
        '─────────────────────────────────────────',
        'CONTEXTO EXECUTIVO',
        '─────────────────────────────────────────',
        insights.executiveContext ?? '',
        '',
        ...bantLines,
        '─────────────────────────────────────────',
        'PRÓXIMOS PASSOS',
        '─────────────────────────────────────────',
        ...actionLines,
        '',
        '─────────────────────────────────────────',
        'TÓPICOS-CHAVE',
        '─────────────────────────────────────────',
        (insights.keyTopics ?? []).join(', '),
        '',
        '─────────────────────────────────────────',
        `Gerado por Lemon.meet em ${new Date().toLocaleString('pt-BR')}`,
      ].join('\n')

      // Multipart upload (metadata + conteúdo em uma única requisição)
      const boundary = 'lemondriveboundary314159'
      const metadata = JSON.stringify({ name: fileName, parents: [folderId] })

      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadata,
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        content,
        `--${boundary}--`,
      ].join('\r\n')

      const uploadRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.json()
        logger.error(`[GDrive] Erro no upload: ${JSON.stringify(err)}`)
        return
      }

      const fileData = await uploadRes.json() as any
      logger.info(`[GDrive] ✅ Insight salvo: ${fileData.id} (${fileName}) para user ${userId}`)
    } catch (err) {
      logger.error(`[GDrive] Erro ao salvar insights no Drive para user ${userId}:`, err)
      // Non-critical — nunca propagar para não quebrar o fluxo de insights
    }
  }
}

export const gdriveService = new GDriveService()

// ============================================================
// NotificationService.ts — Serviço de notificações do sistema
// ============================================================

import { supabase } from '../config/supabase.js'
import { getIO, emitToUser } from '../config/socket.js'
import { logger } from '../utils/logger.js'

export interface Notification {
  id?: string
  user_id: string
  type: string
  title: string
  message: string
  meeting_id?: string | null
  read?: boolean
  created_at?: string
}

class NotificationService {
  /**
   * Cria uma notificação no banco e envia via Socket.io
   */
  async notify(notification: Notification): Promise<void> {
    try {
      // Salva no banco
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: notification.user_id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          meeting_id: notification.meeting_id || null,
          read: false,
        })
        .select()
        .single()

      if (error) {
        logger.error('[Notifications] Erro ao criar notificação:', error)
        return
      }

      logger.info(`[Notifications] Notificação criada: ${data.id} para user ${notification.user_id}`)

      // Envia via Socket.io (se usuário estiver online)
      try {
        const io = getIO()
        emitToUser(io, notification.user_id, 'notification:new', data)
      } catch (ioError) {
        // Socket.io não inicializado ou usuário offline - não é erro crítico
        logger.debug('[Notifications] Socket.io não disponível ou usuário offline')
      }
    } catch (err) {
      logger.error('[Notifications] Erro ao notificar:', err)
    }
  }

  /**
   * Notifica quando reunião completa sem transcrição
   */
  async notifyMeetingNoTranscription(userId: string, meetingId: string, meetingTitle?: string): Promise<void> {
    const title = meetingTitle || 'Reunião sem transcrição'
    
    await this.notify({
      user_id: userId,
      type: 'meeting_no_transcription',
      title: '⚠️ Reunião sem transcrição',
      message: `A reunião "${title}" foi concluída mas não gerou transcrição. Isso pode acontecer quando ninguém fala ou o bot não tem permissão de áudio.`,
      meeting_id: meetingId,
    })
  }

  /**
   * Notifica quando o bot falhou ao entrar/gravar a reunião.
   * `reason` pode ser um código conhecido (ex: waiting_room_timeout) ou texto livre.
   */
  async notifyMeetingBotFailed(userId: string, meetingId: string, reason: string, meetingTitle?: string): Promise<void> {
    const title = meetingTitle || 'Reunião'

    const reasonMap: Record<string, string> = {
      waiting_room_timeout: 'o bot ficou na sala de espera e não foi admitido a tempo. Peça para um participante admitir o "Lemon Notetaker" assim que ele pedir para entrar.',
      bot_rejected: 'o bot foi recusado ao tentar entrar na reunião.',
      meeting_error: 'ocorreu um erro na plataforma da reunião e o bot não conseguiu permanecer.',
      invalid_meeting_url: 'o link da reunião era inválido ou a reunião não existia mais.',
    }
    const detail = reasonMap[reason] ?? `o bot encerrou com a falha "${reason}".`

    await this.notify({
      user_id: userId,
      type: 'meeting_bot_failed',
      title: '⚠️ Bot não conseguiu gravar',
      message: `A reunião "${title}" não foi gravada: ${detail}`,
      meeting_id: meetingId,
    })
  }

  /**
   * Notifica quando reunião é processada com sucesso
   */
  async notifyMeetingCompleted(userId: string, meetingId: string, meetingTitle?: string): Promise<void> {
    const title = meetingTitle || 'Reunião'
    
    await this.notify({
      user_id: userId,
      type: 'meeting_completed',
      title: '✅ Reunião processada',
      message: `A reunião "${title}" foi processada e está disponível para visualização.`,
      meeting_id: meetingId,
    })
  }

  /**
   * Marca notificação como lida
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)

    if (error) {
      logger.error('[Notifications] Erro ao marcar notificação como lida:', error)
    }
  }

  /**
   * Marca todas as notificações do usuário como lidas
   */
  async markAllAsRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) {
      logger.error('[Notifications] Erro ao marcar todas notificações como lidas:', error)
    }
  }

  /**
   * Lista notificações não lidas do usuário
   */
  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false)

    if (error) {
      logger.error('[Notifications] Erro ao contar notificações:', error)
      return 0
    }

    return count || 0
  }
}

export const notificationService = new NotificationService()

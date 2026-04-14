// Hook de lembretes de reunião via Web Notifications API
// Dispara notificação quando uma reunião começa hoje, e 30min antes
// Funciona apenas com a aba aberta — sem Service Worker.

import { useEffect, useRef } from 'react'
import { fetchMeetings, type Meeting } from '@/lib/meetingsCache'

const POLL_INTERVAL_MS = 60_000 // verifica a cada 1 minuto
const SNOOZE_KEY = 'meeting-notif-fired' // salvo no sessionStorage

function storageKey(meetingId: string, type: 'soon' | 'now'): string {
  return `${SNOOZE_KEY}:${meetingId}:${type}`
}

function alreadyFired(meetingId: string, type: 'soon' | 'now'): boolean {
  return sessionStorage.getItem(storageKey(meetingId, type)) === '1'
}

function markFired(meetingId: string, type: 'soon' | 'now'): void {
  sessionStorage.setItem(storageKey(meetingId, type), '1')
}

async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function fireNotification(title: string, body: string, meetLink: string | null) {
  const n = new Notification(title, {
    body,
    icon: '/logo.png',
    tag: title,
  })
  if (meetLink) {
    n.onclick = () => {
      window.open(meetLink, '_blank', 'noopener,noreferrer')
      n.close()
    }
  }
}

async function checkAndNotify() {
  const permitted = await requestPermission()
  if (!permitted) return

  let meetings: Meeting[]
  try {
    meetings = await fetchMeetings()
  } catch {
    return
  }

  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)

  const todayUpcoming = meetings.filter(m => {
    if (!m.started_at) return false
    if (m.status !== 'requesting' && m.status !== 'pending') return false
    const t = new Date(m.started_at)
    return t >= todayStart && t <= todayEnd && t > now
  })

  for (const meeting of todayUpcoming) {
    const start = new Date(meeting.started_at!)
    const diffMin = (start.getTime() - now.getTime()) / 60_000
    const name = meeting.title || 'Reunião'

    // Lembrete 30min antes (janela: 28–32 min)
    if (diffMin >= 28 && diffMin <= 32 && !alreadyFired(meeting.id, 'soon')) {
      fireNotification(
        `⏰ ${name} em 30 minutos`,
        `${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — O bot Lemon vai entrar automaticamente`,
        meeting.meet_link
      )
      markFired(meeting.id, 'soon')
    }

    // Lembrete na hora (janela: 0–3 min)
    if (diffMin >= 0 && diffMin <= 3 && !alreadyFired(meeting.id, 'now')) {
      fireNotification(
        `🟢 ${name} está começando!`,
        `O bot Lemon Notetaker está entrando na reunião agora`,
        meeting.meet_link
      )
      markFired(meeting.id, 'now')
    }
  }
}

export function useMeetingReminders() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Roda imediatamente ao montar
    checkAndNotify()

    intervalRef.current = setInterval(checkAndNotify, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])
}

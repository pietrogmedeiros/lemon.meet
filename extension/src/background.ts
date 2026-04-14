// ============================================================
// background.ts — Service Worker da extensão Lemon.meet
// ============================================================

import { getStoredSession } from './lib/auth'

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'processing'

export interface MeetingSession {
  meetingId: string; tabId: number; platform: string
  title: string; meetLink: string; startedAt: number
}

export interface MessageToBackground {
  type: 'START_RECORDING' | 'STOP_RECORDING' | 'GET_STATE' | 'MEETING_DETECTED' | 'MEETING_ENDED'
      | 'AUTH_CHANGED' | 'RESET_STATE' | 'OPEN_POPUP' | 'TOGGLE_RECORDING'
  tabId?: number
  meetLink?: string
  title?: string
  platform?: string
}

export interface MessageFromBackground {
  type: 'STATE_UPDATE' | 'ERROR' | 'RECORDING_STARTED' | 'RECORDING_STOPPED'
  state?: RecordingState; session?: MeetingSession | null; error?: string
}

let recordingState: RecordingState = 'idle'
let currentSession: MeetingSession | null = null
const API_URL = 'https://vibe-aiserver-production.up.railway.app'

// Tempo de espera antes de disparar o bot automaticamente após entrar na reunião.
// Evita enviar bot em reuniões que o usuário entrou por engano ou abandonou rápido.
const AUTO_START_DELAY_MS = 8_000

let autoStartTimer: ReturnType<typeof setTimeout> | null = null

function setState(next: RecordingState) { recordingState = next; broadcastState() }
function broadcastState() {
  chrome.runtime.sendMessage<MessageFromBackground>({ type: 'STATE_UPDATE', state: recordingState, session: currentSession }).catch(() => {})
}

chrome.runtime.onMessage.addListener((msg: MessageToBackground, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATE':
      sendResponse({ state: recordingState, session: currentSession }); break

    case 'START_RECORDING': {
      const tabId = msg.tabId ?? sender.tab?.id
      handleStartRecording(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[Lemon.meet] Erro ao iniciar gravação:', String(err))
          setState('idle')
          sendResponse({ ok: false, error: String(err) })
        })
      return true
    }

    case 'STOP_RECORDING':
      handleStopRecording().then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }))
      return true

    case 'TOGGLE_RECORDING': {
      if (recordingState === 'recording') {
        handleStopRecording().then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }))
        return true
      }
      if (recordingState !== 'idle') { sendResponse({ ok: false, error: 'Aguarde' }); break }
      const tabId = sender.tab?.id
      if (!tabId) { sendResponse({ ok: false, error: 'Nenhuma aba encontrada' }); break }
      handleStartRecording(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => { setState('idle'); sendResponse({ ok: false, error: String(err) }) })
      return true
    }

    case 'MEETING_DETECTED': {
      // Salva info da reunião detectada para uso no handleStartRecording
      chrome.storage.local.set({ lastDetected: msg })

      // Auto-start: dispara o bot automaticamente após o delay de segurança
      if (recordingState === 'idle') {
        const tabId = sender.tab?.id
        if (!tabId) break

        // Cancela qualquer timer pendente antes de criar um novo
        if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null }

        autoStartTimer = setTimeout(() => {
          autoStartTimer = null
          // Só inicia se ainda estiver idle quando o timer disparar
          if (recordingState !== 'idle') return
          console.log('[Lemon.meet] Auto-start: disparando bot para reunião detectada')
          handleStartRecording(tabId).catch((err) => {
            console.warn('[Lemon.meet] Auto-start falhou:', String(err))
          })
        }, AUTO_START_DELAY_MS)
      }
      break
    }

    case 'MEETING_ENDED': {
      // Cancela auto-start se o usuário saiu antes do timer disparar
      if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null }
      if (recordingState === 'recording') handleStopRecording().catch(console.error)
      break
    }

    case 'RESET_STATE':
      setState('idle'); sendResponse({ ok: true }); break

    case 'OPEN_POPUP':
      chrome.action.openPopup().catch(() => {}); break
  }
})

async function handleStartRecording(tabId?: number): Promise<void> {
  if (recordingState !== 'idle') throw new Error('Já há uma gravação em andamento')
  if (!tabId) throw new Error('Nenhuma aba encontrada')

  setState('requesting')

  const session = await getStoredSession()
  if (!session) throw new Error('Usuário não autenticado')

  // Obtém URL diretamente da aba (mais confiável que lastDetected)
  const tab = await chrome.tabs.get(tabId)
  const meetLink = tab.url ?? ''
  if (!meetLink) throw new Error('URL da reunião não encontrada')

  // Detecta plataforma pelo URL
  const platform = meetLink.includes('meet.google.com') ? 'google_meet'
    : meetLink.includes('zoom.us') ? 'zoom' : 'teams'

  // Título: usa lastDetected se disponível, senão deriva do URL/título da aba
  const stored = await chrome.storage.local.get('lastDetected')
  const detected = stored.lastDetected as any
  const codeMatch = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
  const title = detected?.title ?? (codeMatch ? `Reunião ${codeMatch[1]}` : tab.title ?? 'Reunião')

  const res = await fetch(`${API_URL}/api/meetings/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ meetLink, title, platform }),
  })

  if (!res.ok) throw new Error(`Backend error: ${res.status} — servidor está rodando?`)

  const { meetingId } = await res.json()
  console.log('[Lemon.meet] Meeting criada, bot enviado:', meetingId)

  currentSession = { meetingId, tabId, platform, title, meetLink, startedAt: Date.now() }
  await chrome.storage.local.set({ activeSession: currentSession, recordingStatePersisted: 'recording' })

  setState('recording')
  console.log('[Lemon.meet] ✅ Bot do MeetingBaas enviado — meeting:', meetingId)
}

async function handleStopRecording(): Promise<void> {
  if (recordingState !== 'recording' || !currentSession) return

  setState('stopping')

  const session = await getStoredSession()
  const durationSeconds = Math.round((Date.now() - currentSession.startedAt) / 1000)

  if (session) {
    await fetch(`${API_URL}/api/meetings/${currentSession.meetingId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ durationSeconds }),
    }).catch(console.error)
  }

  setState('processing')
  chrome.runtime.sendMessage<MessageFromBackground>({ type: 'RECORDING_STOPPED', session: currentSession }).catch(() => {})
  currentSession = null
  await chrome.storage.local.remove(['activeSession', 'recordingStatePersisted'])
  setTimeout(() => setState('idle'), 3000)
}

// Restaura estado da sessão se o Service Worker foi reiniciado durante uma gravação
chrome.storage.local.get(['activeSession', 'recordingStatePersisted']).then(async (stored) => {
  if (stored.recordingStatePersisted === 'recording' && stored.activeSession) {
    currentSession = stored.activeSession as MeetingSession
    recordingState = 'recording'
    console.log('[Lemon.meet] SW reiniciado — sessão restaurada:', currentSession.meetingId)
  }
})

// keepAlive: acorda o SW periodicamente para preservar estado da sessão
chrome.alarms.onAlarm.addListener(() => {})
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 })

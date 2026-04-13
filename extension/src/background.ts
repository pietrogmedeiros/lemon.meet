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
  type: 'START_RECORDING' | 'STOP_RECORDING' | 'GET_STATE' | 'MEETING_DETECTED' | 'MEETING_ENDED' | 'AUTH_CHANGED' | 'RESET_STATE' | 'OPEN_POPUP' | 'TOGGLE_RECORDING'
  tabId?: number
  streamId?: string
}

export interface MessageFromBackground {
  type: 'STATE_UPDATE' | 'ERROR' | 'RECORDING_STARTED' | 'RECORDING_STOPPED'
  state?: RecordingState; session?: MeetingSession | null; error?: string
}

let recordingState: RecordingState = 'idle'
let currentSession: MeetingSession | null = null
const API_URL = 'https://vibe-aiserver-production.up.railway.app'

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
      const streamId = msg.streamId
      handleStartRecording(tabId, streamId)
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
      // O background tem permissão tabCapture e pode obter o streamId diretamente,
      // sem precisar do popup aberto. O streamId é repassado ao offscreen doc.
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          setState('idle')
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'sem streamId' })
          return
        }
        const stored = await chrome.storage.local.get('micGranted')
        if (!stored.micGranted) {
          // Primeira vez: abre janela para solicitar permissão de mic.
          // Salva o pendingCapture para que request-mic.html dispare a gravação após obter permissão.
          await chrome.storage.local.set({ pendingCapture: { tabId, streamId } })
          chrome.windows.create({ url: chrome.runtime.getURL('request-mic.html'), type: 'popup', width: 440, height: 320, focused: true })
          sendResponse({ ok: true })
        } else {
          handleStartRecording(tabId, streamId)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => { setState('idle'); sendResponse({ ok: false, error: String(err) }) })
        }
      })
      return true
    }
    case 'RESET_STATE':
      setState('idle'); sendResponse({ ok: true }); break
    case 'OFFSCREEN_KEEPALIVE':
      // O offscreen doc está vivo — apenas confirma para manter o SW ativo
      sendResponse({ ok: true }); break
    case 'OPEN_POPUP':
      chrome.action.openPopup().catch(() => {}); break
    case 'MEETING_DETECTED':
      chrome.storage.local.set({ lastDetected: msg }); break
    case 'MEETING_ENDED':
      if (recordingState === 'recording') handleStopRecording().catch(console.error); break
  }
})

async function setupOffscreenDocument(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })
  if (existing.length > 0) return
  await (chrome.offscreen as any).createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'], justification: 'Gravar áudio da reunião' })
}

async function closeOffscreenDocument(): Promise<void> {
  try { await (chrome.offscreen as any).closeDocument() } catch {}
}

async function handleStartRecording(tabId?: number, streamId?: string): Promise<void> {
  if (recordingState !== 'idle') throw new Error('Já há uma gravação em andamento')
  if (!tabId) throw new Error('Nenhuma aba encontrada')
  if (!streamId) throw new Error('streamId não fornecido — use o popup na aba do Meet')

  setState('requesting')
  console.log('[Lemon.meet] Iniciando gravação, tabId:', tabId)

  const session = await getStoredSession()
  if (!session) throw new Error('Usuário não autenticado')

  const stored = await chrome.storage.local.get('lastDetected')
  const detected = stored.lastDetected as any

  const res = await fetch(`${API_URL}/api/meetings/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ meetLink: detected?.meetLink ?? '', title: detected?.title ?? 'Reunião sem título', platform: detected?.platform ?? 'google_meet' }),
  })

  if (!res.ok) throw new Error(`Backend error: ${res.status} — servidor está rodando?`)

  const { meetingId } = await res.json()
  console.log('[Lemon.meet] Meeting criada:', meetingId)

  currentSession = { meetingId, tabId, platform: detected?.platform ?? 'google_meet', title: detected?.title ?? 'Reunião sem título', meetLink: detected?.meetLink ?? '', startedAt: Date.now() }
  // Persiste sessão no storage para sobreviver a reinicializações do Service Worker
  await chrome.storage.local.set({ activeSession: currentSession, recordingStatePersisted: 'recording' })

  await setupOffscreenDocument()
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', streamId, meetingId, accessToken: session.access_token })

  setState('recording')
  console.log('[Lemon.meet] ✅ Gravação iniciada — meeting:', meetingId)
}

async function handleStopRecording(): Promise<void> {
  if (recordingState !== 'recording' || !currentSession) return

  setState('stopping')
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))
  await closeOffscreenDocument()

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
    // Verifica se o offscreen doc ainda está vivo antes de restaurar o estado
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })
    if (contexts.length > 0) {
      currentSession = stored.activeSession as MeetingSession
      recordingState = 'recording'
      console.log('[Lemon.meet] SW reiniciado — sessão restaurada (offscreen ativo):', currentSession.meetingId)
    } else {
      // Offscreen doc também morreu junto com o SW — gravação foi perdida
      console.warn('[Lemon.meet] SW reiniciado — offscreen doc morreu, limpando estado de gravação')
      chrome.storage.local.remove(['activeSession', 'recordingStatePersisted'])
    }
  }
})

// keepAlive: alarm a cada 24s para evitar que o Chrome mate o Service Worker durante gravações
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    if (recordingState === 'recording') {
      // Verifica se o offscreen doc ainda está vivo
      chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] }).then((contexts) => {
        if (contexts.length === 0) {
          // Offscreen doc morreu — a gravação foi perdida, limpa o estado
          console.warn('[Lemon.meet] keepAlive: offscreen doc morreu durante gravação — limpando estado')
          currentSession = null
          chrome.storage.local.remove(['activeSession', 'recordingStatePersisted'])
          setState('idle')
        } else {
          // Pinga o offscreen doc para manter AudioContext ativo
          chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {})
        }
      })
    }
  }
})
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 })

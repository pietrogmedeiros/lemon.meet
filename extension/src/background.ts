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
  type: 'START_RECORDING' | 'STOP_RECORDING' | 'GET_STATE' | 'MEETING_DETECTED' | 'MEETING_ENDED' | 'AUTH_CHANGED' | 'RESET_STATE'
  tabId?: number
  streamId?: string
}

export interface MessageFromBackground {
  type: 'STATE_UPDATE' | 'ERROR' | 'RECORDING_STARTED' | 'RECORDING_STOPPED'
  state?: RecordingState; session?: MeetingSession | null; error?: string
}

let recordingState: RecordingState = 'idle'
let currentSession: MeetingSession | null = null
const API_URL = 'http://localhost:3000'

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
    case 'RESET_STATE':
      setState('idle'); sendResponse({ ok: true }); break
    case 'MEETING_DETECTED':
      chrome.storage.local.set({ lastDetected: msg }); break
    case 'MEETING_ENDED':
      if (recordingState === 'recording') handleStopRecording().catch(console.error); break
  }
})

async function setupOffscreenDocument(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })
  if (existing.length > 0) return
  await (chrome.offscreen as any).createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Gravar áudio da reunião' })
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
  setTimeout(() => setState('idle'), 3000)
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'keepAlive') {} })
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 })

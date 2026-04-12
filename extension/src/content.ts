// ============================================================
// content.ts — Content Script da extensão Lemon.meet
// Injeta em: Google Meet, Zoom, Microsoft Teams
//
// Responsabilidades:
//   1. Detectar entrada/saída de reuniões
//   2. Capturar título da reunião e plataforma
//   3. Contar participantes (quando possível)
//   4. Notificar o background service worker
//   5. Injetar o botão flutuante na reunião
// ============================================================

// ── Plataforma ────────────────────────────────────────────────

type Platform = 'google_meet' | 'zoom' | 'teams'

function detectPlatform(): Platform {
  const url = window.location.href
  if (url.includes('meet.google.com')) return 'google_meet'
  if (url.includes('zoom.us')) return 'zoom'
  return 'teams'
}

// ── Detectores por plataforma ─────────────────────────────────

interface MeetingInfo {
  inMeeting: boolean
  title: string
  meetLink: string
  platform: Platform
  participantsCount: number
}

function detectGoogleMeet(): MeetingInfo {
  const platform: Platform = 'google_meet'
  const meetLink = window.location.href

  // Reunião ativa quando há elementos de controle de mídia
  const inMeeting =
    !!document.querySelector('[data-call-ended="false"]') ||
    !!document.querySelector('[jsname="CQylAd"]') || // botão de encerrar
    !!document.querySelector('[data-tooltip="Leave call"]') ||
    !!document.querySelector('[aria-label*="Leave"]') ||
    !!document.querySelector('div[data-allocation-index]') // tile de participante

  // Título: nome da reunião ou código
  const titleEl =
    document.querySelector('[data-meeting-title]') ||
    document.querySelector('c-wiz[data-meeting-title]')
  const codeMatch = meetLink.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
  const title =
    titleEl?.getAttribute('data-meeting-title') ||
    (codeMatch ? `Reunião ${codeMatch[1]}` : 'Reunião Google Meet')

  // Participantes: conta tiles de vídeo
  const participantsCount =
    document.querySelectorAll('[data-allocation-index]').length ||
    document.querySelectorAll('[jsname="cGMI2b"]').length || // lista de participantes
    1

  return { inMeeting, title, meetLink, platform, participantsCount }
}

function detectZoom(): MeetingInfo {
  const platform: Platform = 'zoom'
  const meetLink = window.location.href

  const inMeeting =
    !!document.querySelector('.meeting-app') ||
    !!document.querySelector('#wc-container-right') ||
    !!document.querySelector('[aria-label="Leave"]')

  const titleEl = document.querySelector('.meeting-info-header__meeting-topic')
  const title = titleEl?.textContent?.trim() || 'Reunião Zoom'

  const participantsCount =
    parseInt(
      document.querySelector('.participants-header__count')?.textContent || '1'
    ) || 1

  return { inMeeting, title, meetLink, platform, participantsCount }
}

function detectTeams(): MeetingInfo {
  const platform: Platform = 'teams'
  const meetLink = window.location.href

  const inMeeting =
    !!document.querySelector('[data-tid="calling-screen"]') ||
    !!document.querySelector('[id="hangup-button"]')

  const titleEl = document.querySelector(
    '[data-tid="meeting-title"], .ts-calling-screen-title'
  )
  const title = titleEl?.textContent?.trim() || 'Reunião Teams'

  const participantsCount =
    parseInt(
      document.querySelector('[data-tid="roster-count"]')?.textContent || '1'
    ) || 1

  return { inMeeting, title, meetLink, platform, participantsCount }
}

function getMeetingInfo(): MeetingInfo {
  const platform = detectPlatform()
  if (platform === 'google_meet') return detectGoogleMeet()
  if (platform === 'zoom') return detectZoom()
  return detectTeams()
}

// ── Botão flutuante ───────────────────────────────────────────

let floatingBtn: HTMLElement | null = null

function injectFloatingButton(info: MeetingInfo) {
  if (floatingBtn) return // já injetado

  floatingBtn = document.createElement('div')
  floatingBtn.id = 'lemon-meet-btn'
  floatingBtn.innerHTML = `
    <div style="
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div id="lemon-meet-badge" style="
        background: #2D5A27;
        color: white;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 999px;
        white-space: nowrap;
        display: none;
      ">● Gravando…</div>
      <button id="lemon-meet-toggle" style="
        background: #2D5A27;
        border: none;
        border-radius: 50%;
        width: 48px;
        height: 48px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s;
      " title="Lemon.meet — gravar reunião">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3" fill="#FFD700"/>
        </svg>
      </button>
    </div>
  `
  document.body.appendChild(floatingBtn)

  const btn = document.getElementById('lemon-meet-toggle')!
  btn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' })
    } catch { /* contexto invalidado — extensão foi atualizada */ }
  })
}

function removeFloatingButton() {
  floatingBtn?.remove()
  floatingBtn = null
}

function updateFloatingButton(recording: boolean) {
  const badge = document.getElementById('lemon-meet-badge')
  const btn = document.getElementById('lemon-meet-toggle')
  if (!badge || !btn) return

  if (recording) {
    badge.style.display = 'block'
    btn.style.background = '#DC3545'
    btn.title = 'Lemon.meet — parar gravação'
  } else {
    badge.style.display = 'none'
    btn.style.background = '#2D5A27'
    btn.title = 'Lemon.meet — gravar reunião'
  }
}

// ── Listener de estado vindo do background ────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    updateFloatingButton(msg.state === 'recording')
  }
})

// ── Observer principal ────────────────────────────────────────

let wasInMeeting = false
let pollInterval: ReturnType<typeof setInterval> | null = null

function checkMeetingState() {
  const info = getMeetingInfo()

  if (info.inMeeting && !wasInMeeting) {
    // Entrou na reunião
    wasInMeeting = true
    try { chrome.runtime.sendMessage({ type: 'MEETING_DETECTED', ...info }) } catch {}
    injectFloatingButton(info)
  }

  if (!info.inMeeting && wasInMeeting) {
    // Saiu da reunião
    wasInMeeting = false
    try { chrome.runtime.sendMessage({ type: 'MEETING_ENDED' }) } catch {}
    removeFloatingButton()
  }
}

// Inicia polling (MutationObserver seria mais eficiente mas o
// Meet/Zoom mudam estrutura com frequência — polling é mais resiliente)
pollInterval = setInterval(checkMeetingState, 2000)
checkMeetingState() // checa imediatamente ao carregar

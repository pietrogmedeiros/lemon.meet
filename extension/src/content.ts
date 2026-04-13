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
      chrome.runtime.sendMessage({ type: 'TOGGLE_RECORDING' })
    } catch { /* contexto invalidado — extensão foi atualizada */ }
  })
}

function removeFloatingButton() {
  floatingBtn?.remove()
  floatingBtn = null
}

type ButtonState = 'idle' | 'loading' | 'recording'

function updateFloatingButton(state: ButtonState) {
  const badge = document.getElementById('lemon-meet-badge')
  const btn = document.getElementById('lemon-meet-toggle') as HTMLButtonElement | null
  if (!badge || !btn) return

  if (state === 'recording') {
    badge.style.display = 'block'
    badge.textContent = '● Gravando…'
    btn.style.background = '#DC3545'
    btn.style.opacity = '1'
    btn.disabled = false
    btn.title = 'Lemon.meet — parar gravação'
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`
  } else if (state === 'loading') {
    badge.style.display = 'block'
    badge.textContent = 'Processando…'
    btn.style.background = '#2D5A27'
    btn.style.opacity = '0.7'
    btn.disabled = true
    btn.title = 'Lemon.meet — processando'
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>`
  } else {
    badge.style.display = 'none'
    btn.style.background = '#2D5A27'
    btn.style.opacity = '1'
    btn.disabled = false
    btn.title = 'Lemon.meet — gravar reunião'
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="#FFD700"/></svg>`
  }
}

// ── Listener de estado vindo do background ────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    const s = msg.state as string
    if (s === 'recording') updateFloatingButton('recording')
    else if (s === 'requesting' || s === 'stopping' || s === 'processing') updateFloatingButton('loading')
    else updateFloatingButton('idle')
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

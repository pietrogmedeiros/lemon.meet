import React, { useEffect, useState } from 'react'
import { Mic, MicOff, LogOut, ExternalLink, Loader2, CircleDot } from 'lucide-react'
import { getStoredSession, importSessionFromWebApp, signOut } from '../lib/auth'
import type { RecordingState, MeetingSession } from '../background'

// ── Login ─────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setError('')
    setLoading(true)
    try {
      await importSessionFromWebApp()
      onLogin()
    } catch (err: any) {
      setError(err.message ?? 'Erro ao conectar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--green)', display: 'flex',
          alignItems: 'center', justifyContent: 'center'
        }}>
          <span style={{ fontSize: 18 }}>🍋</span>
        </div>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>
          Lemon.meet
        </span>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
        Conecte sua conta para gravar reuniões.
      </p>

      <button onClick={handleConnect} disabled={loading} style={btnPrimaryStyle}>
        {loading
          ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          : '🔗 Conectar com o app'
        }
      </button>

      {error && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{error}</p>
      )}

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
        Faça login com Google em{' '}
        <a
          href="https://lemon-meet.web.app"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}
        >
          lemon-meet.web.app
        </a>
        {' '}e clique em "Conectar com o app".
      </p>
    </div>
  )
}

// ── Dashboard principal ───────────────────────────────────────

function DashboardView({
  email,
  state,
  session,
  onLogout,
}: {
  email: string
  state: RecordingState
  session: MeetingSession | null
  onLogout: () => void
}) {
  function handleToggle() {
    if (state === 'idle') {
      // O popup foi aberto pelo usuário na aba do Meet → tem activeTab
      // Obtemos o streamId aqui (popup tem permissão, service worker não)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if (!tab?.id) {
          // Tenta encontrar aba do Meet em qualquer janela
          chrome.tabs.query({}, (allTabs) => {
            const meetTab = allTabs.find(t => t.url?.includes('meet.google.com'))
            if (!meetTab?.id) {
              alert('Abra o popup estando na aba do Google Meet.')
              return
            }
            captureTab(meetTab.id)
          })
          return
        }
        captureTab(tab.id)
      })
    } else if (state === 'recording') {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
    }
  }

  async function captureTab(tabId: number) {
    // Verifica se microfone já está autorizado
    const micStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })

    if (micStatus.state !== 'granted') {
      // O popup fecha ao perder foco assim que abre outra janela, destruindo
      // qualquer Promise em andamento. Solução: obter o streamId AGORA enquanto
      // o popup ainda tem foco (permissão activeTab), salvar no storage, e
      // deixar a página request-mic.html disparar o START_RECORDING após obter
      // a permissão de microfone.
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          alert('Erro ao capturar áudio: ' + (chrome.runtime.lastError?.message ?? 'sem streamId'))
          return
        }
        await chrome.storage.local.set({ pendingCapture: { tabId, streamId } })
        chrome.windows.create({
          url: chrome.runtime.getURL('request-mic.html'),
          type: 'popup',
          width: 440,
          height: 320,
          focused: true,
        })
        // O popup pode fechar aqui — request-mic.html cuida do resto
      })
      return
    }

    // Microfone já autorizado — fluxo normal
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        alert('Erro ao capturar áudio: ' + (chrome.runtime.lastError?.message ?? 'sem streamId'))
        return
      }
      chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId, streamId })
    })
  }

  const isRecording = state === 'recording'
  const isLoading = state === 'requesting' || state === 'stopping' || state === 'processing'

  // Timer que atualiza a cada segundo enquanto grava
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [isRecording])

  const duration = session
    ? formatDuration(Math.round((Date.now() - session.startedAt) / 1000))
    : null

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'var(--green)', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
          }}>
            <span style={{ fontSize: 16 }}>🍋</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--green)' }}>
            Lemon.meet
          </span>
        </div>
        <button onClick={onLogout} title="Sair" style={iconBtnStyle}>
          <LogOut size={15} color="var(--text-muted)" />
        </button>
      </div>

      {/* Status card */}
      <div style={{
        background: 'var(--surface)',
        border: `1px solid ${isRecording ? 'var(--red)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        marginBottom: 14,
        boxShadow: 'var(--shadow)',
        transition: 'border-color 0.2s',
      }}>
        {isRecording && session ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <CircleDot size={14} color="var(--red)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Gravando
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {duration}
              </span>
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
              {session.title}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {platformLabel(session.platform)}
            </p>
          </>
        ) : isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} color="var(--green)" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {stateLabel(state)}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MicOff size={16} color="var(--text-muted)" />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Nenhuma gravação ativa
            </span>
          </div>
        )}
      </div>

      {/* Botão principal */}
      <button
        onClick={handleToggle}
        disabled={isLoading}
        style={{
          ...btnPrimaryStyle,
          background: isRecording ? 'var(--red)' : 'var(--green)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: isLoading ? 0.6 : 1,
          cursor: isLoading ? 'not-allowed' : 'pointer',
        }}
      >
        {isLoading ? (
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
        ) : isRecording ? (
          <><MicOff size={16} /> Parar gravação</>
        ) : (
          <><Mic size={16} /> Iniciar gravação</>
        )}
      </button>

      {isLoading && (
        <button
          onClick={() => chrome.runtime.sendMessage({ type: 'RESET_STATE' })}
          style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Cancelar
        </button>
      )}

      {/* Divider + link app */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {email}
        </span>
        <a
          href="https://lemon-meet.web.app"
          target="_blank"
          rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}
        >
          Ver reuniões <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────

export default function Popup() {
  const [authed, setAuthed] = useState<boolean | null>(null) // null = carregando
  const [email, setEmail] = useState('')
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [session, setSession] = useState<MeetingSession | null>(null)

  // Verifica sessão salva ao abrir o popup
  useEffect(() => {
    getStoredSession().then((s) => {
      setAuthed(!!s)
      setEmail(s?.user?.email ?? '')
    })
  }, [])

  // Sincroniza estado de gravação com background
  useEffect(() => {
    if (!authed) return
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
      if (res) {
        setRecordingState(res.state)
        setSession(res.session ?? null)
      }
    })

    const listener = (msg: any) => {
      if (msg.type === 'STATE_UPDATE') {
        setRecordingState(msg.state)
        setSession(msg.session ?? null)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [authed])

  // Fallback local: se o estado ficar em 'processing' por mais de 5s,
  // força transição para 'idle'. O SW MV3 pode ser morto antes do seu
  // próprio setTimeout de 3s disparar, deixando o loading travado.
  useEffect(() => {
    if (recordingState !== 'processing') return
    const timer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'RESET_STATE' }).catch(() => {})
      setRecordingState('idle')
    }, 5000)
    return () => clearTimeout(timer)
  }, [recordingState])

  async function handleLogout() {
    await signOut()
    setAuthed(false)
    setEmail('')
  }

  if (authed === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120 }}>
        <Loader2 size={24} color="var(--green)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!authed) {
    return <LoginView onLogin={() => {
      getStoredSession().then(s => {
        setAuthed(true)
        setEmail(s?.user?.email ?? '')
      })
    }} />
  }

  return (
    <DashboardView
      email={email}
      state={recordingState}
      session={session}
      onLogout={handleLogout}
    />
  )
}

// ── Helpers ───────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 13,
  outline: 'none',
  background: 'var(--surface)',
  color: 'var(--text)',
}

const btnPrimaryStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  background: 'var(--green)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'background 0.15s',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    google_meet: 'Google Meet',
    zoom: 'Zoom',
    teams: 'Microsoft Teams',
    meet: 'Google Meet',
  }
  return map[platform] ?? platform
}

function stateLabel(state: RecordingState): string {
  const map: Record<RecordingState, string> = {
    idle: 'Pronto',
    requesting: 'Iniciando…',
    recording: 'Gravando',
    stopping: 'Parando…',
    processing: 'Processando reunião…',
  }
  return map[state]
}

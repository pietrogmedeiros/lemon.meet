// ============================================================
// WebinarConfigPage.tsx — Painel admin de Webinars
// Gate: email allowlist + x-admin-key (mesmo padrão de AdminMetricsPage)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout'
import { Card } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import {
  Calendar,
  Clock,
  Copy,
  Check,
  Loader,
  Plus,
  Trash2,
  Power,
  PowerOff,
  ExternalLink,
  Link as LinkIcon,
  Settings,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const DEV_ALLOWLIST = new Set([
  'pietrogoncalvesmedeiros@gmail.com',
  'deive.oliveira@starbem.app',
])

interface WebinarConfig {
  id: string
  team_id: string
  slug: string
  title: string
  description: string | null
  logo_url: string | null
  is_active: boolean
}

interface WebinarSession {
  id: string
  config_id: string
  scheduled_at: string
  webinar_link: string
  is_active: boolean
}

interface WebinarRegistration {
  id: string
  session_id: string
  guest_name: string
  guest_email: string
  guest_phone: string | null
  registered_at: string
  webinar_sessions: { scheduled_at: string; webinar_link: string }
}

function localToISO(local: string): string {
  return new Date(local).toISOString()
}

function formatPretty(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function WebinarConfigPage() {
  const navigate = useNavigate()

  // Auth
  const [authChecked, setAuthChecked] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  // Data
  const [config, setConfig] = useState<WebinarConfig | null>(null)
  const [sessions, setSessions] = useState<WebinarSession[]>([])
  const [registrations, setRegistrations] = useState<WebinarRegistration[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'config' | 'sessions' | 'registrations'>('config')

  // Config form
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('Webinar')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  // New session form
  const [newSessionAt, setNewSessionAt] = useState('')
  const [newSessionLink, setNewSessionLink] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)

  // Notification
  const [notif, setNotif] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const showNotif = (type: 'success' | 'error', message: string) => {
    setNotif({ type, message })
    setTimeout(() => setNotif(null), 4000)
  }

  // Bootstrap session/email
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      const email = session?.user?.email?.toLowerCase().trim() ?? null
      setUserEmail(email)
      setAccessToken(session?.access_token ?? null)
      setAuthChecked(true)
      if (!session) navigate('/login')
    })()
    return () => { active = false }
  }, [navigate])

  const isAllowed = userEmail ? DEV_ALLOWLIST.has(userEmail) : false

  const adminHeaders = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
  }), [accessToken])

  const fetchAll = useCallback(async () => {
    if (!accessToken || !isAllowed) return
    setLoading(true)
    try {
      const [configRes, sessionsRes, regsRes] = await Promise.all([
        fetch(`${API}/api/webinars/config`, { headers: adminHeaders }),
        fetch(`${API}/api/webinars/sessions`, { headers: adminHeaders }),
        fetch(`${API}/api/webinars/registrations`, { headers: adminHeaders }),
      ])

      const configJson = await configRes.json()
      if (configJson.config) {
        setConfig(configJson.config)
        setSlug(configJson.config.slug)
        setTitle(configJson.config.title)
        setDescription(configJson.config.description ?? '')
        setIsActive(configJson.config.is_active)
      }

      const sessionsJson = await sessionsRes.json()
      setSessions(sessionsJson.sessions ?? [])

      const regsJson = await regsRes.json()
      setRegistrations(regsJson.registrations ?? [])
    } catch (err: any) {
      showNotif('error', err.message || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [accessToken, isAllowed, adminHeaders])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Handlers
  const handleSaveConfig = async () => {
    if (!slug.trim()) {
      showNotif('error', 'Slug é obrigatório')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${API}/api/webinars/config`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title, description, is_active: isActive })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Erro ao salvar')
      setConfig(data.config)
      showNotif('success', 'Configuração salva')
    } catch (err: any) {
      showNotif('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return showNotif('error', 'Máximo 5MB')
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      return showNotif('error', 'Apenas PNG e JPEG')
    }
    if (!config) {
      return showNotif('error', 'Salve a configuração antes de subir o logo')
    }

    setUploadingLogo(true)
    try {
      const reader = new FileReader()
      reader.onload = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)

      const formData = new FormData()
      formData.append('logo', file)
      const res = await fetch(`${API}/api/webinars/config/logo`, {
        method: 'POST',
        headers: adminHeaders,
        body: formData
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Erro ao enviar')
      setConfig(c => c ? { ...c, logo_url: data.logo_url } : c)
    } catch (err: any) {
      showNotif('error', err.message)
      setLogoPreview(null)
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleCreateSession = async () => {
    if (!newSessionAt || !newSessionLink.trim()) {
      return showNotif('error', 'Preencha data e link')
    }
    setCreatingSession(true)
    try {
      const res = await fetch(`${API}/api/webinars/sessions`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_at: localToISO(newSessionAt),
          webinar_link: newSessionLink.trim(),
          is_active: true
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Erro ao criar sessão')
      setSessions(prev => [...prev, data.session].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)))
      setNewSessionAt('')
      setNewSessionLink('')
      showNotif('success', 'Sessão criada')
    } catch (err: any) {
      showNotif('error', err.message)
    } finally {
      setCreatingSession(false)
    }
  }

  const handleToggleSession = async (s: WebinarSession) => {
    try {
      const res = await fetch(`${API}/api/webinars/sessions/${s.id}`, {
        method: 'PATCH',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !s.is_active })
      })
      if (!res.ok) throw new Error('Erro ao atualizar')
      setSessions(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
    } catch (err: any) {
      showNotif('error', err.message)
    }
  }

  const handleDeleteSession = async (id: string) => {
    if (!window.confirm('Excluir esta sessão?')) return
    try {
      const res = await fetch(`${API}/api/webinars/sessions/${id}`, {
        method: 'DELETE',
        headers: adminHeaders
      })
      if (!res.ok) throw new Error('Erro ao remover')
      setSessions(prev => prev.filter(x => x.id !== id))
    } catch (err: any) {
      showNotif('error', err.message)
    }
  }

  const publicLink = config ? `${window.location.origin}/webinar/${config.slug}` : null

  const copyLink = () => {
    if (!publicLink) return
    navigator.clipboard.writeText(publicLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  // ── Gates ─────────────────────────────────────────────────
  if (!authChecked) {
    return <MainLayout><div className="p-6 text-sm text-[#666]">Verificando sessão…</div></MainLayout>
  }
  if (!isAllowed) {
    return (
      <MainLayout>
        <div className="p-6">
          <Card>
            <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
            <p className="text-sm text-[#666]">Apenas admins autorizados podem acessar esta página.</p>
            <p className="text-xs text-[#999] mt-2">Logado como: {userEmail ?? '—'}</p>
          </Card>
        </div>
      </MainLayout>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#2D5A27] mb-1">Webinars</h1>
            <p className="text-[#666666] text-sm">Configure datas, gerencie inscrições e compartilhe o link público</p>
          </div>
          {config && (
            <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {isActive ? <><CheckCircle size={16} /> Ativo</> : <><XCircle size={16} /> Inativo</>}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-[#E0E0E0]">
          {[
            { key: 'config', label: 'Configuração', icon: Settings },
            { key: 'sessions', label: 'Sessões', icon: Calendar },
            { key: 'registrations', label: `Inscrições${registrations.length ? ` (${registrations.length})` : ''}`, icon: Users },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                tab === key ? 'border-[#2D5A27] text-[#2D5A27] font-medium' : 'border-transparent text-[#666] hover:text-[#2D5A27]'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {loading && !config && (
          <div className="flex items-center justify-center py-12">
            <Loader className="animate-spin text-[#2D5A27]" size={32} />
          </div>
        )}

        {/* Tab: Configuração */}
        {tab === 'config' && (
          <div className="bg-white rounded-2xl border border-[#E0E0E0] p-6 space-y-6">
            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-[#333] mb-3">Logo da empresa (opcional)</label>
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-[#E0E0E0] flex items-center justify-center bg-[#F8F9FA] overflow-hidden">
                  {(logoPreview || config?.logo_url) ? (
                    <img src={logoPreview || config?.logo_url || ''} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <p className="text-xs text-[#999]">Logo</p>
                  )}
                </div>
                <div>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-[#2D5A27] text-[#2D5A27] rounded-xl hover:bg-[#2D5A27]/5 transition-colors">
                    {uploadingLogo ? <><Loader size={16} className="animate-spin" /> Enviando…</> : (config?.logo_url ? 'Alterar logo' : 'Enviar logo')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-[#666] mt-2">PNG ou JPEG, até 5MB. Salve a configuração antes de subir.</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#333] mb-2">Slug (URL pública) *</label>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="meu-webinar"
                className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              />
              <p className="text-xs text-[#666] mt-1">
                Exemplo: {window.location.origin}/webinar/<strong>{slug || 'meu-webinar'}</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#333] mb-2">Título</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Webinar"
                className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#333] mb-2">Descrição (opcional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Descreva o webinar…"
                rows={3}
                className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              />
            </div>

            <div className="flex items-center gap-3 p-4 bg-[#F5F5F5] rounded-xl">
              <input
                type="checkbox"
                id="webinar-active"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-5 h-5 text-[#2D5A27] rounded focus:ring-[#2D5A27]"
              />
              <label htmlFor="webinar-active" className="text-sm text-[#333] font-medium">
                Ativar página pública
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="flex-1 bg-[#2D5A27] text-white px-6 py-3 rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50 font-medium"
              >
                {saving ? 'Salvando…' : 'Salvar Configuração'}
              </button>
              {publicLink && (
                <button
                  onClick={copyLink}
                  className="flex items-center gap-2 px-6 py-3 border border-[#2D5A27] text-[#2D5A27] rounded-xl hover:bg-[#2D5A27] hover:text-white transition-colors"
                >
                  {linkCopied ? <Check size={20} /> : <Copy size={20} />}
                  {linkCopied ? 'Copiado!' : 'Copiar Link'}
                </button>
              )}
            </div>

            {publicLink && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <LinkIcon className="text-green-600 mt-1" size={20} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900 mb-1">Link Público</p>
                    <a
                      href={publicLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-700 hover:underline flex items-center gap-1"
                    >
                      {publicLink}
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Sessões */}
        {tab === 'sessions' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-[#E0E0E0] p-4">
              <h3 className="font-semibold text-[#333] mb-3">Nova sessão</h3>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs text-[#666] mb-1">Data e hora</label>
                  <input
                    type="datetime-local"
                    value={newSessionAt}
                    onChange={e => setNewSessionAt(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#666] mb-1">Link do webinar</label>
                  <input
                    type="url"
                    value={newSessionLink}
                    onChange={e => setNewSessionLink(e.target.value)}
                    placeholder="https://zoom.us/j/123…"
                    className="w-full px-3 py-2 border border-[#E0E0E0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                  />
                </div>
                <button
                  onClick={handleCreateSession}
                  disabled={creatingSession || !config}
                  className="flex items-center gap-2 bg-[#2D5A27] text-white px-4 py-2 rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50"
                  title={!config ? 'Salve a configuração primeiro' : undefined}
                >
                  <Plus size={16} />
                  {creatingSession ? 'Criando…' : 'Adicionar'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E0E0E0] overflow-hidden">
              <div className="p-4 border-b border-[#E0E0E0]">
                <h3 className="font-semibold text-[#333]">Sessões ({sessions.length})</h3>
              </div>
              {sessions.length === 0 ? (
                <div className="p-8 text-center text-[#666]">
                  <Calendar size={48} className="mx-auto mb-3 opacity-30" />
                  <p>Nenhuma sessão criada ainda</p>
                </div>
              ) : (
                <div className="divide-y divide-[#E0E0E0]">
                  {sessions.map(s => (
                    <div key={s.id} className="p-4 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar size={16} className="text-[#2D5A27] shrink-0" />
                          <p className="font-medium text-[#333]">{formatPretty(s.scheduled_at)}</p>
                          {!s.is_active && (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">Inativa</span>
                          )}
                        </div>
                        <a
                          href={s.webinar_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#666] hover:text-[#2D5A27] hover:underline truncate inline-flex items-center gap-1 max-w-full"
                        >
                          {s.webinar_link}
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleSession(s)}
                          className="p-2 rounded-lg border border-[#E0E0E0] text-[#666] hover:bg-[#F5F5F5]"
                          title={s.is_active ? 'Desativar' : 'Ativar'}
                        >
                          {s.is_active ? <Power size={16} /> : <PowerOff size={16} />}
                        </button>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          className="p-2 rounded-lg border border-[#E0E0E0] text-[#999] hover:bg-[#F5F5F5] hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Inscrições */}
        {tab === 'registrations' && (
          <div className="bg-white rounded-2xl border border-[#E0E0E0] overflow-hidden">
            <div className="p-4 border-b border-[#E0E0E0]">
              <h3 className="font-semibold text-[#333]">Inscrições ({registrations.length})</h3>
              <p className="text-xs text-[#666] mt-0.5">Últimas 500</p>
            </div>
            {registrations.length === 0 ? (
              <div className="p-8 text-center text-[#666]">
                <Users size={48} className="mx-auto mb-3 opacity-30" />
                <p>Nenhuma inscrição ainda</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8F9FA] text-xs text-[#666] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2">Inscrito em</th>
                      <th className="text-left px-4 py-2">Nome</th>
                      <th className="text-left px-4 py-2">E-mail</th>
                      <th className="text-left px-4 py-2">Telefone</th>
                      <th className="text-left px-4 py-2">Webinar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {registrations.map(r => (
                      <tr key={r.id} className="hover:bg-[#FAFAFA]">
                        <td className="px-4 py-2 text-[#666] whitespace-nowrap">
                          {new Date(r.registered_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2 font-medium text-[#333]">{r.guest_name}</td>
                        <td className="px-4 py-2 text-[#333]">{r.guest_email}</td>
                        <td className="px-4 py-2 text-[#666]">{r.guest_phone ?? '—'}</td>
                        <td className="px-4 py-2 text-[#666] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={12} />
                            {formatPretty(r.webinar_sessions.scheduled_at)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notificação */}
      {notif && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border min-w-[300px] ${
            notif.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            {notif.type === 'success'
              ? <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              : <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />}
            <p className={`text-sm font-medium ${notif.type === 'success' ? 'text-green-900' : 'text-red-900'}`}>
              {notif.message}
            </p>
          </div>
        </div>
      )}
    </MainLayout>
  )
}

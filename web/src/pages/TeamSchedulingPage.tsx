// ============================================================
// TeamSchedulingPage.tsx
// Página de gerenciamento de agendamento do time (Round Robin)
// APENAS PARA ADMINS (owners e admins)
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar,
  Clock,
  Users,
  Link as LinkIcon,
  Settings,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  Loader,
  ChevronLeft,
  Plus,
  Trash2,
  Power,
  PowerOff,
  ExternalLink,
  AlertCircle,
  Info
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface Team {
  id: string
  name: string
  owner_id: string
  isOwner?: boolean
}

interface SchedulingConfig {
  id: string
  team_id: string
  slug: string
  is_active: boolean
  title: string
  description: string | null
  meeting_duration_minutes: number
  working_hours: Record<string, any>
  buffer_before_minutes: number
  buffer_after_minutes: number
  min_notice_hours: number
  max_days_advance: number
  current_rotation_index: number
  logo_url: string | null
}

interface SchedulingMember {
  id: string
  user_id: string
  name: string
  email: string
  is_active: boolean
  rotation_order: number
  total_bookings: number
  last_booking_at: string | null
}

interface Booking {
  id: string
  guest_name: string
  guest_email: string
  guest_phone: string | null
  scheduled_start: string
  scheduled_end: string
  status: string
  assigned_to_name: string
  created_at: string
}

export function TeamSchedulingPage() {
  const navigate = useNavigate()
  const { teamId } = useParams<{ teamId: string }>()
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<Team | null>(null)
  const [config, setConfig] = useState<SchedulingConfig | null>(null)
  const [members, setMembers] = useState<SchedulingMember[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [tab, setTab] = useState<'config' | 'members' | 'bookings'>('config')

  // Config form
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('Agendar reunião')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(30)
  const [isActive, setIsActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  // Team members disponíveis
  const [availableMembers, setAvailableMembers] = useState<any[]>([])
  const [addingMember, setAddingMember] = useState(false)

  // Sistema de notificações interno
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
  } | null>(null)
  
  // Modal de confirmação
  const [confirmModal, setConfirmModal] = useState<{
    message: string
    onConfirm: () => void
  } | null>(null)

  const showNotification = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 5000)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
  }, [])

  const loadTeam = useCallback(async () => {
    if (!session || !teamId) return

    try {
      const response = await fetch(`${API}/api/teams/${teamId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!response.ok) {
        if (response.status === 403) {
          showNotification('error', 'Acesso negado. Apenas admins podem acessar esta página.')
          navigate('/teams')
          return
        }
        throw new Error('Erro ao carregar time')
      }

      const data = await response.json()
      setTeam(data.team)

      // Carrega membros disponíveis com informação de calendário
      const membersResponse = await fetch(
        `${API}/api/scheduling/teams/${teamId}/available-members`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      
      if (membersResponse.ok) {
        const membersData = await membersResponse.json()
        setAvailableMembers(membersData.members || [])
      }
    } catch (err) {
      console.error(err)
    }
  }, [session, teamId, navigate])

  const loadConfig = useCallback(async () => {
    if (!session || !teamId) return

    try {
      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/config`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!response.ok) throw new Error('Erro ao carregar configuração')

      const data = await response.json()
      if (data.config) {
        setConfig(data.config)
        setSlug(data.config.slug)
        setTitle(data.config.title)
        setDescription(data.config.description || '')
        setDuration(data.config.meeting_duration_minutes)
        setIsActive(data.config.is_active)
      }
    } catch (err) {
      console.error(err)
    }
  }, [session, teamId])

  const loadMembers = useCallback(async () => {
    if (!session || !teamId) return

    try {
      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/members`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!response.ok) throw new Error('Erro ao carregar membros')

      const data = await response.json()
      setMembers(data.members || [])
    } catch (err) {
      console.error(err)
    }
  }, [session, teamId])

  /**
   * Cancela o agendamento. O backend também remove o evento da agenda do
   * atendente — sem isso o horário ficava bloqueado pra sempre, porque o evento
   * no Google continuava lá mesmo com a reserva cancelada.
   */
  const cancelBooking = async (bookingId: string) => {
    if (!session) return
    try {
      const response = await fetch(`${API}/api/scheduling/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || 'Erro ao cancelar agendamento')
      }
      await loadBookings()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Erro ao cancelar agendamento')
    }
  }

  const loadBookings = useCallback(async () => {
    if (!session || !teamId) return

    try {
      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/bookings`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!response.ok) throw new Error('Erro ao carregar agendamentos')

      const data = await response.json()
      setBookings(data.bookings || [])
    } catch (err) {
      console.error(err)
    }
  }, [session, teamId])

  useEffect(() => {
    const loadAll = async () => {
      if (!session || !teamId) return
      
      setLoading(true)
      await Promise.all([
        loadTeam(),
        loadConfig(),
        loadMembers(),
        loadBookings()
      ])
      setLoading(false)
    }

    loadAll()
  }, [session, teamId, loadTeam, loadConfig, loadMembers, loadBookings])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validar tamanho (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showNotification('error', 'Arquivo muito grande. Máximo 5MB.')
      return
    }

    // Validar tipo
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      showNotification('error', 'Apenas PNG e JPEG são permitidos.')
      return
    }

    setUploadingLogo(true)

    try {
      // Preview local
      const reader = new FileReader()
      reader.onload = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)

      // Upload
      const formData = new FormData()
      formData.append('logo', file)

      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/config/logo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        body: formData
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Erro ao fazer upload')
      }

      // Atualiza config
      if (config) {
        setConfig({ ...config, logo_url: data.logo_url })
      }
      
      // Logo atualizado silenciosamente (visual feedback é suficiente)
    } catch (error: any) {
      console.error('Erro ao fazer upload do logo:', error)
      showNotification('error', 'Erro ao fazer upload: ' + error.message)
      setLogoPreview(null)
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSaveConfig = async () => {
    if (!slug.trim()) {
      showNotification('error', 'Slug é obrigatório')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          slug,
          title,
          description,
          meeting_duration_minutes: duration,
          is_active: isActive
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Erro ao salvar')
      }

      const data = await response.json()
      setConfig(data.config)
      showNotification('success', 'Configuração salva com sucesso!')
    } catch (err: any) {
      showNotification('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddMember = async (userId: string) => {
    setAddingMember(true)
    try {
      const response = await fetch(`${API}/api/scheduling/teams/${teamId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ user_id: userId })
      })

      if (!response.ok) {
        const error = await response.json()
        
        // Verifica se o erro é por falta de integração do calendário
        if (error.needsCalendar) {
          showNotification(
            'warning',
            error.message + ' Peça para o membro conectar o Google Calendar em: Menu → Integrações → Google Calendar'
          )
        } else {
          throw new Error(error.message || 'Erro ao adicionar')
        }
        return
      }

      await loadMembers()
    } catch (err: any) {
      showNotification('error', err.message)
    } finally {
      setAddingMember(false)
    }
  }

  const handleToggleMember = async (memberId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(
        `${API}/api/scheduling/teams/${teamId}/members/${memberId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ is_active: !currentStatus })
        }
      )

      if (!response.ok) throw new Error('Erro ao atualizar')

      await loadMembers()
    } catch (err: any) {
      showNotification('error', err.message)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    setConfirmModal({
      message: 'Tem certeza que deseja remover este membro?',
      onConfirm: () => confirmRemoveMember(memberId)
    })
  }

  const confirmRemoveMember = async (memberId: string) => {
    setConfirmModal(null)

    try {
      const response = await fetch(
        `${API}/api/scheduling/teams/${teamId}/members/${memberId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` }
        }
      )

      if (!response.ok) throw new Error('Erro ao remover')

      await loadMembers()
    } catch (err: any) {
      showNotification('error', err.message)
    }
  }

  const copyLink = () => {
    const link = `${window.location.origin}/agenda/${slug}`
    navigator.clipboard.writeText(link)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader className="animate-spin text-brand" size={32} />
        </div>
      </MainLayout>
    )
  }

  if (!team) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <p className="text-secondary">Time não encontrado</p>
        </div>
      </MainLayout>
    )
  }

  const publicLink = config ? `${window.location.origin}/agenda/${slug}` : null

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/teams/${teamId}`)}
            className="flex items-center gap-2 text-secondary hover:text-brand mb-4"
          >
            <ChevronLeft size={20} />
            Voltar para o time
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-brand mb-1">
                Agendamento do Time
              </h1>
              <p className="text-secondary">{team.name}</p>
            </div>

            {config && (
              <div className="flex items-center gap-3">
                <span
                  className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                    isActive
                      ? 'bg-green-100 text-green-700 dark:text-green-300'
                      : 'bg-neutral-lighter text-secondary'
                  }`}
                >
                  {isActive ? (
                    <>
                      <CheckCircle size={16} /> Ativo
                    </>
                  ) : (
                    <>
                      <XCircle size={16} /> Inativo
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-neutral-light">
          {[
            { key: 'config', label: 'Configuração', icon: Settings },
            { key: 'members', label: 'Membros', icon: Users },
            { key: 'bookings', label: 'Agendamentos', icon: Calendar }
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                tab === key
                  ? 'border-[#2D5A27] text-brand font-medium'
                  : 'border-transparent text-secondary hover:text-brand'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab: Configuração */}
        {tab === 'config' && (
          <div className="bg-surface rounded-2xl border border-neutral-light p-6 space-y-6">
            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-primary mb-3">
                Logo da empresa (opcional)
              </label>
              <div className="flex items-center gap-6">
                {/* Preview */}
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-neutral-light flex items-center justify-center bg-background overflow-hidden">
                  {(logoPreview || config?.logo_url) ? (
                    <img 
                      src={logoPreview || config?.logo_url || ''} 
                      alt="Logo" 
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-2">
                      <p className="text-xs text-tertiary">Logo</p>
                    </div>
                  )}
                </div>

                {/* Upload button */}
                <div>
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-[#2D5A27] text-brand rounded-xl hover:bg-[#2D5A27]/5 transition-colors">
                    {uploadingLogo ? (
                      <>
                        <Loader size={16} className="animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        {config?.logo_url ? 'Alterar logo' : 'Enviar logo'}
                      </>
                    )}
                    <input 
                      type="file" 
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-secondary mt-2">PNG ou JPEG, até 5MB</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-primary mb-2">
                Slug (URL pública) *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="meu-time"
                  className="flex-1 px-4 py-2 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
                />
              </div>
              <p className="text-xs text-secondary mt-1">
                Exemplo: {window.location.origin}/agenda/<strong>{slug || 'meu-time'}</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-primary mb-2">
                Título da página
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Agendar reunião"
                className="w-full px-4 py-2 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-primary mb-2">
                Descrição (opcional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o tipo de reunião..."
                rows={3}
                className="w-full px-4 py-2 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-primary mb-2">
                Duração da reunião (minutos)
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full px-4 py-2 border border-neutral-light rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]"
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>

            <div className="flex items-center gap-3 p-4 bg-neutral-lighter rounded-xl">
              <input
                type="checkbox"
                id="is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-5 h-5 text-brand rounded focus:ring-[#2D5A27]"
              />
              <label htmlFor="is-active" className="text-sm text-primary font-medium">
                Ativar agendamento público
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="flex-1 bg-[#2D5A27] text-white px-6 py-3 rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50 font-medium"
              >
                {saving ? 'Salvando...' : 'Salvar Configuração'}
              </button>

              {publicLink && (
                <button
                  onClick={copyLink}
                  className="flex items-center gap-2 px-6 py-3 border border-[#2D5A27] text-brand rounded-xl hover:bg-[#2D5A27] hover:text-white transition-colors"
                >
                  {linkCopied ? <Check size={20} /> : <Copy size={20} />}
                  {linkCopied ? 'Copiado!' : 'Copiar Link'}
                </button>
              )}
            </div>

            {publicLink && (
              <div className="p-4 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/50 rounded-xl">
                <div className="flex items-start gap-3">
                  <LinkIcon className="text-green-600 mt-1" size={20} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900 mb-1">
                      Link Público Ativo
                    </p>
                    <a
                      href={publicLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-700 dark:text-green-300 hover:underline flex items-center gap-1"
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

        {/* Tab: Membros */}
        {tab === 'members' && (
          <div className="space-y-4">
            {/* Lista de membros */}
            <div className="bg-surface rounded-2xl border border-neutral-light overflow-hidden">
              <div className="p-4 border-b border-neutral-light">
                <h3 className="font-semibold text-primary">
                  Membros na Rotação ({members.length})
                </h3>
                <p className="text-sm text-secondary mt-1">
                  Apenas membros ativos receberão agendamentos
                </p>
              </div>

              {members.length === 0 ? (
                <div className="p-8 text-center text-secondary">
                  <Users size={48} className="mx-auto mb-3 opacity-30" />
                  <p>Nenhum membro adicionado ainda</p>
                </div>
              ) : (
                <div className="divide-y divide-[#E0E0E0]">
                  {members.map((member) => (
                    <div key={member.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                            member.is_active
                              ? 'bg-[#2D5A27] text-white'
                              : 'bg-neutral-lighter text-secondary'
                          }`}
                        >
                          {member.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="font-medium text-primary">{member.name}</p>
                          <p className="text-sm text-secondary">{member.email}</p>
                          <p className="text-xs text-tertiary mt-1">
                            {member.total_bookings} agendamentos
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleMember(member.id, member.is_active)}
                          className={`p-2 rounded-lg border transition-colors ${
                            member.is_active
                              ? 'border-neutral-light text-secondary hover:bg-neutral-lighter'
                              : 'border-neutral-light text-tertiary hover:bg-neutral-lighter'
                          }`}
                          title={member.is_active ? 'Desativar' : 'Ativar'}
                        >
                          {member.is_active ? <Power size={16} /> : <PowerOff size={16} />}
                        </button>

                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 rounded-lg border border-neutral-light text-tertiary hover:bg-neutral-lighter hover:text-secondary transition-colors"
                          title="Remover"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Adicionar membro */}
            <div className="bg-surface rounded-2xl border border-neutral-light p-4">
              <h3 className="font-semibold text-primary mb-3">Adicionar Membro</h3>
              <div className="space-y-2">
                {availableMembers
                  .filter((m) => !members.some((sm) => sm.user_id === m.user_id))
                  .map((member) => (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between p-3 bg-neutral-lighter rounded-xl"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        {/* Indicador de calendário */}
                        {member.has_calendar ? (
                          <div
                            className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"
                            title="Google Calendar conectado"
                          >
                            <Calendar size={12} className="text-green-600" />
                          </div>
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0"
                            title="Google Calendar não conectado"
                          >
                            <Calendar size={12} className="text-red-600" />
                          </div>
                        )}
                        <span className="text-sm text-primary">{member.name}</span>
                      </div>
                      
                      {member.has_calendar ? (
                        <button
                          onClick={() => handleAddMember(member.user_id)}
                          disabled={addingMember}
                          className="flex items-center gap-2 px-3 py-1 bg-[#2D5A27] text-white text-sm rounded-lg hover:bg-[#234520] transition-colors disabled:opacity-50"
                        >
                          <Plus size={16} />
                          Adicionar
                        </button>
                      ) : (
                        <div className="text-xs text-red-600 max-w-[200px] text-right">
                          Sem calendário conectado
                        </div>
                      )}
                    </div>
                  ))}

                {availableMembers.filter((m) => !members.some((sm) => sm.user_id === m.user_id))
                  .length === 0 && (
                  <p className="text-sm text-secondary text-center py-4">
                    Todos os membros do time já estão na rotação
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Agendamentos */}
        {tab === 'bookings' && (
          <div className="bg-surface rounded-2xl border border-neutral-light overflow-hidden">
            <div className="p-4 border-b border-neutral-light">
              <h3 className="font-semibold text-primary">
                Agendamentos ({bookings.length})
              </h3>
            </div>

            {bookings.length === 0 ? (
              <div className="p-8 text-center text-secondary">
                <Calendar size={48} className="mx-auto mb-3 opacity-30" />
                <p>Nenhum agendamento ainda</p>
              </div>
            ) : (
              <div className="divide-y divide-[#E0E0E0]">
                {bookings.map((booking) => (
                  <div key={booking.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-primary">{booking.guest_name}</p>
                        <p className="text-sm text-secondary">{booking.guest_email}</p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          booking.status === 'confirmed'
                            ? 'bg-green-100 text-green-700 dark:text-green-300'
                            : booking.status === 'cancelled'
                            ? 'bg-red-100 text-red-700 dark:text-red-300'
                            : 'bg-neutral-lighter text-secondary'
                        }`}
                      >
                        {booking.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-secondary">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {new Date(booking.scheduled_start).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {new Date(booking.scheduled_start).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={14} />
                        {booking.assigned_to_name}
                      </span>
                      {booking.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => setConfirmModal({
                            message: `Cancelar o agendamento de ${booking.guest_name}? O evento também será removido da agenda de ${booking.assigned_to_name}.`,
                            onConfirm: () => cancelBooking(booking.id),
                          })}
                          className="ml-auto text-red-600 hover:text-red-700 font-medium"
                        >
                          Cancelar agendamento
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sistema de Notificações */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4">
          <div
            className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border min-w-[300px] max-w-md ${
              notification.type === 'success'
                ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900/50'
                : notification.type === 'error'
                ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50'
                : notification.type === 'warning'
                ? 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-900/50'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/50'
            }`}
          >
            <div className="flex-shrink-0 mt-0.5">
              {notification.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : notification.type === 'error' ? (
                <XCircle className="w-5 h-5 text-red-600" />
              ) : notification.type === 'warning' ? (
                <AlertCircle className="w-5 h-5 text-yellow-600" />
              ) : (
                <Info className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  notification.type === 'success'
                    ? 'text-green-900'
                    : notification.type === 'error'
                    ? 'text-red-900'
                    : notification.type === 'warning'
                    ? 'text-yellow-900'
                    : 'text-blue-900'
                }`}
              >
                {notification.message}
              </p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="flex-shrink-0 text-tertiary hover:text-secondary"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmação */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-semibold text-primary mb-3">
              Confirmação
            </h3>
            <p className="text-secondary mb-6">{confirmModal.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg border border-neutral-light text-primary font-medium hover:bg-neutral-lighter transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm()
                  setConfirmModal(null)
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  )
}

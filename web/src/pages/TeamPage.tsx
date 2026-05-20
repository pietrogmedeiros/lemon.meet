import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Users, Plus, Trash2, CheckCircle, Clock,
  AlertCircle, Loader, Video, Crown, UserPlus, ChevronRight,
  Shield, Link2, Copy, Check, Sparkles, X
} from 'lucide-react'
import { formatDate } from '@/lib'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface Member {
  id: string
  user_id: string | null
  invited_email: string
  name: string | null
  role: 'admin' | 'member'
  status: 'active' | 'invited'
  created_at: string
}

interface Team {
  id: string
  name: string
  owner_id: string
  isOwner?: boolean
  team_type?: 'sales' | 'customer_success'
  evaluation_framework?: 'bant' | 'spin'
  custom_prompt_instructions?: string | null
}

interface TeamMeeting {
  id: string
  title: string | null
  platform: string | null
  status: string | null
  started_at: string | null
  duration_seconds: number | null
  member_name: string
  user_id: string
}

async function apiFetch(path: string, session: any, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...(options?.headers ?? {}),
    },
  })
  return res.json()
}

export function TeamPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<any>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [teamLoading, setTeamLoading] = useState(false)
  const [tab, setTab] = useState<'members' | 'meetings'>('members')

  // Criar time
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [createTeamType, setCreateTeamType] = useState<'sales' | 'customer_success'>('sales')
  const [createTeamFramework, setCreateTeamFramework] = useState<'bant' | 'spin'>('bant')
  const [createTeamInstructions, setCreateTeamInstructions] = useState('')
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [createError, setCreateError] = useState('')

  const openCreateTeamModal = () => {
    setTeamName('')
    setCreateTeamType('sales')
    setCreateTeamFramework('bant')
    setCreateTeamInstructions('')
    setCreateError('')
    setCreateStatus('idle')
    setShowCreateTeamModal(true)
  }

  // Meetings do time
  const [meetings, setMeetings] = useState<TeamMeeting[]>([])
  const [meetingsLoading, setMeetingsLoading] = useState(false)

  // Remover membro
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)

  // Alterar papel
  const [promotingMember, setPromotingMember] = useState<string | null>(null)

  // Config de avaliação por IA
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configForm, setConfigForm] = useState<{
    team_type: 'sales' | 'customer_success'
    evaluation_framework: 'bant' | 'spin'
    custom_prompt_instructions: string
  }>({ team_type: 'sales', evaluation_framework: 'bant', custom_prompt_instructions: '' })
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')

  // Link de convite
  const [showInviteLinkModal, setShowInviteLinkModal] = useState(false)
  const [inviteLink, setInviteLink] = useState<{
    url: string
    token: string
    expiresAt: string
    currentUses: number
    maxUses: number | null
  } | null>(null)
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
  }, [])

  // Carregar lista de times
  const loadTeams = useCallback(async () => {
    if (!session) {
      console.log('[TeamPage] ⚠️ Sem sessão, não pode carregar times')
      return
    }
    console.log('[TeamPage] 🔄 Carregando times para user:', session.user.id)
    setLoading(true)
    try {
      const data = await apiFetch('/api/teams', session)
      console.log('[TeamPage] 📦 Resposta da API:', JSON.stringify(data, null, 2))
      console.log('[TeamPage] 📊 Times encontrados:', data.teams?.length ?? 0)
      
      const loadedTeams = data.teams ?? []
      const activeOwnerTeamId = data.activeOwnerTeamId ?? null
      setTeams(loadedTeams)
      
      if (loadedTeams.length === 0) {
        console.log('[TeamPage] ⚠️ Nenhum time encontrado para este usuário')
      }
      
      // Seleciona o primeiro time por padrão se ainda não há nenhum selecionado
      if (loadedTeams.length > 0) {
        setSelectedTeamId(prev => {
          if (prev && loadedTeams.some((team: Team) => team.id === prev)) {
            return prev
          }

          if (activeOwnerTeamId && loadedTeams.some((team: Team) => team.id === activeOwnerTeamId)) {
            console.log('[TeamPage] ✅ Restaurando time ativo do owner:', activeOwnerTeamId)
            return activeOwnerTeamId
          }

          console.log('[TeamPage] ✅ Selecionando primeiro time:', loadedTeams[0].id, loadedTeams[0].name)
          return loadedTeams[0].id
        })
      } else {
        setSelectedTeamId(null)
      }
    } catch (err) {
      console.error('[TeamPage] ❌ Erro ao carregar times:', err)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    const persistActiveOwnerTeam = async () => {
      if (!session || !selectedTeamId) return

      const selectedTeam = teams.find(team => team.id === selectedTeamId)
      if (!selectedTeam?.isOwner) return

      try {
        const data = await apiFetch('/api/teams/active', session, {
          method: 'POST',
          body: JSON.stringify({ teamId: selectedTeamId }),
        })

        if (!data.success) {
          console.warn('[TeamPage] ⚠️ Não foi possível persistir time ativo:', data.message)
        }
      } catch (err) {
        console.error('[TeamPage] ❌ Erro ao persistir time ativo:', err)
      }
    }

    persistActiveOwnerTeam()
  }, [selectedTeamId, session, teams])

  // Detecta quando retorna de um convite aceito e força reload TOTAL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('joined') === 'true') {
      console.log('[TeamPage] 🎉 Detectado join recente!')
      // Remove o parâmetro da URL
      window.history.replaceState({}, '', '/team')
      // FORÇA reload completo da página para garantir que cache foi limpo
      if (session) {
        console.log('[TeamPage] 🔄 Sessão disponível, forçando reload dos times')
        setTimeout(() => {
          loadTeams()
        }, 500)
      } else {
        console.log('[TeamPage] ⏳ Aguardando sessão ficar disponível...')
        // Aguarda sessão ficar disponível
        const checkSession = setInterval(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s) {
              console.log('[TeamPage] ✅ Sessão disponível agora, carregando times')
              setSession(s)
              clearInterval(checkSession)
            }
          })
        }, 500)
        // Timeout de 10 segundos
        setTimeout(() => clearInterval(checkSession), 10000)
      }
    }
  }, [session, loadTeams])

  // Recarrega times quando a janela volta ao foco (usuário volta da aba do convite)
  useEffect(() => {
    const handleFocus = () => {
      if (session) {
        console.log('[TeamPage] Janela voltou ao foco, recarregando times')
        loadTeams()
      }
    }
    
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [session, loadTeams])

  // Carregar detalhes de um time específico
  const loadTeamDetails = useCallback(async (teamId: string) => {
    if (!session || !teamId) return
    setTeamLoading(true)
    try {
      const data = await apiFetch(`/api/teams/${teamId}`, session)
      setTeam(data.team ?? null)
      setMembers(data.members ?? [])
      setIsOwner(data.isOwner ?? false)
    } finally {
      setTeamLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (session) loadTeams()
  }, [session, loadTeams])

  useEffect(() => {
    if (selectedTeamId) {
      loadTeamDetails(selectedTeamId)
    }
  }, [selectedTeamId, loadTeamDetails])

  const loadMeetings = useCallback(async () => {
    if (!team || !session) return
    setMeetingsLoading(true)
    try {
      const data = await apiFetch(`/api/teams/${team.id}/meetings`, session)
      setMeetings(data.meetings ?? [])
    } finally {
      setMeetingsLoading(false)
    }
  }, [team, session])

  useEffect(() => {
    if (tab === 'meetings') loadMeetings()
  }, [tab, loadMeetings])

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return
    setCreateError('')
    setCreateStatus('loading')
    try {
      const payload: Record<string, unknown> = {
        name: teamName.trim(),
        team_type: createTeamType,
        custom_prompt_instructions: createTeamInstructions.trim() || null,
      }
      // evaluation_framework só é relevante quando team_type='sales'
      if (createTeamType === 'sales') {
        payload.evaluation_framework = createTeamFramework
      }

      const data = await apiFetch('/api/teams', session, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!data.success) throw new Error(data.message)
      setShowCreateTeamModal(false)
      setTeamName('')
      setCreateTeamInstructions('')
      await loadTeams()
      // Seleciona o time recém-criado
      if (data.team) {
        setSelectedTeamId(data.team.id)
      }
    } catch (err: any) {
      setCreateError(err.message ?? 'Erro ao criar time.')
      setCreateStatus('error')
    } finally {
      setCreateStatus('idle')
    }
  }

  const handleRoleChange = async (memberId: string, newRole: 'admin' | 'member') => {
    if (!team) return
    setPromotingMember(memberId)
    try {
      const data = await apiFetch(
        `/api/teams/${team.id}/members/${memberId}/role`,
        session,
        { method: 'PATCH', body: JSON.stringify({ role: newRole }) }
      )
      if (!data.success) throw new Error(data.message)
      await loadTeamDetails(team.id)
    } catch (err: any) {
      alert(err.message ?? 'Erro ao alterar papel.')
    } finally {
      setPromotingMember(null)
    }
  }

  const handleRemove = async (email: string) => {
    if (!team) return
    if (!window.confirm(`Remover ${email} do time?`)) return
    setRemovingEmail(email)
    try {
      await apiFetch(`/api/teams/${team.id}/members/${encodeURIComponent(email)}`, session, {
        method: 'DELETE',
      })
      await loadTeamDetails(team.id)
    } finally {
      setRemovingEmail(null)
    }
  }

  const handleGenerateInviteLink = async () => {
    if (!team) return
    setInviteLinkLoading(true)
    try {
      const data = await apiFetch(`/api/teams/${team.id}/invite-link`, session, {
        method: 'POST',
        body: JSON.stringify({ expiresInDays: 7 })
      })
      if (!data.success) throw new Error(data.message)
      setInviteLink(data.link)
      setShowInviteLinkModal(true)
    } catch (err: any) {
      alert(err.message ?? 'Erro ao gerar link de convite')
    } finally {
      setInviteLinkLoading(false)
    }
  }

  const handleCopyLink = () => {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink.url)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const handleOpenConfigModal = () => {
    if (!team) return
    setConfigForm({
      team_type: team.team_type ?? 'sales',
      evaluation_framework: team.evaluation_framework ?? 'bant',
      custom_prompt_instructions: team.custom_prompt_instructions ?? '',
    })
    setConfigError('')
    setShowConfigModal(true)
  }

  const handleSaveConfig = async () => {
    if (!team) return
    setConfigSaving(true)
    setConfigError('')
    try {
      const payload: Record<string, unknown> = {
        team_type: configForm.team_type,
        custom_prompt_instructions: configForm.custom_prompt_instructions.trim() || null,
      }
      // evaluation_framework só é relevante quando team_type='sales'
      if (configForm.team_type === 'sales') {
        payload.evaluation_framework = configForm.evaluation_framework
      }

      const data = await apiFetch(`/api/teams/${team.id}/evaluation-config`, session, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      if (!data.success) throw new Error(data.message ?? 'Erro ao salvar configuração')

      setTeam(prev => prev ? {
        ...prev,
        team_type: data.team.team_type,
        evaluation_framework: data.team.evaluation_framework,
        custom_prompt_instructions: data.team.custom_prompt_instructions,
      } : prev)
      setShowConfigModal(false)
    } catch (err: any) {
      setConfigError(err.message ?? 'Erro ao salvar')
    } finally {
      setConfigSaving(false)
    }
  }

  const formatDuration = (s: number | null) => {
    if (!s) return '0m'
    const m = Math.floor(s / 60)
    return `${m}m`
  }

  const renderCreateTeamModal = () => {
    if (!showCreateTeamModal) return null
    const isLoading = createStatus === 'loading'
    return (
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => !isLoading && setShowCreateTeamModal(false)}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#333333]">Criar novo time</h3>
              <p className="text-sm text-[#666666] mt-1">
                Defina o tipo do time e como a IA deve avaliar as reuniões
              </p>
            </div>
            <button
              onClick={() => !isLoading && setShowCreateTeamModal(false)}
              className="text-[#999999] hover:text-[#333333] transition"
              disabled={isLoading}
            >
              <X size={20} />
            </button>
          </div>

          {/* Nome do time */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
              Nome do time
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Ex: Time Comercial"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-white placeholder:text-[#999]"
            />
          </div>

          {/* Tipo do time */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
              Tipo do time
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'sales' as const, label: 'Sales', desc: 'Reuniões comerciais (prospecção, qualificação, fechamento)' },
                { value: 'customer_success' as const, label: 'Customer Success', desc: 'Reuniões com clientes ativos (health, retenção, expansão)' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCreateTeamType(opt.value)}
                  className={`text-left p-3 rounded-xl border-2 transition ${
                    createTeamType === opt.value
                      ? 'border-[#2D5A27] bg-[#2D5A27]/5'
                      : 'border-[#E0E0E0] hover:border-[#CCCCCC]'
                  }`}
                >
                  <div className="text-sm font-semibold text-[#333333]">{opt.label}</div>
                  <div className="text-xs text-[#666666] mt-1 leading-relaxed">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Framework (só Sales) */}
          {createTeamType === 'sales' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Framework de avaliação
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'bant' as const, label: 'BANT', desc: 'Budget, Authority, Need, Timeline' },
                  { value: 'spin' as const, label: 'SPIN Selling', desc: 'Situation, Problem, Implication, Need-payoff' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCreateTeamFramework(opt.value)}
                    className={`text-left p-3 rounded-xl border-2 transition ${
                      createTeamFramework === opt.value
                        ? 'border-[#2D5A27] bg-[#2D5A27]/5'
                        : 'border-[#E0E0E0] hover:border-[#CCCCCC]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-[#333333]">{opt.label}</div>
                    <div className="text-xs text-[#666666] mt-1 leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Instruções customizadas */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
              Instruções customizadas (opcional)
            </label>
            <p className="text-xs text-[#666666] leading-relaxed">
              Instruções adicionais para a IA. Contextualize seu ICP, tom desejado, sinais específicos a observar, etc.
            </p>
            <textarea
              value={createTeamInstructions}
              onChange={(e) => setCreateTeamInstructions(e.target.value)}
              placeholder="Você pode preencher depois, se preferir."
              maxLength={4000}
              rows={4}
              className="w-full text-sm text-[#333333] bg-[#F8F9FA] border border-[#E0E0E0] rounded-xl p-3 focus:outline-none focus:border-[#2D5A27] resize-y"
            />
            <div className="text-xs text-[#999999] text-right">
              {createTeamInstructions.length} / 4000
            </div>
          </div>

          {/* Erro */}
          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-[#DC3545] shrink-0 mt-0.5" />
              <p className="text-xs text-[#DC3545] leading-relaxed">{createError}</p>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateTeamModal(false)}
              disabled={isLoading}
              className="flex-1 py-2.5 rounded-xl border border-[#E0E0E0] text-sm font-semibold text-[#666666] hover:bg-[#F8F9FA] transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateTeam}
              disabled={isLoading || !teamName.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50"
            >
              {isLoading ? <Loader size={15} className="animate-spin" /> : <Plus size={15} />}
              Criar time
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-32">
          <Loader size={28} className="animate-spin text-[#2D5A27]" />
        </div>
      </MainLayout>
    )
  }

  // ── Sem time → formulário de criação ─────────────────────────
  if (!loading && teams.length === 0) {
    return (
      <MainLayout>
        <div className="max-w-lg mx-auto mt-20">
          {/* Hero */}
          <div className="text-center mb-10">
            <div className="w-20 h-20 rounded-3xl bg-[#2D5A27]/10 flex items-center justify-center mx-auto mb-5 shadow-sm">
              <Users size={36} className="text-[#2D5A27]" />
            </div>
            <h1 className="text-2xl font-bold text-[#333333]">Criar meu time</h1>
            <p className="mt-2 text-[#666666] text-sm max-w-xs mx-auto leading-relaxed">
              Reúna sua equipe e acesse as reuniões de todos em um só lugar.
            </p>
          </div>

          {/* Features resumidas */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { icon: UserPlus, label: 'Convide membros' },
              { icon: Video, label: 'Reuniões do time' },
              { icon: Shield, label: 'Controle de acesso' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="bg-white rounded-2xl border border-[#E0E0E0] p-4 flex flex-col items-center gap-2 text-center">
                <div className="w-8 h-8 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                  <Icon size={15} className="text-[#2D5A27]" />
                </div>
                <span className="text-xs text-[#666666] font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* Card de criação */}
          <div className="bg-white border border-[#E0E0E0] rounded-2xl p-6 shadow-sm">
            <button
              onClick={openCreateTeamModal}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
            >
              <Plus size={15} />
              Criar meu time
            </button>
          </div>
        </div>
        {renderCreateTeamModal()}
      </MainLayout>
    )
  }

  // ── Time existente ────────────────────────────────────────────
  if (teamLoading || !team) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-32">
          <Loader size={28} className="animate-spin text-[#2D5A27]" />
        </div>
      </MainLayout>
    )
  }

  const activeCount = members.filter(m => m.status === 'active').length
  const pendingCount = members.filter(m => m.status === 'invited').length
  const canCreateMore = teams.filter(t => t.isOwner).length < 5

  console.log('[TeamPage] Renderizando com teams:', teams)
  console.log('[TeamPage] Team selecionado:', selectedTeamId)

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Seletor de Times + Criar Novo */}
        {teams.length > 1 || canCreateMore ? (
          <div className="bg-white border border-[#E0E0E0] rounded-2xl p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              {/* Seletor */}
              <div className="flex-1">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider mb-2 block">
                  Selecione um time ({teams.length}/5)
                </label>
                <select
                  value={selectedTeamId ?? ''}
                  onChange={(e) => {
                    console.log('[TeamPage] Selecionando time:', e.target.value)
                    setSelectedTeamId(e.target.value)
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-white"
                >
                  {teams.map(t => {
                    console.log('[TeamPage] Renderizando option:', t.name, t.id, t.isOwner)
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.isOwner ? '(Owner)' : '(Membro)'}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Criar novo time */}
              {canCreateMore && (
                <div className="sm:pt-6">
                  <button
                    onClick={openCreateTeamModal}
                    className="px-4 py-2 rounded-lg bg-[#2D5A27] text-white text-sm font-medium hover:bg-[#1E3D1A] transition flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus size={14} />
                    Novo time
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Header full-width */}
        <div className="bg-white border border-[#E0E0E0] rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Info do time */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0">
                <Users size={26} className="text-[#2D5A27]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-[#333333] truncate">{team.name}</h1>
                <p className="text-sm text-[#666666] mt-0.5 flex items-center gap-2 flex-wrap">
                  {activeCount} membro(s) ativo(s)
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                      <Clock size={10} /> {pendingCount} pendente(s)
                    </span>
                  )}
                </p>
              </div>
            </div>
            {/* Stats */}
            <div className="flex gap-4 shrink-0">
              {[
                { label: 'Total', value: members.length, color: 'text-[#2D5A27]' },
                { label: 'Ativos', value: activeCount, color: 'text-[#4CAF50]' },
                { label: 'Pendentes', value: pendingCount, color: 'text-amber-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center px-4 py-2.5 bg-[#F8F9FA] rounded-xl min-w-[72px]">
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-[#666666] mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F5F5] rounded-xl p-1 w-fit">
          {(['members', 'meetings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-white text-[#2D5A27] shadow-sm font-semibold'
                  : 'text-[#666666] hover:text-[#333333]'
              }`}
            >
              {t === 'members' ? (
                <span className="flex items-center gap-2"><Users size={14} /> Membros</span>
              ) : (
                <span className="flex items-center gap-2"><Video size={14} /> Reuniões do Time</span>
              )}
            </button>
          ))}
        </div>

        {/* ── ABA MEMBROS ── */}
        {tab === 'members' && (
          <div className={`grid gap-6 ${isOwner ? 'grid-cols-1 lg:grid-cols-[1fr_340px]' : 'grid-cols-1'}`}>

            {/* Coluna principal: lista de membros */}
            <div className="bg-white border border-[#E0E0E0] rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#F0F0F0] flex items-center justify-between">
                <span className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                  Membros ({members.length})
                </span>
              </div>
              <div className="divide-y divide-[#F5F5F5]">
                {members.length === 0 ? (
                  <div className="flex flex-col items-center py-16 gap-3">
                    <Users size={32} className="text-[#CCCCCC]" />
                    <p className="text-sm text-[#999999]">Nenhum membro ainda.</p>
                  </div>
                ) : members.map((m) => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F9FA] transition-colors">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      m.status === 'active' ? 'bg-[#2D5A27]/15 text-[#2D5A27]' : 'bg-[#F5F5F5] text-[#999999]'
                    }`}>
                      {(m.name ?? m.invited_email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#333333] truncate">
                          {m.name ?? m.invited_email.split('@')[0]}
                        </span>
                        {m.role === 'admin' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            <Crown size={9} /> Admin
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[#999999]">{m.invited_email}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {m.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4CAF50] bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                          <CheckCircle size={11} /> Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                          <Clock size={11} /> Pendente
                        </span>
                      )}
                      {isOwner && m.user_id !== team.owner_id && (
                        <button
                          onClick={() => handleRoleChange(m.id, m.role === 'admin' ? 'member' : 'admin')}
                          disabled={promotingMember === m.id}
                          title={m.role === 'admin' ? 'Remover Admin' : 'Tornar Admin'}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                            m.role === 'admin'
                              ? 'text-amber-500 hover:text-amber-700 hover:bg-amber-50'
                              : 'text-[#999999] hover:text-amber-500 hover:bg-amber-50'
                          }`}
                        >
                          {promotingMember === m.id ? (
                            <Loader size={14} className="animate-spin" />
                          ) : (
                            <Crown size={14} />
                          )}
                        </button>
                      )}
                      {isOwner && m.user_id !== team.owner_id && m.role !== 'admin' && (
                        <button
                          onClick={() => handleRemove(m.invited_email)}
                          disabled={removingEmail === m.invited_email}
                          title="Remover membro"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#999999] hover:text-[#DC3545] hover:bg-red-50 transition"
                        >
                          {removingEmail === m.invited_email ? (
                            <Loader size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Coluna lateral: ações do owner */}
            {isOwner && (
              <div className="space-y-4">
                {/* Avaliação por IA */}
                <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                      <Sparkles size={14} className="text-[#2D5A27]" />
                    </div>
                    <span className="text-sm font-semibold text-[#333333]">Avaliação por IA</span>
                  </div>
                  <div className="bg-[#F8F9FA] rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#666666]">Tipo do time</span>
                      <span className="text-xs font-semibold text-[#333333]">
                        {team.team_type === 'customer_success' ? 'Customer Success' : 'Sales'}
                      </span>
                    </div>
                    {team.team_type !== 'customer_success' && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[#666666]">Framework</span>
                        <span className="text-xs font-semibold text-[#333333]">
                          {(team.evaluation_framework ?? 'bant').toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#666666]">Instruções customizadas</span>
                      <span className="text-xs font-semibold text-[#333333]">
                        {team.custom_prompt_instructions ? 'Sim' : 'Não'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleOpenConfigModal}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2D5A27] text-[#2D5A27] text-sm font-semibold hover:bg-[#2D5A27]/5 transition"
                  >
                    <Sparkles size={15} />
                    Configurar avaliação
                  </button>
                </div>

                {/* Link de convite */}
                <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                      <Link2 size={14} className="text-[#2D5A27]" />
                    </div>
                    <span className="text-sm font-semibold text-[#333333]">Link de convite</span>
                  </div>
                  <p className="text-xs text-[#666666] leading-relaxed">
                    Gere um link compartilhável que qualquer pessoa pode usar para entrar no time.
                  </p>
                  <button
                    onClick={handleGenerateInviteLink}
                    disabled={inviteLinkLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50 shadow-sm"
                  >
                    {inviteLinkLoading ? (
                      <Loader size={15} className="animate-spin" />
                    ) : (
                      <Link2 size={15} />
                    )}
                    Gerar link de convite
                  </button>
                </div>

                {/* Info extra */}
                <div className="bg-[#F8F9FA] border border-[#F0F0F0] rounded-2xl p-5 space-y-3">
                  <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider">Como funciona</p>
                  <ul className="space-y-2.5 text-xs text-[#666666] leading-relaxed">
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                      Clique em "Gerar link de convite" para criar um link compartilhável.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                      Compartilhe o link com a pessoa que deseja convidar.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                      Após fazer login, ela será automaticamente adicionada ao time.
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ABA REUNIÕES ── */}
        {tab === 'meetings' && (
          <div className="space-y-3">
            {meetingsLoading ? (
              <div className="flex justify-center py-16">
                <Loader size={24} className="animate-spin text-[#2D5A27]" />
              </div>
            ) : meetings.length === 0 ? (
              <div className="bg-white border border-[#E0E0E0] rounded-2xl p-16 flex flex-col items-center gap-3 shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-[#F5F5F5] flex items-center justify-center">
                  <Video size={24} className="text-[#CCCCCC]" />
                </div>
                <p className="text-sm text-[#999999] font-medium">Nenhuma reunião encontrada no time.</p>
                <p className="text-xs text-[#BBBBBB]">As reuniões dos membros aparecerão aqui.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {meetings.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/meetings/${m.id}`)}
                    className="bg-white border border-[#E0E0E0] rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-[#2D5A27]/30 hover:shadow-md transition text-left group shadow-sm"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0 group-hover:bg-[#2D5A27]/15 transition">
                      <Video size={16} className="text-[#2D5A27]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#333333] truncate">
                        {m.title ?? `Reunião ${m.id.split('-')[0]}`}
                      </div>
                      <div className="text-xs text-[#999999] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-[#666666]">{m.member_name}</span>
                        <span>·</span>
                        <span>{formatDate(m.started_at ?? '')}</span>
                        <span>·</span>
                        <span>{formatDuration(m.duration_seconds)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {m.status === 'completed' && (
                        <span className="text-xs font-medium text-[#4CAF50] bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Concluída</span>
                      )}
                      {m.status === 'error' && (
                        <span className="text-xs font-medium text-[#DC3545] bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Erro</span>
                      )}
                      <ChevronRight size={15} className="text-[#CCCCCC] group-hover:text-[#2D5A27] transition" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {renderCreateTeamModal()}

      {/* Modal de Config de Avaliação */}
      {showConfigModal && team && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !configSaving && setShowConfigModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#333333]">Configurar avaliação por IA</h3>
                <p className="text-sm text-[#666666] mt-1">Como a IA deve analisar as reuniões deste time</p>
              </div>
              <button
                onClick={() => !configSaving && setShowConfigModal(false)}
                className="text-[#999999] hover:text-[#333333] transition"
                disabled={configSaving}
              >
                <X size={20} />
              </button>
            </div>

            {/* Tipo do time */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Tipo do time
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'sales' as const, label: 'Sales', desc: 'Reuniões comerciais (prospecção, qualificação, fechamento)' },
                  { value: 'customer_success' as const, label: 'Customer Success', desc: 'Reuniões com clientes ativos (health, retenção, expansão)' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setConfigForm(prev => ({ ...prev, team_type: opt.value }))}
                    className={`text-left p-3 rounded-xl border-2 transition ${
                      configForm.team_type === opt.value
                        ? 'border-[#2D5A27] bg-[#2D5A27]/5'
                        : 'border-[#E0E0E0] hover:border-[#CCCCCC]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-[#333333]">{opt.label}</div>
                    <div className="text-xs text-[#666666] mt-1 leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Framework (só Sales) */}
            {configForm.team_type === 'sales' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                  Framework de avaliação
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'bant' as const, label: 'BANT', desc: 'Budget, Authority, Need, Timeline' },
                    { value: 'spin' as const, label: 'SPIN Selling', desc: 'Situation, Problem, Implication, Need-payoff' },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setConfigForm(prev => ({ ...prev, evaluation_framework: opt.value }))}
                      className={`text-left p-3 rounded-xl border-2 transition ${
                        configForm.evaluation_framework === opt.value
                          ? 'border-[#2D5A27] bg-[#2D5A27]/5'
                          : 'border-[#E0E0E0] hover:border-[#CCCCCC]'
                      }`}
                    >
                      <div className="text-sm font-semibold text-[#333333]">{opt.label}</div>
                      <div className="text-xs text-[#666666] mt-1 leading-relaxed">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Instruções customizadas */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Instruções customizadas (opcional)
              </label>
              <p className="text-xs text-[#666666] leading-relaxed">
                Instruções adicionais que serão incluídas no prompt da IA. Use para contextualizar seu ICP,
                tom desejado, sinais específicos a observar, etc. Não substitui o framework — complementa.
              </p>
              <textarea
                value={configForm.custom_prompt_instructions}
                onChange={(e) => setConfigForm(prev => ({ ...prev, custom_prompt_instructions: e.target.value }))}
                placeholder="Ex: Nosso ICP é diretor de RH de empresa de 100-500 funcionários. Foque em sinais de adoção do módulo de pesquisa de clima e mencione integração com SAP se for citada."
                maxLength={4000}
                rows={6}
                className="w-full text-sm text-[#333333] bg-[#F8F9FA] border border-[#E0E0E0] rounded-xl p-3 focus:outline-none focus:border-[#2D5A27] resize-y"
              />
              <div className="text-xs text-[#999999] text-right">
                {configForm.custom_prompt_instructions.length} / 4000
              </div>
            </div>

            {/* Aviso histórico */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                Reuniões já processadas permanecem com a análise no framework original.
                A nova configuração só vale para reuniões processadas a partir de agora.
              </p>
            </div>

            {/* Erro */}
            {configError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
                <AlertCircle size={16} className="text-[#DC3545] shrink-0 mt-0.5" />
                <p className="text-xs text-[#DC3545] leading-relaxed">{configError}</p>
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfigModal(false)}
                disabled={configSaving}
                className="flex-1 py-2.5 rounded-xl border border-[#E0E0E0] text-sm font-semibold text-[#666666] hover:bg-[#F8F9FA] transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50"
              >
                {configSaving ? <Loader size={15} className="animate-spin" /> : <Check size={15} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Link de Convite */}
      {showInviteLinkModal && inviteLink && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowInviteLinkModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#333333]">Link de Convite Gerado</h3>
                <p className="text-sm text-[#666666] mt-1">Compartilhe este link com quem você deseja convidar</p>
              </div>
              <button 
                onClick={() => setShowInviteLinkModal(false)}
                className="text-[#999999] hover:text-[#333333] transition"
              >
                <AlertCircle size={20} />
              </button>
            </div>

            {/* Link */}
            <div className="bg-[#F8F9FA] border border-[#E0E0E0] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs text-[#2D5A27] font-mono break-all flex-1">
                  {inviteLink.url}
                </code>
                <button
                  onClick={handleCopyLink}
                  className="shrink-0 p-2 rounded-lg bg-white border border-[#E0E0E0] hover:bg-[#F8F9FA] transition"
                >
                  {linkCopied ? (
                    <Check size={16} className="text-[#4CAF50]" />
                  ) : (
                    <Copy size={16} className="text-[#666666]" />
                  )}
                </button>
              </div>
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition"
              >
                {linkCopied ? (
                  <>
                    <Check size={15} />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy size={15} />
                    Copiar link
                  </>
                )}
              </button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F8F9FA] rounded-xl p-3">
                <p className="text-xs text-[#666666] mb-1">Expira em</p>
                <p className="text-sm font-semibold text-[#333333]">
                  {new Date(inviteLink.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="bg-[#F8F9FA] rounded-xl p-3">
                <p className="text-xs text-[#666666] mb-1">Usos</p>
                <p className="text-sm font-semibold text-[#333333]">
                  {inviteLink.currentUses} {inviteLink.maxUses ? `/ ${inviteLink.maxUses}` : '/ ilimitado'}
                </p>
              </div>
            </div>

            {/* Aviso */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                Qualquer pessoa com este link poderá entrar no seu time. Compartilhe apenas com pessoas confiáveis.
              </p>
            </div>

            {/* Botão fechar */}
            <button
              onClick={() => setShowInviteLinkModal(false)}
              className="w-full py-2.5 rounded-xl border border-[#E0E0E0] text-sm font-semibold text-[#666666] hover:bg-[#F8F9FA] transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </MainLayout>
  )
}

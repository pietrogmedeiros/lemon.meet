import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Users, Plus, Trash2, CheckCircle, Clock,
  AlertCircle, Loader, Video, Crown, UserPlus, ChevronRight, ChevronLeft,
  Shield, Link2, Copy, Check, Sparkles, X, Settings, Heart, Target, BookOpen
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
  const [tab, setTab] = useState<'members' | 'meetings' | 'settings'>('members')

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

  // What's new (mostrado uma vez pra owners pós-release CS)
  const WHATS_NEW_KEY = 'whatsnew_2026_05_cs_seen'
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [whatsNewStep, setWhatsNewStep] = useState(0)

  // Excluir time
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  // Dispara "What's new" pra owners na primeira visita pós-release
  useEffect(() => {
    if (!team || !isOwner) return
    if (typeof window === 'undefined') return
    try {
      const seen = window.localStorage.getItem(WHATS_NEW_KEY)
      if (!seen) {
        // pequeno delay pra página renderizar primeiro
        const t = setTimeout(() => setShowWhatsNew(true), 400)
        return () => clearTimeout(t)
      }
    } catch {
      // localStorage indisponível (ex: navegação anônima com storage bloqueado) — não força modal
    }
  }, [team, isOwner])

  const dismissWhatsNew = () => {
    try {
      window.localStorage.setItem(WHATS_NEW_KEY, new Date().toISOString())
    } catch {}
    setShowWhatsNew(false)
    setWhatsNewStep(0)
  }

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

  const handleOpenDeleteModal = () => {
    setDeleteConfirmText('')
    setDeleteError('')
    setShowDeleteModal(true)
  }

  const handleDeleteTeam = async () => {
    if (!team) return
    if (deleteConfirmText.trim() !== team.name) {
      setDeleteError('O nome digitado não confere com o nome do time')
      return
    }
    setDeleteLoading(true)
    setDeleteError('')
    try {
      const data = await apiFetch(`/api/teams/${team.id}`, session, {
        method: 'DELETE',
        body: JSON.stringify({ name: deleteConfirmText.trim() }),
      })
      if (!data.success) throw new Error(data.message ?? 'Erro ao excluir time')
      // Limpa estado local e recarrega lista
      setShowDeleteModal(false)
      setTeam(null)
      setSelectedTeamId(null)
      await loadTeams()
    } catch (err: any) {
      setDeleteError(err.message ?? 'Erro ao excluir')
    } finally {
      setDeleteLoading(false)
    }
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

  const renderWhatsNewModal = () => {
    if (!showWhatsNew) return null

    const STEPS: Array<{
      icon: typeof Sparkles
      iconColor: string
      iconBg: string
      tag: string
      title: string
      description: string
      preview?: React.ReactNode
    }> = [
      {
        icon: Heart,
        iconColor: '#DC3545',
        iconBg: 'bg-red-50 dark:bg-red-950/40',
        tag: 'Novo tipo de time',
        title: 'Customer Success agora é suportado',
        description: 'Lemon não é mais só pra Sales. Times de CS podem analisar reuniões com clientes ativos e ver métricas específicas: Health Score (0-100), Risco de Churn (low/medium/high), Satisfação (0-10) e momentos críticos detectados na conversa.',
        preview: (
          <div className="grid grid-cols-2 gap-2 text-left">
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-xl p-3">
              <div className="text-[10px] font-semibold text-[#DC3545] uppercase tracking-wider mb-1">Health Score</div>
              <div className="text-xl font-bold text-primary">72/100</div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/50 rounded-xl p-3">
              <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">Churn Risk</div>
              <div className="text-xl font-bold text-primary">Médio</div>
            </div>
          </div>
        ),
      },
      {
        icon: Target,
        iconColor: '#2D5A27',
        iconBg: 'bg-[#2D5A27]/10',
        tag: 'Novo framework Sales',
        title: 'Escolha entre BANT e SPIN Selling',
        description: 'Times de Sales agora podem escolher o framework de análise. BANT (Budget, Authority, Need, Timeline) continua disponível, e SPIN Selling (Situation, Problem, Implication, Need-payoff) chegou pra abordagens consultivas. A escolha vale pra novas reuniões — as antigas mantêm o framework original.',
        preview: (
          <div className="flex gap-2 text-left">
            <div className="flex-1 bg-[#2D5A27]/5 border border-[#2D5A27]/20 rounded-xl p-3">
              <div className="text-[10px] font-semibold text-brand uppercase tracking-wider mb-1">BANT</div>
              <div className="text-xs text-secondary leading-snug">Budget · Authority · Need · Timeline</div>
            </div>
            <div className="flex-1 bg-[#2D5A27]/5 border border-[#2D5A27]/20 rounded-xl p-3">
              <div className="text-[10px] font-semibold text-brand uppercase tracking-wider mb-1">SPIN</div>
              <div className="text-xs text-secondary leading-snug">Situation · Problem · Implication · Need-payoff</div>
            </div>
          </div>
        ),
      },
      {
        icon: BookOpen,
        iconColor: '#2D5A27',
        iconBg: 'bg-[#2D5A27]/10',
        tag: 'Personalize a IA',
        title: 'Instruções customizadas pro seu contexto',
        description: 'Adicione até 4000 caracteres de instruções específicas que serão aplicadas a TODAS as análises do time. Use pra contextualizar seu ICP, tom desejado, sinais específicos a observar — sem precisar prompt engineering. Não substitui o framework: complementa.',
        preview: (
          <div className="bg-background border border-neutral-light rounded-xl p-3 text-left">
            <div className="text-[10px] font-semibold text-secondary uppercase tracking-wider mb-1.5">Exemplo</div>
            <p className="text-xs text-secondary leading-relaxed font-mono">
              "Nosso ICP é diretor de RH de empresa de 100-500 funcionários. Foque em sinais de adoção do módulo de pesquisa de clima e mencione integração com SAP se for citada."
            </p>
          </div>
        ),
      },
      {
        icon: Settings,
        iconColor: '#2D5A27',
        iconBg: 'bg-[#2D5A27]/10',
        tag: 'Página redesenhada',
        title: 'Nova aba "Configurações" pra owners',
        description: 'Tudo de administração ficou numa aba dedicada: configurar a avaliação por IA, gerar link de convite e a zona de perigo (excluir time). A aba "Membros" ganhou largura total e o botão "+ Novo time" agora fica sempre visível no topo, mesmo quando você tem só um time.',
        preview: (
          <div className="flex gap-1 bg-neutral-lighter rounded-xl p-1 text-left w-fit mx-auto">
            <div className="px-3 py-1.5 text-xs text-secondary flex items-center gap-1.5"><Users size={11} /> Membros</div>
            <div className="px-3 py-1.5 text-xs text-secondary flex items-center gap-1.5"><Video size={11} /> Reuniões</div>
            <div className="px-3 py-1.5 rounded-lg bg-surface text-xs font-semibold text-brand shadow-sm flex items-center gap-1.5"><Settings size={11} /> Configurações</div>
          </div>
        ),
      },
      {
        icon: Trash2,
        iconColor: '#DC3545',
        iconBg: 'bg-red-50 dark:bg-red-950/40',
        tag: 'Mais segurança',
        title: 'Excluir time agora exige confirmação',
        description: 'Pra evitar acidentes, a exclusão de um time pede pra você digitar exatamente o nome dele antes de habilitar o botão. Membros são removidos, links de convite invalidados, e reuniões já registradas perdem o vínculo mas permanecem no histórico. Disponível em Configurações → Zona de perigo.',
        preview: (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl p-3 text-left">
            <div className="text-[10px] text-secondary mb-1">Para confirmar, digite:</div>
            <div className="font-mono text-xs font-bold text-[#DC3545] mb-2">Meu Time Comercial</div>
            <div className="flex gap-2">
              <div className="flex-1 bg-surface border border-[#DC3545]/40 rounded-lg px-2 py-1 text-xs text-tertiary">Meu Time Comercial</div>
              <div className="bg-[#DC3545] text-white text-xs font-semibold px-3 py-1 rounded-lg">Excluir</div>
            </div>
          </div>
        ),
      },
    ]

    const step = STEPS[whatsNewStep]
    const isFirst = whatsNewStep === 0
    const isLast = whatsNewStep === STEPS.length - 1
    const Icon = step.icon

    return (
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={dismissWhatsNew}
      >
        <div
          className="bg-surface rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#2D5A27]/10 text-brand text-[10px] font-semibold uppercase tracking-wider mb-2">
                <Sparkles size={10} />
                Novidades
              </div>
              <p className="text-xs text-tertiary">{whatsNewStep + 1} de {STEPS.length}</p>
            </div>
            <button
              onClick={dismissWhatsNew}
              className="text-tertiary hover:text-primary transition"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>

          {/* Conteúdo */}
          <div className="text-center space-y-4">
            <div className={`w-16 h-16 rounded-2xl ${step.iconBg} flex items-center justify-center mx-auto`}>
              <Icon size={28} style={{ color: step.iconColor }} />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: step.iconColor }}>
                {step.tag}
              </div>
              <h3 className="text-xl font-bold text-primary leading-tight">{step.title}</h3>
            </div>
            <p className="text-sm text-secondary leading-relaxed text-left">{step.description}</p>
            {step.preview && <div className="pt-1">{step.preview}</div>}
          </div>

          {/* Indicador de progresso */}
          <div className="flex items-center justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setWhatsNewStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === whatsNewStep
                    ? 'w-6 bg-[#2D5A27]'
                    : 'w-1.5 bg-[#E0E0E0] hover:bg-[#CCCCCC]'
                }`}
                aria-label={`Ir para passo ${i + 1}`}
              />
            ))}
          </div>

          {/* Navegação */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWhatsNewStep(s => Math.max(0, s - 1))}
              disabled={isFirst}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-neutral-light text-sm font-semibold text-secondary hover:bg-background transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={15} />
              Anterior
            </button>
            <button
              onClick={dismissWhatsNew}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-secondary hover:bg-background transition"
            >
              Pular
            </button>
            <div className="flex-1" />
            {isLast ? (
              <button
                onClick={dismissWhatsNew}
                className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
              >
                <Check size={15} />
                Entendi
              </button>
            ) : (
              <button
                onClick={() => setWhatsNewStep(s => Math.min(STEPS.length - 1, s + 1))}
                className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
              >
                Próximo
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    )
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
          className="bg-surface rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-primary">Criar novo time</h3>
              <p className="text-sm text-secondary mt-1">
                Defina o tipo do time e como a IA deve avaliar as reuniões
              </p>
            </div>
            <button
              onClick={() => !isLoading && setShowCreateTeamModal(false)}
              className="text-tertiary hover:text-primary transition"
              disabled={isLoading}
            >
              <X size={20} />
            </button>
          </div>

          {/* Nome do time */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Nome do time
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Ex: Time Comercial"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-light text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-surface placeholder:text-tertiary"
            />
          </div>

          {/* Tipo do time */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
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
                      : 'border-neutral-light hover:border-[#CCCCCC]'
                  }`}
                >
                  <div className="text-sm font-semibold text-primary">{opt.label}</div>
                  <div className="text-xs text-secondary mt-1 leading-relaxed">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Framework (só Sales) */}
          {createTeamType === 'sales' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
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
                        : 'border-neutral-light hover:border-[#CCCCCC]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-primary">{opt.label}</div>
                    <div className="text-xs text-secondary mt-1 leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Instruções customizadas */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Instruções customizadas (opcional)
            </label>
            <p className="text-xs text-secondary leading-relaxed">
              Instruções adicionais para a IA. Contextualize seu ICP, tom desejado, sinais específicos a observar, etc.
            </p>
            <textarea
              value={createTeamInstructions}
              onChange={(e) => setCreateTeamInstructions(e.target.value)}
              placeholder="Você pode preencher depois, se preferir."
              maxLength={4000}
              rows={4}
              className="w-full text-sm text-primary bg-background border border-neutral-light rounded-xl p-3 focus:outline-none focus:border-[#2D5A27] resize-y"
            />
            <div className="text-xs text-tertiary text-right">
              {createTeamInstructions.length} / 4000
            </div>
          </div>

          {/* Erro */}
          {createError && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-[#DC3545] shrink-0 mt-0.5" />
              <p className="text-xs text-[#DC3545] leading-relaxed">{createError}</p>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateTeamModal(false)}
              disabled={isLoading}
              className="flex-1 py-2.5 rounded-xl border border-neutral-light text-sm font-semibold text-secondary hover:bg-background transition disabled:opacity-50"
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
          <Loader size={28} className="animate-spin text-brand" />
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
              <Users size={36} className="text-brand" />
            </div>
            <h1 className="text-2xl font-bold text-primary">Criar meu time</h1>
            <p className="mt-2 text-secondary text-sm max-w-xs mx-auto leading-relaxed">
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
              <div key={label} className="bg-surface rounded-2xl border border-neutral-light p-4 flex flex-col items-center gap-2 text-center">
                <div className="w-8 h-8 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                  <Icon size={15} className="text-brand" />
                </div>
                <span className="text-xs text-secondary font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* Card de criação */}
          <div className="bg-surface border border-neutral-light rounded-2xl p-6 shadow-sm">
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
          <Loader size={28} className="animate-spin text-brand" />
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

        {/* Header de navegação: seletor (se >1 time) + ação primária criar */}
        {(teams.length > 1 || canCreateMore) && (
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            {teams.length > 1 && (
              <div className="flex-1 min-w-0">
                <label className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2 block">
                  Selecione um time ({teams.length}/5)
                </label>
                <select
                  value={selectedTeamId ?? ''}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-light text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-surface shadow-sm"
                >
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.isOwner ? '(Owner)' : '(Membro)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {canCreateMore && (
              <button
                onClick={openCreateTeamModal}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition whitespace-nowrap shadow-sm"
              >
                <Plus size={15} />
                Novo time
              </button>
            )}
          </div>
        )}

        {/* Header full-width */}
        <div className="bg-surface border border-neutral-light rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Info do time */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0">
                <Users size={26} className="text-brand" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-primary truncate">{team.name}</h1>
                <p className="text-sm text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
                  {activeCount} membro(s) ativo(s)
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-600 border border-amber-200 dark:border-amber-900/50 px-2 py-0.5 rounded-full font-medium">
                      <Clock size={10} /> {pendingCount} pendente(s)
                    </span>
                  )}
                </p>
              </div>
            </div>
            {/* Stats */}
            <div className="flex gap-4 shrink-0">
              {[
                { label: 'Total', value: members.length, color: 'text-brand' },
                { label: 'Ativos', value: activeCount, color: 'text-[#4CAF50]' },
                { label: 'Pendentes', value: pendingCount, color: 'text-amber-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center px-4 py-2.5 bg-background rounded-xl min-w-[72px]">
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-secondary mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-neutral-lighter rounded-xl p-1 w-fit">
          {(isOwner ? (['members', 'meetings', 'settings'] as const) : (['members', 'meetings'] as const)).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-surface text-brand shadow-sm font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {t === 'members' && <span className="flex items-center gap-2"><Users size={14} /> Membros</span>}
              {t === 'meetings' && <span className="flex items-center gap-2"><Video size={14} /> Reuniões do Time</span>}
              {t === 'settings' && <span className="flex items-center gap-2"><Settings size={14} /> Configurações</span>}
            </button>
          ))}
        </div>

        {/* ── ABA MEMBROS ── */}
        {tab === 'members' && (
          <div>
            <div className="bg-surface border border-neutral-light rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-light flex items-center justify-between">
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  Membros ({members.length})
                </span>
              </div>
              <div className="divide-y divide-[#F5F5F5]">
                {members.length === 0 ? (
                  <div className="flex flex-col items-center py-16 gap-3">
                    <Users size={32} className="text-[#CCCCCC]" />
                    <p className="text-sm text-tertiary">Nenhum membro ainda.</p>
                  </div>
                ) : members.map((m) => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4 hover:bg-background transition-colors">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      m.status === 'active' ? 'bg-[#2D5A27]/15 text-brand' : 'bg-neutral-lighter text-tertiary'
                    }`}>
                      {(m.name ?? m.invited_email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-primary truncate">
                          {m.name ?? m.invited_email.split('@')[0]}
                        </span>
                        {m.role === 'admin' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 border border-amber-200 dark:border-amber-900/50 px-1.5 py-0.5 rounded-full">
                            <Crown size={9} /> Admin
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-tertiary">{m.invited_email}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {m.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4CAF50] bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/50 px-2.5 py-1 rounded-full">
                          <CheckCircle size={11} /> Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 px-2.5 py-1 rounded-full">
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
                              ? 'text-amber-500 hover:text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:bg-amber-950/40'
                              : 'text-tertiary hover:text-amber-500 hover:bg-amber-50 dark:bg-amber-950/40'
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
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-tertiary hover:text-[#DC3545] hover:bg-red-50 dark:bg-red-950/40 transition"
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

          </div>
        )}

        {/* ── ABA CONFIGURAÇÕES (owner-only) ── */}
        {tab === 'settings' && isOwner && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Seção: Avaliação por IA */}
            <div className="bg-surface border border-neutral-light rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-light flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                  <Sparkles size={14} className="text-brand" />
                </div>
                <span className="text-sm font-semibold text-primary">Avaliação por IA</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-secondary leading-relaxed">
                  Define como a IA analisa as reuniões deste time: tipo (Sales/CS), framework
                  (BANT/SPIN) e instruções customizadas pro seu contexto.
                </p>
                <div className="bg-background rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary">Tipo do time</span>
                    <span className="text-xs font-semibold text-primary">
                      {team.team_type === 'customer_success' ? 'Customer Success' : 'Sales'}
                    </span>
                  </div>
                  {team.team_type !== 'customer_success' && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-secondary">Framework</span>
                      <span className="text-xs font-semibold text-primary">
                        {(team.evaluation_framework ?? 'bant').toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary">Instruções customizadas</span>
                    <span className="text-xs font-semibold text-primary">
                      {team.custom_prompt_instructions ? 'Sim' : 'Não'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleOpenConfigModal}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2D5A27] text-brand text-sm font-semibold hover:bg-[#2D5A27]/5 transition"
                >
                  <Sparkles size={15} />
                  Configurar avaliação
                </button>
              </div>
            </div>

            {/* Seção: Convite de membros */}
            <div className="bg-surface border border-neutral-light rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-light flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                  <Link2 size={14} className="text-brand" />
                </div>
                <span className="text-sm font-semibold text-primary">Convite de membros</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-secondary leading-relaxed">
                  Gere um link compartilhável (válido por 7 dias) que qualquer pessoa pode
                  usar pra entrar no time. Após login, ela é automaticamente adicionada.
                </p>
                <button
                  onClick={handleGenerateInviteLink}
                  disabled={inviteLinkLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50 shadow-sm"
                >
                  {inviteLinkLoading ? <Loader size={15} className="animate-spin" /> : <Link2 size={15} />}
                  Gerar link de convite
                </button>
              </div>
            </div>

            {/* Seção: Zona de perigo — span full width */}
            <div className="lg:col-span-2 bg-surface border border-red-200 dark:border-red-900/50 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-red-100 dark:border-red-900/50 flex items-center gap-2 bg-red-50/50">
                <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertCircle size={14} className="text-[#DC3545]" />
                </div>
                <span className="text-sm font-semibold text-[#DC3545]">Zona de perigo</span>
              </div>
              <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary">Excluir este time</p>
                  <p className="text-xs text-secondary leading-relaxed mt-1">
                    Remove o time e todos os membros. Reuniões já registradas permanecem mas
                    perdem o vínculo com o time. <strong>Ação irreversível.</strong>
                  </p>
                </div>
                <button
                  onClick={handleOpenDeleteModal}
                  className="shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-[#DC3545] text-[#DC3545] text-sm font-semibold hover:bg-red-50 dark:bg-red-950/40 transition whitespace-nowrap"
                >
                  <Trash2 size={15} />
                  Excluir time
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ABA REUNIÕES ── */}
        {tab === 'meetings' && (
          <div className="space-y-3">
            {meetingsLoading ? (
              <div className="flex justify-center py-16">
                <Loader size={24} className="animate-spin text-brand" />
              </div>
            ) : meetings.length === 0 ? (
              <div className="bg-surface border border-neutral-light rounded-2xl p-16 flex flex-col items-center gap-3 shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-neutral-lighter flex items-center justify-center">
                  <Video size={24} className="text-[#CCCCCC]" />
                </div>
                <p className="text-sm text-tertiary font-medium">Nenhuma reunião encontrada no time.</p>
                <p className="text-xs text-[#BBBBBB]">As reuniões dos membros aparecerão aqui.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {meetings.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/meetings/${m.id}`)}
                    className="bg-surface border border-neutral-light rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-[#2D5A27]/30 hover:shadow-md transition text-left group shadow-sm"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0 group-hover:bg-[#2D5A27]/15 transition">
                      <Video size={16} className="text-brand" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-primary truncate">
                        {m.title ?? `Reunião ${m.id.split('-')[0]}`}
                      </div>
                      <div className="text-xs text-tertiary mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-secondary">{m.member_name}</span>
                        <span>·</span>
                        <span>{formatDate(m.started_at ?? '')}</span>
                        <span>·</span>
                        <span>{formatDuration(m.duration_seconds)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {m.status === 'completed' && (
                        <span className="text-xs font-medium text-[#4CAF50] bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/50 px-2 py-0.5 rounded-full">Concluída</span>
                      )}
                      {m.status === 'error' && (
                        <span className="text-xs font-medium text-[#DC3545] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 px-2 py-0.5 rounded-full">Erro</span>
                      )}
                      <ChevronRight size={15} className="text-[#CCCCCC] group-hover:text-brand transition" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {renderCreateTeamModal()}
      {renderWhatsNewModal()}

      {/* Modal de Config de Avaliação */}
      {showConfigModal && team && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !configSaving && setShowConfigModal(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">Configurar avaliação por IA</h3>
                <p className="text-sm text-secondary mt-1">Como a IA deve analisar as reuniões deste time</p>
              </div>
              <button
                onClick={() => !configSaving && setShowConfigModal(false)}
                className="text-tertiary hover:text-primary transition"
                disabled={configSaving}
              >
                <X size={20} />
              </button>
            </div>

            {/* Tipo do time */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
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
                        : 'border-neutral-light hover:border-[#CCCCCC]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-primary">{opt.label}</div>
                    <div className="text-xs text-secondary mt-1 leading-relaxed">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Framework (só Sales) */}
            {configForm.team_type === 'sales' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
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
                          : 'border-neutral-light hover:border-[#CCCCCC]'
                      }`}
                    >
                      <div className="text-sm font-semibold text-primary">{opt.label}</div>
                      <div className="text-xs text-secondary mt-1 leading-relaxed">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Instruções customizadas */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider">
                Instruções customizadas (opcional)
              </label>
              <p className="text-xs text-secondary leading-relaxed">
                Instruções adicionais que serão incluídas no prompt da IA. Use para contextualizar seu ICP,
                tom desejado, sinais específicos a observar, etc. Não substitui o framework — complementa.
              </p>
              <textarea
                value={configForm.custom_prompt_instructions}
                onChange={(e) => setConfigForm(prev => ({ ...prev, custom_prompt_instructions: e.target.value }))}
                placeholder="Ex: Nosso ICP é diretor de RH de empresa de 100-500 funcionários. Foque em sinais de adoção do módulo de pesquisa de clima e mencione integração com SAP se for citada."
                maxLength={4000}
                rows={6}
                className="w-full text-sm text-primary bg-background border border-neutral-light rounded-xl p-3 focus:outline-none focus:border-[#2D5A27] resize-y"
              />
              <div className="text-xs text-tertiary text-right">
                {configForm.custom_prompt_instructions.length} / 4000
              </div>
            </div>

            {/* Aviso histórico */}
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                Reuniões já processadas permanecem com a análise no framework original.
                A nova configuração só vale para reuniões processadas a partir de agora.
              </p>
            </div>

            {/* Erro */}
            {configError && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl p-3 flex gap-2">
                <AlertCircle size={16} className="text-[#DC3545] shrink-0 mt-0.5" />
                <p className="text-xs text-[#DC3545] leading-relaxed">{configError}</p>
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfigModal(false)}
                disabled={configSaving}
                className="flex-1 py-2.5 rounded-xl border border-neutral-light text-sm font-semibold text-secondary hover:bg-background transition disabled:opacity-50"
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

      {/* Modal de Excluir Time */}
      {showDeleteModal && team && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !deleteLoading && setShowDeleteModal(false)}
        >
          <div
            className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
                  <AlertCircle size={20} className="text-[#DC3545]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-primary">Excluir time</h3>
                  <p className="text-xs text-secondary mt-0.5">Esta ação não pode ser desfeita</p>
                </div>
              </div>
              <button
                onClick={() => !deleteLoading && setShowDeleteModal(false)}
                className="text-tertiary hover:text-primary transition"
                disabled={deleteLoading}
              >
                <X size={20} />
              </button>
            </div>

            {/* O que será removido */}
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl p-3 text-xs text-[#7a1f2b] leading-relaxed space-y-1.5">
              <p className="font-semibold">Ao excluir o time:</p>
              <ul className="space-y-1 pl-4 list-disc">
                <li>Todos os membros serão removidos</li>
                <li>Links de convite ativos serão invalidados</li>
                <li>Configurações de scheduling/round-robin serão apagadas</li>
                <li>Reuniões existentes permanecem, mas perdem o vínculo com o time</li>
              </ul>
            </div>

            {/* Confirmação por nome */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary leading-relaxed block">
                Para confirmar, digite o nome do time:{' '}
                <span className="font-mono font-bold text-[#DC3545] bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded">
                  {team.name}
                </span>
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError('') }}
                placeholder={team.name}
                autoFocus
                disabled={deleteLoading}
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-light text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#DC3545]/25 focus:border-[#DC3545] transition bg-surface placeholder:text-tertiary"
              />
            </div>

            {/* Erro */}
            {deleteError && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl p-3 flex gap-2">
                <AlertCircle size={16} className="text-[#DC3545] shrink-0 mt-0.5" />
                <p className="text-xs text-[#DC3545] leading-relaxed">{deleteError}</p>
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteLoading}
                className="flex-1 py-2.5 rounded-xl border border-neutral-light text-sm font-semibold text-secondary hover:bg-background transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleteLoading || deleteConfirmText.trim() !== team.name}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#DC3545] text-white text-sm font-semibold hover:bg-[#b9293a] transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteLoading ? <Loader size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Link de Convite */}
      {showInviteLinkModal && inviteLink && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowInviteLinkModal(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">Link de Convite Gerado</h3>
                <p className="text-sm text-secondary mt-1">Compartilhe este link com quem você deseja convidar</p>
              </div>
              <button 
                onClick={() => setShowInviteLinkModal(false)}
                className="text-tertiary hover:text-primary transition"
              >
                <AlertCircle size={20} />
              </button>
            </div>

            {/* Link */}
            <div className="bg-background border border-neutral-light rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs text-brand font-mono break-all flex-1">
                  {inviteLink.url}
                </code>
                <button
                  onClick={handleCopyLink}
                  className="shrink-0 p-2 rounded-lg bg-surface border border-neutral-light hover:bg-background transition"
                >
                  {linkCopied ? (
                    <Check size={16} className="text-[#4CAF50]" />
                  ) : (
                    <Copy size={16} className="text-secondary" />
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
              <div className="bg-background rounded-xl p-3">
                <p className="text-xs text-secondary mb-1">Expira em</p>
                <p className="text-sm font-semibold text-primary">
                  {new Date(inviteLink.expiresAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="bg-background rounded-xl p-3">
                <p className="text-xs text-secondary mb-1">Usos</p>
                <p className="text-sm font-semibold text-primary">
                  {inviteLink.currentUses} {inviteLink.maxUses ? `/ ${inviteLink.maxUses}` : '/ ilimitado'}
                </p>
              </div>
            </div>

            {/* Aviso */}
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3 flex gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                Qualquer pessoa com este link poderá entrar no seu time. Compartilhe apenas com pessoas confiáveis.
              </p>
            </div>

            {/* Botão fechar */}
            <button
              onClick={() => setShowInviteLinkModal(false)}
              className="w-full py-2.5 rounded-xl border border-neutral-light text-sm font-semibold text-secondary hover:bg-background transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </MainLayout>
  )
}

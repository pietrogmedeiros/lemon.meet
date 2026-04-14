import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Users, Plus, Mail, Trash2, CheckCircle, Clock,
  AlertCircle, Loader, Video, Crown, UserPlus, ChevronRight,
  Shield
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
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'members' | 'meetings'>('members')

  // Criar time
  const [teamName, setTeamName] = useState('')
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [createError, setCreateError] = useState('')

  // Convidar
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  // Meetings do time
  const [meetings, setMeetings] = useState<TeamMeeting[]>([])
  const [meetingsLoading, setMeetingsLoading] = useState(false)

  // Remover membro
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)

  // Alterar papel
  const [promotingMember, setPromotingMember] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
  }, [])

  const loadTeam = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const data = await apiFetch('/api/teams/my', session)
      setTeam(data.team ?? null)
      setMembers(data.members ?? [])
      setIsOwner(data.isOwner ?? false)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (session) loadTeam()
  }, [session, loadTeam])

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
      const data = await apiFetch('/api/teams', session, {
        method: 'POST',
        body: JSON.stringify({ name: teamName.trim() }),
      })
      if (!data.success) throw new Error(data.message)
      await loadTeam()
    } catch (err: any) {
      setCreateError(err.message ?? 'Erro ao criar time.')
      setCreateStatus('error')
    } finally {
      setCreateStatus('idle')
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !team) return
    setInviteError('')
    setInviteStatus('loading')
    try {
      const data = await apiFetch(`/api/teams/${team.id}/invite`, session, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      if (!data.success) throw new Error(data.message)
      setInviteStatus('success')
      setInviteEmail('')
      await loadTeam()
      setTimeout(() => setInviteStatus('idle'), 3000)
    } catch (err: any) {
      setInviteError(err.message ?? 'Erro ao enviar convite.')
      setInviteStatus('error')
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
      await loadTeam()
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
      await loadTeam()
    } finally {
      setRemovingEmail(null)
    }
  }

  const formatDuration = (s: number | null) => {
    if (!s) return '0m'
    const m = Math.floor(s / 60)
    return `${m}m`
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
  if (!team) {
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
          <div className="bg-white border border-[#E0E0E0] rounded-2xl p-6 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Nome do time
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTeam()}
                placeholder="Ex: Time Comercial"
                className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-white placeholder:text-[#999]"
              />
            </div>
            {createError && (
              <p className="text-xs text-[#DC3545] flex items-center gap-1.5">
                <AlertCircle size={13} /> {createError}
              </p>
            )}
            <button
              onClick={handleCreateTeam}
              disabled={createStatus === 'loading' || !teamName.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50 shadow-sm"
            >
              {createStatus === 'loading' ? <Loader size={15} className="animate-spin" /> : <Plus size={15} />}
              Criar time
            </button>
          </div>
        </div>
      </MainLayout>
    )
  }

  // ── Time existente ────────────────────────────────────────────
  const activeCount = members.filter(m => m.status === 'active').length
  const pendingCount = members.filter(m => m.status === 'invited').length

  return (
    <MainLayout>
      <div className="space-y-6">

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

            {/* Coluna lateral: convidar (só owner) */}
            {isOwner && (
              <div className="space-y-4">
                <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                      <UserPlus size={14} className="text-[#2D5A27]" />
                    </div>
                    <span className="text-sm font-semibold text-[#333333]">Convidar membro</span>
                  </div>
                  <p className="text-xs text-[#666666] leading-relaxed">
                    Informe o e-mail do colaborador. Ele receberá um link de acesso por e-mail.
                  </p>
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                      placeholder="email@exemplo.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition bg-white placeholder:text-[#999]"
                    />
                    <button
                      onClick={handleInvite}
                      disabled={inviteStatus === 'loading' || !inviteEmail.trim()}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition shadow-sm ${
                        inviteStatus === 'success'
                          ? 'bg-[#4CAF50] text-white'
                          : 'bg-[#2D5A27] text-white hover:bg-[#1E3D1A] disabled:opacity-50'
                      }`}
                    >
                      {inviteStatus === 'loading' ? (
                        <Loader size={15} className="animate-spin" />
                      ) : inviteStatus === 'success' ? (
                        <CheckCircle size={15} />
                      ) : (
                        <Mail size={15} />
                      )}
                      {inviteStatus === 'success' ? 'Convite enviado!' : 'Enviar convite'}
                    </button>
                  </div>
                  {inviteError && (
                    <p className="text-xs text-[#DC3545] flex items-center gap-1.5">
                      <AlertCircle size={13} /> {inviteError}
                    </p>
                  )}
                </div>

                {/* Info extra */}
                <div className="bg-[#F8F9FA] border border-[#F0F0F0] rounded-2xl p-5 space-y-3">
                  <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider">Como funciona</p>
                  <ul className="space-y-2.5 text-xs text-[#666666] leading-relaxed">
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                      Digite o e-mail do colaborador e clique em "Enviar convite".
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                      Ele receberá um link por e-mail para acessar o Lemon.meet.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#2D5A27]/15 text-[#2D5A27] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                      Após o primeiro login, ficará ativo na lista de membros.
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
    </MainLayout>
  )
}

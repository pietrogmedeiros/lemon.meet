import { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Users, Plus, Mail, Trash2, CheckCircle, Clock,
  AlertCircle, Loader, Video, Crown, UserPlus, ChevronRight
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
          <Loader size={28} className="animate-spin text-primary" />
        </div>
      </MainLayout>
    )
  }

  // ── Sem time → formulário de criação ─────────────────────────
  if (!team) {
    return (
      <MainLayout>
        <div className="max-w-md mx-auto mt-16 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Users size={32} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-1 text-primary">Criar meu time</h1>
            <p className="mt-2 text-secondary text-sm">
              Crie um time para compartilhar reuniões com sua equipe.
            </p>
          </div>
          <div className="bg-white border border-neutral-light rounded-2xl p-6 space-y-4 text-left">
            <div className="space-y-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">
                Nome do time
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTeam()}
                placeholder="Ex: Time Comercial"
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-light text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </div>
            {createError && (
              <p className="text-xs text-danger flex items-center gap-1">
                <AlertCircle size={12} /> {createError}
              </p>
            )}
            <button
              onClick={handleCreateTeam}
              disabled={createStatus === 'loading' || !teamName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition disabled:opacity-60"
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
  return (
    <MainLayout>
      <div className="max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-headline-1 text-primary flex items-center gap-2">
              <Users size={24} />
              {team.name}
            </h1>
            <p className="mt-1 text-secondary text-sm">
              {members.filter(m => m.status === 'active').length} membro(s) ativos
              {members.filter(m => m.status === 'invited').length > 0 &&
                ` · ${members.filter(m => m.status === 'invited').length} convite(s) pendente(s)`}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-neutral-lighter rounded-xl p-1 w-fit">
          {(['members', 'meetings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'
              }`}
            >
              {t === 'members' ? 'Membros' : 'Reuniões do Time'}
            </button>
          ))}
        </div>

        {/* ── ABA MEMBROS ── */}
        {tab === 'members' && (
          <div className="space-y-4">
            {/* Convidar */}
            {isOwner && (
              <div className="bg-white border border-neutral-light rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus size={17} className="text-primary" />
                  <span className="text-sm font-semibold text-primary">Convidar membro</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                    placeholder="email@exemplo.com"
                    className="flex-1 px-4 py-2.5 rounded-xl border border-neutral-light text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviteStatus === 'loading' || !inviteEmail.trim()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition disabled:opacity-60 shrink-0"
                  >
                    {inviteStatus === 'loading' ? (
                      <Loader size={15} className="animate-spin" />
                    ) : inviteStatus === 'success' ? (
                      <CheckCircle size={15} />
                    ) : (
                      <Mail size={15} />
                    )}
                    {inviteStatus === 'success' ? 'Enviado!' : 'Convidar'}
                  </button>
                </div>
                {inviteError && (
                  <p className="text-xs text-danger flex items-center gap-1">
                    <AlertCircle size={12} /> {inviteError}
                  </p>
                )}
              </div>
            )}

            {/* Lista de membros */}
            <div className="bg-white border border-neutral-light rounded-2xl divide-y divide-neutral-light overflow-hidden">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {(m.name ?? m.invited_email)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-primary truncate">
                        {m.name ?? m.invited_email}
                      </span>
                      {m.role === 'admin' && (
                        <span title="Admin">
                          <Crown size={13} className="text-accent shrink-0" />
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-secondary truncate">{m.invited_email}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {m.status === 'active' ? (
                      <span className="flex items-center gap-1 text-xs text-success font-medium">
                        <CheckCircle size={12} /> Ativo
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-secondary">
                        <Clock size={12} /> Pendente
                      </span>
                    )}
                    {isOwner && m.role !== 'admin' && (
                      <button
                        onClick={() => handleRemove(m.invited_email)}
                        disabled={removingEmail === m.invited_email}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-mid hover:text-danger hover:bg-danger/5 transition"
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
        )}

        {/* ── ABA REUNIÕES ── */}
        {tab === 'meetings' && (
          <div className="space-y-3">
            {meetingsLoading ? (
              <div className="flex justify-center py-16">
                <Loader size={24} className="animate-spin text-primary" />
              </div>
            ) : meetings.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-secondary gap-3">
                <Video size={36} className="opacity-30" />
                <span className="text-sm">Nenhuma reunião encontrada no time.</span>
              </div>
            ) : (
              meetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => navigate(`/meetings/${m.id}`)}
                  className="w-full bg-white border border-neutral-light rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-primary/30 hover:shadow-sm transition text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Video size={16} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-primary truncate">
                      {m.title ?? m.id.split('-')[0]}
                    </div>
                    <div className="text-xs text-secondary mt-0.5 flex items-center gap-2">
                      <span>{m.member_name}</span>
                      <span>·</span>
                      <span>{formatDate(m.started_at ?? '')}</span>
                      <span>·</span>
                      <span>{formatDuration(m.duration_seconds)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.status === 'completed' ? (
                      <span className="text-xs text-success font-medium">Concluída</span>
                    ) : m.status === 'error' ? (
                      <span className="text-xs text-danger font-medium">Erro</span>
                    ) : (
                      <span className="text-xs text-secondary">{m.status}</span>
                    )}
                    <ChevronRight size={16} className="text-neutral-mid" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </MainLayout>
  )
}

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, ChevronRight, Search, X, User, Users, FileText } from 'lucide-react';
import { formatDate, formatTime } from '@/lib';
import { fetchMeetings as fetchMeetingsCache, type Meeting } from '@/lib/meetingsCache';
import { supabase } from '@/lib/supabase';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface TeamOption {
  id: string;
  name: string;
  isOwner?: boolean;
}

interface TeamMeeting extends Meeting {
  member_name?: string | null;
}

export function MeetingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'mine' | 'team'>(() => {
    return (localStorage.getItem('meetings-view-mode') as 'mine' | 'team') || 'mine';
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(() => {
    return localStorage.getItem('meetings-selected-team') || 'all';
  });

  // Persiste viewMode no localStorage
  useEffect(() => {
    localStorage.setItem('meetings-view-mode', viewMode);
  }, [viewMode]);

  // Persiste selectedTeamId no localStorage
  useEffect(() => {
    localStorage.setItem('meetings-selected-team', selectedTeamId);
  }, [selectedTeamId]);

  useEffect(() => {
    const loadSessionAndTeams = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setMeetings([]);
          setTeams([]);
          setIsLoading(false);
          return;
        }

        setCurrentUserId(session.user.id);

        const res = await fetch(`${API}/api/teams`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) {
          throw new Error('Falha ao carregar times do usuário');
        }

        const json = await res.json();
        const nextTeams: TeamOption[] = json.teams ?? [];
        setTeams(nextTeams);
      } catch (err) {
        console.error('[MeetingsPage] Erro ao carregar sessão/times:', err);
        setTeams([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadSessionAndTeams();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!currentUserId) return;

      setIsLoading(true);
      setUserFilter('all');

      try {
        if (viewMode === 'mine') {
          const data = await fetchMeetingsCache();
          setMeetings(data.filter(meeting => meeting.user_id === currentUserId));
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setMeetings([]);
          return;
        }

        const teamIdsToLoad = selectedTeamId === 'all'
          ? teams.map(team => team.id)
          : teams.filter(team => team.id === selectedTeamId).map(team => team.id);

        if (!teamIdsToLoad.length) {
          setMeetings([]);
          return;
        }

        const responses = await Promise.all(
          teamIdsToLoad.map(async (teamId) => {
            const response = await fetch(`${API}/api/teams/${teamId}/meetings`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!response.ok) {
              throw new Error(`Falha ao carregar reuniões do time ${teamId}`);
            }

            const json = await response.json();
            return (json.meetings ?? []).map((meeting: TeamMeeting) => ({
              ...meeting,
              team_id: meeting.team_id ?? teamId,
              user_name: meeting.user_name ?? meeting.member_name ?? meeting.user_id,
              user_avatar_url: meeting.user_avatar_url ?? null,
            } as Meeting));
          })
        );

        const dedupedMeetings = Array.from(
          new Map(
            responses
              .flat()
              .map(meeting => [meeting.id, meeting])
          ).values()
        ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setMeetings(dedupedMeetings);
      } catch (err) {
        console.error('[MeetingsPage] Erro ao carregar reuniões:', err);
        setMeetings([]);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [currentUserId, selectedTeamId, teams, viewMode]);

  const getStatusBadge = (status: string | null) => {
    if (status === 'completed') return <Badge variant="success">Concluída</Badge>;
    if (status === 'recording') return <Badge variant="danger">Gravando</Badge>;
    if (status === 'processing') return <Badge variant="secondary">Processando</Badge>;
    if (status === 'failed') return <Badge variant="danger">Falhou</Badge>;
    return <Badge variant="secondary">{status ?? 'Desconhecido'}</Badge>;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const STATUS_OPTIONS = [
    { value: 'all',        label: 'Todos' },
    { value: 'completed',  label: 'Concluída' },
    { value: 'processing', label: 'Processando' },
    { value: 'recording',  label: 'Gravando' },
    { value: 'requesting', label: 'Solicitando' },
  ];

  const uniqueUsers = useMemo(() => {
    const map = new Map<string, { name: string; avatar_url: string | null }>();
    meetings.forEach(m => {
      if (m.user_id && !map.has(m.user_id)) {
        map.set(m.user_id, {
          name: m.user_name ?? m.user_id,
          avatar_url: m.user_avatar_url ?? null,
        });
      }
    });
    return Array.from(map.entries()).map(([id, info]) => ({ id, ...info }));
  }, [meetings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meetings.filter(m => {
      const matchesSearch = !q ||
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.meet_link ?? '').toLowerCase().includes(q) ||
        (m.platform ?? '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchesUser = userFilter === 'all' || m.user_id === userFilter;
      const matchesTeam = selectedTeamId === 'all' || m.team_id === selectedTeamId;
      
      return matchesSearch && matchesStatus && matchesUser && matchesTeam;
    });
  }, [meetings, search, statusFilter, userFilter, selectedTeamId]);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-headline-1 text-primary">{t('nav.meetings', 'Reuniões')}</h1>
          <p className="mt-2 text-body-large text-secondary">
            {t('meetings.subtitle', 'Acompanhe todas as suas reuniões transcritas e insights gerados')}
          </p>
        </div>

        {!isLoading && (meetings.length > 0 || teams.length > 0) && (
          <div className="flex items-center gap-1.5 bg-[#F5F5F5] rounded-xl p-1 w-fit">
            <button
              onClick={() => {
                setViewMode('mine');
                setUserFilter('all');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'mine'
                  ? 'bg-white text-[#2D5A27] shadow-sm font-semibold'
                  : 'text-[#666666] hover:text-[#333333]'
              }`}
            >
              <User size={14} />
              Minhas Reuniões
            </button>
            <button
              onClick={() => {
                setViewMode('team');
                setUserFilter('all');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'team'
                  ? 'bg-white text-[#2D5A27] shadow-sm font-semibold'
                  : 'text-[#666666] hover:text-[#333333]'
              }`}
            >
              <Users size={14} />
              Reuniões do Time
            </button>
          </div>
        )}

        {!isLoading && viewMode === 'team' && teams.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#666666] mr-1">Filtrar por time:</span>
            <button
              onClick={() => setSelectedTeamId('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                selectedTeamId === 'all'
                  ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                  : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
              }`}
            >
              Todos os times
            </button>
            {teams.map(team => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                  selectedTeamId === team.id
                    ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                    : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                }`}
              >
                {team.name}
              </button>
            ))}
          </div>
        )}

        {!isLoading && meetings.length > 0 && (
          <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Campo de busca */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por título, plataforma..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-[#E0E0E0] bg-white text-[#333333] placeholder:text-[#BBBBBB] focus:outline-none focus:border-[#2D5A27] focus:ring-1 focus:ring-[#2D5A27]/30 transition"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#BBBBBB] hover:text-[#666666] transition"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filtro por status */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                    statusFilter === opt.value
                      ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                      : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtro por usuário - aparece se houver múltiplos usuários */}
          {uniqueUsers.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[#666666] mr-1">Filtrar por pessoa:</span>
              <button
                onClick={() => setUserFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                  userFilter === 'all'
                    ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                    : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                }`}
              >
                Todos os membros
              </button>
              {uniqueUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => setUserFilter(u.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                    userFilter === u.id
                      ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                      : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                  }`}
                >
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt={u.name} className="w-4 h-4 rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-current/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-2.5 h-2.5" />
                    </div>
                  )}
                  {u.name}
                </button>
              ))}
            </div>
          )}
          </>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Video className="h-12 w-12 text-neutral-mid" />
            <h3 className="mt-4 text-headline-2 text-primary">Nenhuma reunião encontrada</h3>
            <p className="mt-2 text-body-large text-secondary">Use a extensão para gravar sua primeira reunião</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="h-10 w-10 text-neutral-mid" />
            <h3 className="mt-4 text-headline-2 text-primary">Nenhum resultado</h3>
            <p className="mt-2 text-body-large text-secondary">Tente outros termos ou remova os filtros</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((meeting) => (
              <Card
                key={meeting.id}
                onClick={() => navigate(`/meetings/${meeting.id}`)}
                className="p-5 cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Video className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="text-headline-2 text-primary leading-tight">
                      {meeting.title || meeting.meet_link || 'Reunião sem título'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {uniqueUsers.length > 1 && (
                      <div title={meeting.user_name ?? undefined}>
                        {meeting.user_avatar_url ? (
                          <img
                            src={meeting.user_avatar_url}
                            alt={meeting.user_name ?? 'Usuário'}
                            className="w-6 h-6 rounded-full object-cover ring-1 ring-neutral-light"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center ring-1 ring-neutral-light">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                        )}
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 text-neutral-mid group-hover:text-primary transition-colors" />
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  {getStatusBadge(meeting.status)}
                  {(meeting.has_transcript ?? (meeting.transcript && meeting.transcript.trim().length > 0)) ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#2D5A27]/10 text-[#2D5A27] border border-[#2D5A27]/20">
                      <FileText className="w-3 h-3" />
                      Com transcrição
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#999999]/10 text-[#666666] border border-[#CCCCCC]">
                      <FileText className="w-3 h-3" />
                      Sem transcrição
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-body-small text-secondary">
                  {meeting.platform && (
                    <div className="flex items-center gap-2">
                      <Video className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="capitalize">{meeting.platform.replace('_', ' ')}</span>
                    </div>
                  )}
                  {meeting.duration_seconds && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{formatDuration(meeting.duration_seconds)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{formatDate(meeting.created_at, i18n.language as any)}</span>
                    <span className="ml-1">{formatTime(meeting.created_at)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

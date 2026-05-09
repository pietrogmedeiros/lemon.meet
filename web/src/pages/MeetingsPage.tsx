import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, ChevronRight, Search, X, User, Users } from 'lucide-react';
import { formatDate, formatTime } from '@/lib';
import { fetchMeetings as fetchMeetingsCache, type Meeting } from '@/lib/meetingsCache';
import { supabase } from '@/lib/supabase';

export function MeetingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'mine' | 'team'>('mine'); // Novo: modo de visualização
  const [currentUserId, setCurrentUserId] = useState<string | null>(null); // Novo: ID do usuário atual
  const [userTeamIds, setUserTeamIds] = useState<string[]>([]); // Novo: IDs dos times do usuário

  useEffect(() => {
    console.log('[MeetingsPage] 🔍 Verificando sessão e times...')
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.log('[MeetingsPage] ❌ Sem sessão')
          return;
        }
        
        console.log('[MeetingsPage] 👤 User ID:', session.user.id)
        console.log('[MeetingsPage] 📧 Email:', session.user.email)
        setCurrentUserId(session.user.id);

        // Buscar times onde o usuário é owner
        const { data: ownedTeams } = await supabase
          .from('teams')
          .select('id')
          .eq('owner_id', session.user.id);

        // Buscar times onde o usuário é member
        const { data: memberTeams } = await supabase
          .from('team_members')
          .select('team_id')
          .eq('user_id', session.user.id)
          .eq('status', 'active');

        // Combinar IDs de todos os times
        const teamIds = [
          ...(ownedTeams?.map(t => t.id) || []),
          ...(memberTeams?.map(t => t.team_id) || [])
        ];
        
        const uniqueTeamIds = [...new Set(teamIds)];
        console.log('[MeetingsPage] 🏢 Times do usuário:', uniqueTeamIds);
        setUserTeamIds(uniqueTeamIds);
      } catch (err) {
        console.error('[MeetingsPage] ❌ Erro ao verificar sessão:', err);
      }
    };
    
    checkSession();
  }, []);

  useEffect(() => {
    console.log('[MeetingsPage] 🔄 Carregando reuniões, viewMode:', viewMode)
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchMeetingsCache();
        console.log('[MeetingsPage] 📦 Reuniões carregadas:', data.length)
        
        // DEBUG: Verificar team_id das reuniões
        const teamIdCounts = data.reduce((acc, m) => {
          const tid = m.team_id || 'null';
          acc[tid] = (acc[tid] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log('[MeetingsPage] 🔍 Distribuição de team_ids:', teamIdCounts);
        
        setMeetings(data);
      } catch (err) {
        console.error('[MeetingsPage] ❌ Erro ao buscar reuniões:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [viewMode]); // Recarrega quando viewMode muda

  const getStatusBadge = (status: string | null) => {
    if (status === 'completed') return <Badge variant="success">Concluída</Badge>;
    if (status === 'recording') return <Badge variant="danger">Gravando</Badge>;
    if (status === 'processing') return <Badge variant="secondary">Processando</Badge>;
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
    const users = Array.from(map.entries()).map(([id, info]) => ({ id, ...info }));
    console.log('[MeetingsPage] 👥 Usuários únicos encontrados:', users.length, users);
    return users;
  }, [meetings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = meetings;

    console.log('[MeetingsPage] Filtro:', viewMode, 'meetings:', meetings.length);

    // Filtro por modo de visualização
    if (viewMode === 'mine' && currentUserId) {
      result = result.filter(m => m.user_id === currentUserId);
      console.log('[MeetingsPage] MINE:', result.length);
    } else if (viewMode === 'team' && userTeamIds.length > 0) {
      console.log('[MeetingsPage] TEAM filter - userTeamIds:', userTeamIds);
      result = result.filter(m => m.team_id && userTeamIds.includes(m.team_id));
      console.log('[MeetingsPage] TEAM result:', result.length);
    }

    // Filtros normais
    return result.filter(m => {
      const matchesSearch = !q ||
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.meet_link ?? '').toLowerCase().includes(q) ||
        (m.platform ?? '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchesUser = userFilter === 'all' || m.user_id === userFilter;
      
      return matchesSearch && matchesStatus && matchesUser;
    });
  }, [meetings, search, statusFilter, userFilter, viewMode, currentUserId, userTeamIds]);

  console.log('[MeetingsPage] 🎛️ Estado:', { 
    isLoading, 
    meetingsCount: meetings.length, 
    viewMode, 
    userTeamIds,
    filteredCount: filtered.length 
  });

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-headline-1 text-primary">{t('nav.meetings', 'Reuniões')}</h1>
          <p className="mt-2 text-body-large text-secondary">
            {t('meetings.subtitle', 'Acompanhe todas as suas reuniões transcritas e insights gerados')}
          </p>
        </div>

        {/* Toggle Minhas/Time - SEMPRE VISÍVEL se houver reuniões */}
        {!isLoading && meetings.length > 0 && (
          <div className="flex items-center gap-1.5 bg-[#F5F5F5] rounded-xl p-1 w-fit">
            <button
              onClick={() => {
                setViewMode('mine');
                setUserFilter('all'); // Reset user filter ao trocar
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
              onClick={() => setViewMode('team')}
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

        {/* ── Busca + filtro de status ── */}
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

                <div className="mb-3">{getStatusBadge(meeting.status)}</div>

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

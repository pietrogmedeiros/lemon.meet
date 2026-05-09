import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, TrendingUp, CheckCircle, Loader, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib';
import { fetchMeetings as fetchMeetingsCache, type Meeting } from '@/lib/meetingsCache';
import { supabase } from '@/lib/supabase';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  console.log('[Dashboard] 🏠 Componente montado')
  
  useEffect(() => {
    console.log('[Dashboard] 🔍 Verificando localStorage...')
    const pendingToken = localStorage.getItem('pending_team_join')
    if (pendingToken) {
      console.log('[Dashboard] ✅ Token encontrado no localStorage:', pendingToken)
    } else {
      console.log('[Dashboard] ℹ️ Nenhum token pendente no localStorage')
    }
    
    // Lista todas as chaves do localStorage para debug
    console.log('[Dashboard] 📦 Chaves no localStorage:', Object.keys(localStorage))
    
    fetchMeetings();
  }, []);

  // Processa convite pendente após login/cadastro
  useEffect(() => {
    const processPendingTeamJoin = async () => {
      const pendingToken = localStorage.getItem('pending_team_join');
      if (!pendingToken) {
        console.log('[Dashboard] Nenhum convite pendente encontrado');
        return;
      }

      console.log('[Dashboard] 🔍 Detectado convite pendente, processando token:', pendingToken);

      // Aguarda um pouco para garantir que a sessão está pronta
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[Dashboard] Erro ao obter sessão:', sessionError);
          return;
        }

        if (!session) {
          console.error('[Dashboard] ❌ Sessão não disponível, aguardando...');
          // Tenta novamente em 2 segundos
          setTimeout(processPendingTeamJoin, 2000);
          return;
        }

        console.log('[Dashboard] ✅ Sessão disponível, user_id:', session.user.id);
        console.log('[Dashboard] 📡 Chamando API /api/teams/join/' + pendingToken);

        const res = await fetch(`${API}/api/teams/join/${pendingToken}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        console.log('[Dashboard] Status da resposta:', res.status);

        const data = await res.json();
        console.log('[Dashboard] Resposta da API:', data);

        if (data.success) {
          console.log('[Dashboard] 🎉 Convite aceito com sucesso! Time:', data.team?.name);
          localStorage.removeItem('pending_team_join');
          
          // Redireciona para página de times
          console.log('[Dashboard] Redirecionando para /team?joined=true');
          setTimeout(() => {
            navigate('/team?joined=true');
          }, 1000);
        } else {
          console.error('[Dashboard] ❌ Erro ao aceitar convite:', data.message);
          alert('Erro ao entrar no time: ' + data.message);
          localStorage.removeItem('pending_team_join');
        }
      } catch (err) {
        console.error('[Dashboard] ❌ Erro ao processar convite:', err);
        alert('Erro ao processar convite. Tente novamente mais tarde.');
        localStorage.removeItem('pending_team_join');
      }
    };

    processPendingTeamJoin();
  }, [navigate]);

  const fetchMeetings = async () => {
    setIsLoading(true);
    try {
      const data = await fetchMeetingsCache();
      setMeetings(data);
    } catch (err) {
      console.error('Erro ao buscar reuniões:', err);
    } finally {
      setIsLoading(false);
    }
  };

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

  const stats = {
    total: meetings.length,
    concluidas: meetings.filter(m => m.status === 'completed').length,
    processando: meetings.filter(m => m.status === 'processing' || m.status === 'recording').length,
  };

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const todayMeetings = meetings
    .filter(m => {
      const ts = m.started_at ? new Date(m.started_at) : null;
      return ts && ts >= todayStart && ts <= todayEnd;
    })
    .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-headline-1 text-primary">{t('dashboard.title', 'Dashboard')}</h1>
          <p className="mt-2 text-body-large text-secondary dark:text-gray-400">
            {t('dashboard.subtitle', 'Visualize e gerencie suas reuniões')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">Total de Reuniões</p>
                <p className="mt-2 text-3xl font-bold text-primary">{stats.total}</p>
              </div>
              <div className="rounded-full bg-primary/10 p-3"><Video className="h-6 w-6 text-primary" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">Concluídas</p>
                <p className="mt-2 text-3xl font-bold text-primary">{stats.concluidas}</p>
              </div>
              <div className="rounded-full bg-success/10 p-3"><CheckCircle className="h-6 w-6 text-success" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">Em Processamento</p>
                <p className="mt-2 text-3xl font-bold text-primary">{stats.processando}</p>
              </div>
              <div className="rounded-full bg-neutral-light p-3"><Loader className="h-6 w-6 text-neutral-mid" /></div>
            </div>
          </Card>
        </div>

        {/* Reuniões de Hoje */}
        {todayMeetings.length > 0 && (
          <Card>
            <div className="border-b border-neutral-light dark:border-gray-700 p-6">
              <h2 className="text-headline-2 text-primary">Hoje</h2>
            </div>
            <div className="divide-y divide-neutral-light dark:divide-gray-700">
              {todayMeetings.map(meeting => (
                <div key={meeting.id} className="flex items-center justify-between p-4 gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        onClick={() => navigate(`/meetings/${meeting.id}`)}
                        className="cursor-pointer font-medium text-primary hover:underline truncate"
                      >
                        {meeting.title || 'Reunião sem título'}
                      </span>
                      {getStatusBadge(meeting.status)}
                    </div>
                    {meeting.started_at && (
                      <p className="mt-0.5 text-body-small text-secondary">
                        {new Date(meeting.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  {meeting.meet_link && (
                    <a
                      href={meeting.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-body-small font-medium text-white hover:bg-primary/90 transition-colors shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Entrar
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="border-b border-neutral-light dark:border-gray-700 p-6">
            <h2 className="text-headline-2 text-primary">Reuniões Recentes</h2>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
            </div>
          ) : meetings.length === 0 ? (
            <div className="p-12 text-center">
              <Video className="mx-auto h-12 w-12 text-neutral-mid" />
              <h3 className="mt-4 text-headline-2 text-primary">Nenhuma reunião encontrada</h3>
              <p className="mt-2 text-body-large text-secondary">Use a extensão para gravar sua primeira reunião</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-light dark:divide-gray-700">
              {meetings.map((meeting) => (
                <div
                  key={meeting.id}
                  onClick={() => navigate(`/meetings/${meeting.id}`)}
                  className="cursor-pointer p-6 transition-colors hover:bg-neutral-light/30 dark:hover:bg-gray-700/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-headline-2 text-primary">
                          {meeting.title || 'Reunião sem título'}
                        </h3>
                        {getStatusBadge(meeting.status)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-body-small text-secondary">
                        {meeting.platform && (
                          <div className="flex items-center gap-2">
                            <Video className="h-3.5 w-3.5" />
                            <span className="capitalize">{meeting.platform.replace('_', ' ')}</span>
                          </div>
                        )}
                        {meeting.duration_seconds && (
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatDuration(meeting.duration_seconds)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{formatDate(meeting.created_at, i18n.language as any)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {meeting.meet_link && (
                        <a
                          href={meeting.meet_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-secondary hover:text-primary transition-colors"
                          title="Abrir link da reunião"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <TrendingUp className="h-5 w-5 text-neutral-mid" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </MainLayout>
  );
}


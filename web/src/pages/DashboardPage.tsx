import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, TrendingUp, CheckCircle, Loader } from 'lucide-react';
import { formatDate } from '@/lib';
import { supabase } from '@/lib/supabase';

interface Meeting {
  id: string;
  title: string | null;
  platform: string | null;
  status: string | null;
  meet_link: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/meetings?limit=50`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings || []);
      }
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
                          {meeting.title || meeting.meet_link || 'Reunião sem título'}
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
                    <TrendingUp className="h-5 w-5 text-neutral-mid" />
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


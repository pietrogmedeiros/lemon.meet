import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, ChevronRight, Search, X } from 'lucide-react';
import { formatDate, formatTime } from '@/lib';
import { fetchMeetings as fetchMeetingsCache, type Meeting } from '@/lib/meetingsCache';

export function MeetingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    const load = async () => {
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
    load();
  }, []);

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
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meetings.filter(m => {
      const matchesSearch = !q ||
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.meet_link ?? '').toLowerCase().includes(q) ||
        (m.platform ?? '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [meetings, search, statusFilter]);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-headline-1 text-primary">{t('nav.meetings', 'Reuniões')}</h1>
          <p className="mt-2 text-body-large text-secondary">
            {t('meetings.subtitle', 'Acompanhe todas as suas reuniões transcritas e insights gerados')}
          </p>
        </div>

        {/* ── Busca + filtro de status ── */}
        {!isLoading && meetings.length > 0 && (
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
                  <ChevronRight className="h-4 w-4 text-neutral-mid group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
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

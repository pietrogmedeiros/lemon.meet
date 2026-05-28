import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import { Video, Clock, Calendar, ExternalLink, CalendarCheck } from 'lucide-react';
import { fetchMeetings, type Meeting } from '@/lib/meetingsCache';

function getTimeLabel(startedAt: string): { label: string; urgent: boolean } {
  const now = new Date();
  const start = new Date(startedAt);
  const diffMs = start.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin <= 0) return { label: 'Agora', urgent: true };
  if (diffMin < 60) return { label: `Em ${diffMin} min`, urgent: true };

  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 24) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return { label: m > 0 ? `Em ${h}h ${m}min` : `Em ${h}h`, urgent: false };
  }

  const days = Math.ceil(diffHours / 24);
  if (days === 1) return { label: 'Amanhã', urgent: false };
  return { label: `Em ${days} dias`, urgent: false };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isTomorrow(iso: string): boolean {
  const d = new Date(iso);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString();
}

function getPlatformLabel(platform: string | null): string {
  if (!platform) return 'Vídeo';
  if (platform === 'google_meet') return 'Google Meet';
  if (platform === 'zoom') return 'Zoom';
  if (platform === 'teams') return 'Microsoft Teams';
  return platform.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getPlatformColor(platform: string | null): string {
  if (platform === 'google_meet') return 'bg-blue-50 text-blue-700';
  if (platform === 'zoom') return 'bg-sky-50 text-sky-700';
  if (platform === 'teams') return 'bg-purple-50 text-purple-700';
  return 'bg-gray-50 text-gray-600';
}

function groupByDay(meetings: Meeting[]): { label: string; items: Meeting[] }[] {
  const groups: Record<string, { label: string; items: Meeting[] }> = {};
  for (const m of meetings) {
    const key = new Date(m.started_at!).toDateString();
    if (!groups[key]) {
      let label: string;
      if (isToday(m.started_at!)) label = 'Hoje';
      else if (isTomorrow(m.started_at!)) label = 'Amanhã';
      else label = formatDate(m.started_at!);
      groups[key] = { label, items: [] };
    }
    groups[key].items.push(m);
  }
  return Object.values(groups);
}

export function UpcomingMeetingsPage() {
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const all = await fetchMeetings();
        const now = new Date();
        const filtered = all
          .filter(m =>
            (m.status === 'requesting' || m.status === 'pending') &&
            m.started_at &&
            new Date(m.started_at) > now
          )
          .sort((a, b) =>
            new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime()
          );
        setUpcoming(filtered);
      } catch (err) {
        console.error('Erro ao buscar próximas reuniões:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const groups = groupByDay(upcoming);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-headline-1 text-primary">Próximas Reuniões</h1>
            <p className="mt-1 text-body-large text-secondary">
              {isLoading ? '' : upcoming.length > 0
                ? `${upcoming.length} reunião${upcoming.length > 1 ? 'ões' : ''} agendada${upcoming.length > 1 ? 's' : ''}`
                : 'Nenhuma reunião agendada'
              }
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5">
            <CalendarCheck className="h-5 w-5 text-primary" />
            <span className="text-body-small font-medium text-primary">Bot automático ativo</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          </div>
        ) : upcoming.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-primary/10 p-5 mb-4">
              <Calendar className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-headline-2 text-primary">Nenhuma reunião agendada</h3>
            <p className="mt-2 text-body-large text-secondary max-w-sm">
              Crie eventos no Google Calendar com link do Google Meet e o bot Lemon entrará automaticamente
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {groups.map(group => (
              <div key={group.label}>
                {/* Divisor de dia */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-body-small font-semibold text-primary uppercase tracking-wide">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-neutral-light dark:bg-gray-700" />
                  <span className="text-body-small text-secondary">{group.items.length} reuni{group.items.length > 1 ? 'ões' : 'ão'}</span>
                </div>

                <div className="space-y-3">
                  {group.items.map(meeting => {
                    const { label: timeLabel, urgent } = getTimeLabel(meeting.started_at!);
                    const todayMeeting = isToday(meeting.started_at!);

                    return (
                      <div
                        key={meeting.id}
                        className={`rounded-xl border bg-surface dark:bg-gray-800 p-5 transition-shadow hover:shadow-md ${
                          todayMeeting
                            ? 'border-primary/30 shadow-sm shadow-primary/10'
                            : 'border-neutral-light dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Hora */}
                          <div className="hidden sm:flex flex-col items-center justify-center w-16 shrink-0">
                            <span className="text-xl font-bold text-primary leading-none">
                              {formatTime(meeting.started_at!)}
                            </span>
                          </div>

                          {/* Divider vertical */}
                          <div className="hidden sm:block w-px h-12 bg-neutral-light dark:bg-gray-700 shrink-0" />

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="font-semibold text-primary dark:text-white text-[15px] truncate">
                                {meeting.title || 'Reunião sem título'}
                              </h3>
                              {meeting.platform && (
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getPlatformColor(meeting.platform)}`}>
                                  <Video className="h-3 w-3" />
                                  {getPlatformLabel(meeting.platform)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-body-small text-secondary sm:hidden">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{formatTime(meeting.started_at!)}</span>
                            </div>
                          </div>

                          {/* Direita: countdown + botão */}
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                              urgent
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-neutral-light text-secondary dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              <Clock className="h-3.5 w-3.5" />
                              {timeLabel}
                            </span>
                            {meeting.meet_link && (
                              <a
                                href={meeting.meet_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 active:scale-95 transition-all"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Entrar
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

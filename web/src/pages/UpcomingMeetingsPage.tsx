import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { Video, Clock, Calendar, ExternalLink } from 'lucide-react';
import { fetchMeetings, type Meeting } from '@/lib/meetingsCache';

function getTimeLabel(startedAt: string): string {
  const now = new Date();
  const start = new Date(startedAt);
  const diffMs = start.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin < 0) return 'Agora';
  if (diffMin < 60) return `Em ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `Em ${h}h ${m}min` : `Em ${h}h`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPlatformLabel(platform: string | null): string {
  if (!platform) return 'Vídeo';
  return platform.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
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

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-headline-1 text-primary">Próximas Reuniões</h1>
          <p className="mt-2 text-body-large text-secondary">
            Reuniões agendadas via Google Calendar com o bot Lemon
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          </div>
        ) : upcoming.length === 0 ? (
          <Card className="p-12 text-center">
            <Calendar className="mx-auto h-12 w-12 text-neutral-mid" />
            <h3 className="mt-4 text-headline-2 text-primary">Nenhuma reunião agendada</h3>
            <p className="mt-2 text-body-large text-secondary">
              Crie eventos no Google Calendar com link do Meet e o bot entrará automaticamente
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {upcoming.map(meeting => (
              <Card key={meeting.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-headline-2 text-primary truncate">
                        {meeting.title || 'Reunião sem título'}
                      </h3>
                      <Badge variant="secondary">Agendada</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-body-small text-secondary">
                      {meeting.started_at && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{formatDateTime(meeting.started_at)}</span>
                        </div>
                      )}
                      {meeting.platform && (
                        <div className="flex items-center gap-1.5">
                          <Video className="h-3.5 w-3.5" />
                          <span>{getPlatformLabel(meeting.platform)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {meeting.started_at && (
                      <span className="text-body-small font-semibold text-primary">
                        <Clock className="inline h-3.5 w-3.5 mr-1" />
                        {getTimeLabel(meeting.started_at)}
                      </span>
                    )}
                    {meeting.meet_link && (
                      <a
                        href={meeting.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-body-small font-medium text-white hover:bg-primary/90 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir Meet
                      </a>
                    )}
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

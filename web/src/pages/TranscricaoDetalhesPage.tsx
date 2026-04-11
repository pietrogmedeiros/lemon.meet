import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, Clock, Calendar, Mic, Target, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TranscriptSegment {
  id: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker: string | null;
  sequence: number;
  created_at: string;
}

interface MeetingInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  commercialQuality: number;
  executiveContext: string;
  closingProbability: number;
  followUp: string[];
  keyTopics: string[];
  actionItems: string[];
}

interface Meeting {
  id: string;
  title: string | null;
  platform: string;
  status: string;
  meet_link: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  insights: MeetingInsights | null;
  transcript: string | null;
  created_at: string;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'recording': return <Badge variant="danger">Gravando</Badge>;
    case 'processing': return <Badge variant="secondary">Processando</Badge>;
    case 'completed': return <Badge variant="success">Concluída</Badge>;
    case 'error': return <Badge variant="danger">Erro</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

export function TranscricaoDetalhesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/meetings/${id}`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
        if (!res.ok) {
          navigate('/meetings');
          return;
        }
        const data = await res.json();
        setMeeting(data.meeting);
        setSegments(data.segments || []);
      } catch {
        navigate('/meetings');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      </MainLayout>
    );
  }

  if (!meeting) {
    return (
      <MainLayout>
        <div className="text-center py-20">
          <h2 className="text-headline-1 text-primary">Reunião não encontrada</h2>
          <Button onClick={() => navigate('/meetings')} className="mt-4">
            Ver reuniões
          </Button>
        </div>
      </MainLayout>
    );
  }

  const duration = meeting.duration_seconds
    ? `${Math.floor(meeting.duration_seconds / 60)} min`
    : meeting.started_at && meeting.ended_at
    ? `${Math.floor((new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) / 60000)} min`
    : null;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/meetings')}
            className="flex items-center gap-1 mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-headline-1 text-primary">
                {meeting.title || `Reunião ${meeting.id.slice(0, 8)}`}
              </h1>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="mt-2 flex items-center gap-4 text-sm text-secondary flex-wrap">
              {meeting.platform && (
                <span className="capitalize">{meeting.platform.replace('_', ' ')}</span>
              )}
              {duration && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {duration}
                </span>
              )}
              {meeting.created_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(meeting.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: 'short', year: 'numeric'
                  })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Insights */}
        {meeting.insights && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Score & Sentiment */}
            <Card className="p-5">
              <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                <Target className="h-5 w-5" />
                Score Comercial
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-20 h-20 rounded-full border-4 border-accent flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {meeting.insights.commercialQuality ?? '–'}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="h-3 rounded-full bg-neutral-lighter overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${(meeting.insights.commercialQuality / 10) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-secondary">
                    Sentimento:{' '}
                    {meeting.insights.sentiment === 'positive' ? '😊 Positivo' :
                     meeting.insights.sentiment === 'negative' ? '😟 Negativo' : '😐 Neutro'}
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    Probabilidade de fechamento:{' '}
                    <strong className="text-primary">{meeting.insights.closingProbability}%</strong>
                  </p>
                </div>
              </div>
              {meeting.insights.executiveContext && (
                <p className="mt-4 text-sm text-secondary bg-neutral-lighter rounded-lg p-3 leading-relaxed">
                  {meeting.insights.executiveContext}
                </p>
              )}
            </Card>

            {/* Action items & Key topics */}
            <Card className="p-5">
              <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Próximos Passos
              </h2>
              {meeting.insights.actionItems?.length > 0 && (
                <ul className="space-y-2 mb-4">
                  {meeting.insights.actionItems.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-secondary">
                      <span className="text-primary font-bold mt-0.5">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {meeting.insights.keyTopics?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-2">Tópicos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {meeting.insights.keyTopics.map((topic, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Transcript segments */}
        <Card className="p-5">
          <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Transcrição
            <span className="ml-auto text-xs font-normal text-secondary">
              {segments.length} segmento{segments.length !== 1 ? 's' : ''}
            </span>
          </h2>
          {segments.length === 0 ? (
            <p className="text-secondary text-sm py-8 text-center">
              {meeting.status === 'recording' ? 'Gravando… os segmentos aparecerão aqui.' :
               meeting.status === 'processing' ? 'Processando transcrição…' :
               'Nenhum segmento de transcrição disponível.'}
            </p>
          ) : (
            <div className="space-y-3">
              {segments.map((seg) => (
                <div key={seg.id} className="flex gap-3">
                  <span className="text-xs text-secondary font-mono mt-0.5 w-12 flex-shrink-0">
                    {formatSeconds(seg.start_seconds)}
                  </span>
                  <p className="text-sm text-secondary leading-relaxed">{seg.text}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </MainLayout>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import {
  TrendingUp, TrendingDown, Minus, BarChart3,
  MessageSquare, Award, Calendar
} from 'lucide-react';
import { formatDate } from '@/lib';
import { supabase } from '@/lib/supabase';

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
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  insights: MeetingInsights | null;
  created_at: string;
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 8 ? 'bg-success' : score >= 5 ? 'bg-accent' : 'bg-danger';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2.5 rounded-full bg-neutral-lighter overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold text-primary w-8 text-right">{score}</span>
    </div>
  );
}

function ScoreTrendIcon({ scores }: { scores: number[] }) {
  if (scores.length < 2) return <Minus className="h-4 w-4 text-neutral-mid" />;
  const last = scores[scores.length - 1];
  const prev = scores[scores.length - 2];
  if (last > prev) return <TrendingUp className="h-4 w-4 text-success" />;
  if (last < prev) return <TrendingDown className="h-4 w-4 text-danger" />;
  return <Minus className="h-4 w-4 text-neutral-mid" />;
}

export function InsightsPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/meetings?limit=100`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setMeetings(data.meetings || []);
        }
      } catch {}
      finally { setIsLoading(false); }
    };
    load();
  }, []);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      </MainLayout>
    );
  }

  // Metrics derived from meetings
  const withScores = meetings
    .filter(m => m.insights?.commercialQuality != null)
    .map(m => ({ ...m, score: m.insights!.commercialQuality }));

  const avgScore = withScores.length
    ? Math.round((withScores.reduce((s, m) => s + m.score, 0) / withScores.length) * 10) / 10
    : null;

  const scores = withScores.map(m => m.score);
  const highQ = withScores.filter(m => m.score >= 8).length;
  const medQ = withScores.filter(m => m.score >= 5 && m.score < 8).length;
  const lowQ = withScores.filter(m => m.score < 5).length;

  const sortedByScore = [...withScores].sort((a, b) => b.score - a.score);

  // Aggregate key topics
  const topicCounts: Record<string, number> = {};
  meetings.forEach(m => {
    m.insights?.keyTopics?.forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
  });
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const total = meetings.length;
  const completed = meetings.filter(m => m.status === 'completed').length;

  const sentimentCounts = {
    positive: meetings.filter(m => m.insights?.sentiment === 'positive').length,
    neutral: meetings.filter(m => m.insights?.sentiment === 'neutral').length,
    negative: meetings.filter(m => m.insights?.sentiment === 'negative').length,
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-headline-1 text-primary">Insights</h1>
          <p className="mt-2 text-body-large text-secondary">
            Análise real extraída de {total} reunião{total !== 1 ? 'ões' : ''} gravada{total !== 1 ? 's' : ''}
          </p>
        </div>

        {total === 0 ? (
          <Card className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-neutral-mid mx-auto mb-4" />
            <h3 className="text-headline-2 text-primary">Nenhum dado disponível</h3>
            <p className="mt-2 text-secondary">Aguarde reuniões serem processadas para gerar insights.</p>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card className="p-5">
                <p className="text-xs font-medium text-secondary uppercase tracking-wider">Total de Reuniões</p>
                <p className="mt-2 text-3xl font-bold text-primary">{total}</p>
                <p className="mt-1 text-xs text-secondary">{completed} concluídas</p>
              </Card>

              {avgScore !== null && (
                <Card className="p-5">
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider">Score Médio</p>
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-3xl font-bold text-primary">{avgScore}</p>
                    <span className="text-secondary text-sm">/10</span>
                    <ScoreTrendIcon scores={scores} />
                  </div>
                  <p className="mt-1 text-xs text-secondary">baseado em {withScores.length} reunião{withScores.length !== 1 ? 'ões' : ''}</p>
                </Card>
              )}

              <Card className="p-5">
                <p className="text-xs font-medium text-secondary uppercase tracking-wider">Alta Qualidade</p>
                <p className="mt-2 text-3xl font-bold text-success">{highQ}</p>
                <p className="mt-1 text-xs text-secondary">score ≥ 8/10</p>
              </Card>

              <Card className="p-5">
                <p className="text-xs font-medium text-secondary uppercase tracking-wider">Atenção Necessária</p>
                <p className="mt-2 text-3xl font-bold text-danger">{lowQ}</p>
                <p className="mt-1 text-xs text-secondary">score &lt; 5/10</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Quality ranking */}
              {sortedByScore.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Award className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Ranking por Qualidade</h2>
                  </div>
                  <div className="space-y-3">
                    {sortedByScore.slice(0, 8).map((m, i) => (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/meetings/${m.id}`)}
                        className="flex items-center gap-3 cursor-pointer hover:bg-neutral-lighter rounded-lg px-2 py-1.5 transition-colors group"
                      >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          i === 0 ? 'bg-accent text-primary' :
                          i === 1 ? 'bg-neutral-light text-primary' :
                          i === 2 ? 'bg-orange-100 text-orange-700' :
                          'bg-neutral-lighter text-secondary'
                        }`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate group-hover:text-primary-light">
                            {m.title || `Reunião ${m.id.slice(0, 8)}`}
                          </p>
                          <p className="text-xs text-secondary">{formatDate(m.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}</p>
                        </div>
                        <ScoreBar score={m.score} />
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Quality distribution */}
              {withScores.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Distribuição de Qualidade</h2>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: 'Alta (8–10)', count: highQ, color: 'bg-success', textColor: 'text-success' },
                      { label: 'Média (5–7)', count: medQ, color: 'bg-accent', textColor: 'text-amber-600' },
                      { label: 'Baixa (0–4)', count: lowQ, color: 'bg-danger', textColor: 'text-danger' },
                    ].map(({ label, count, color, textColor }) => (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="font-medium text-primary">{label}</span>
                          <span className={`font-bold ${textColor}`}>{count} reunião{count !== 1 ? 'ões' : ''}</span>
                        </div>
                        <div className="h-3 rounded-full bg-neutral-lighter overflow-hidden">
                          <div
                            className={`h-full rounded-full ${color} transition-all duration-700`}
                            style={{ width: withScores.length ? `${(count / withScores.length) * 100}%` : '0%' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Sentiment distribution */}
              {meetings.filter(m => m.insights?.sentiment).length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Sentimento das Reuniões</h2>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: 'Positivo', count: sentimentCounts.positive, color: 'bg-success', emoji: '😊' },
                      { label: 'Neutro', count: sentimentCounts.neutral, color: 'bg-accent', emoji: '😐' },
                      { label: 'Negativo', count: sentimentCounts.negative, color: 'bg-danger', emoji: '😟' },
                    ].map(({ label, count, color, emoji }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-lg w-6">{emoji}</span>
                        <div className="flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium text-primary">{label}</span>
                            <span className="text-secondary">{count}</span>
                          </div>
                          <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden">
                            <div className={`h-full rounded-full ${color}`} style={{ width: total ? `${(count / total) * 100}%` : '0%' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Key topics */}
              {topTopics.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Tópicos Frequentes</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {topTopics.map(([topic, count]) => (
                      <span
                        key={topic}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary"
                        style={{ backgroundColor: 'rgba(45,90,39,0.07)' }}
                      >
                        {topic}
                        {count > 1 && (
                          <span className="rounded-full bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">{count}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </Card>
              )}

              {/* Timeline */}
              {withScores.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Evolução das Reuniões</h2>
                  </div>
                  <div className="space-y-3">
                    {[...withScores]
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .map((m) => {
                        const scoreColor = m.score >= 8 ? 'bg-success' : m.score >= 5 ? 'bg-accent' : 'bg-danger';
                        return (
                          <div
                            key={m.id}
                            onClick={() => navigate(`/meetings/${m.id}`)}
                            className="flex items-center gap-3 cursor-pointer hover:bg-neutral-lighter rounded-lg px-2 py-2 transition-colors"
                          >
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${scoreColor}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-primary truncate">
                                {m.title || `Reunião ${m.id.slice(0, 8)}`}
                              </p>
                              <p className="text-xs text-secondary">{formatDate(m.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}</p>
                            </div>
                            <span className={`text-sm font-bold ${m.score >= 8 ? 'text-success' : m.score >= 5 ? 'text-amber-600' : 'text-danger'}`}>
                              {m.score}/10
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

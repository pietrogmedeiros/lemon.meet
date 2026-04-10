import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import {
  TrendingUp, TrendingDown, Minus, Users, Building2,
  BarChart3, MessageSquare, Award, Calendar
} from 'lucide-react';
import { formatDate } from '@/lib';

interface Transcricao {
  id: number;
  created_at: string;
  responsavel: string | null;
  'r:agente1': string | null;
  'r:agente2': string | null;
  'r:agente3': string | null;
  'r:agente4': string | null;
  status: boolean | null;
  email_lead: string | null;
}

// Extrai meet score de uma transcrição
function extractScore(t: Transcricao): number | null {
  try {
    const j = t['r:agente4'] ? JSON.parse(t['r:agente4']) : null;
    if (j?.meet_score) return parseFloat(String(j.meet_score).replace('/10', '').replace(',', '.').trim());
  } catch {}
  const m = (t['r:agente3'] || '').match(/[Nn]ota.*?[:\s]+([0-9]+(?:[.,][0-9]+)?)\s*\/\s*10/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

// Extrai JSON do agente 4
function getAgent4Json(t: Transcricao): any {
  try { return t['r:agente4'] ? JSON.parse(t['r:agente4']) : null; } catch { return null; }
}

// Extrai JSON do agente 1
function getAgent1Json(t: Transcricao): any {
  try { return t['r:agente1'] ? JSON.parse(t['r:agente1']) : null; } catch { return null; }
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
  const [transcricoes, setTranscricoes] = useState<Transcricao[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetch_ = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/transcricoes?limit=100`);
        if (res.ok) {
          const data = await res.json();
          setTranscricoes(data.transcricoes || []);
        }
      } catch {}
      finally { setIsLoading(false); }
    };
    fetch_();
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

  // ── Derivar métricas reais ──────────────────────────────────────────────────

  // Scores
  const withScores = transcricoes
    .map(t => ({ id: t.id, created_at: t.created_at, score: extractScore(t), t }))
    .filter(x => x.score !== null) as { id: number; created_at: string; score: number; t: Transcricao }[];

  const avgScore = withScores.length
    ? Math.round((withScores.reduce((s, x) => s + x.score, 0) / withScores.length) * 10) / 10
    : null;

  const scores = withScores.map(x => x.score);

  // Classificação de qualidade
  const highQ = withScores.filter(x => x.score >= 8).length;
  const medQ = withScores.filter(x => x.score >= 5 && x.score < 8).length;
  const lowQ = withScores.filter(x => x.score < 5).length;

  // Empresas mais frequentes (agente 1)
  const companyCounts: Record<string, number> = {};
  transcricoes.forEach(t => {
    const j = getAgent1Json(t);
    const companies: string[] = j?.otherCompaniesInvolved || [];
    companies.forEach(c => { companyCounts[c] = (companyCounts[c] || 0) + 1; });
  });
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Responsáveis + média de score
  const respMap: Record<string, { count: number; totalScore: number; scoredCount: number }> = {};
  transcricoes.forEach(t => {
    const name = t.responsavel || 'Desconhecido';
    if (!respMap[name]) respMap[name] = { count: 0, totalScore: 0, scoredCount: 0 };
    respMap[name].count++;
    const s = extractScore(t);
    if (s !== null) { respMap[name].totalScore += s; respMap[name].scoredCount++; }
  });
  const topResps = Object.entries(respMap)
    .map(([name, d]) => ({ name, count: d.count, avg: d.scoredCount ? Math.round((d.totalScore / d.scoredCount) * 10) / 10 : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Reuniões por qualidade (para o ranking)
  const sortedByScore = [...withScores].sort((a, b) => b.score - a.score);

  // Tópicos frequentes — extrai do agente 3 buscando padrões de "Análise", "Diagnóstico" etc.
  const topicKeywords: Record<string, number> = {};
  transcricoes.forEach(t => {
    const text = (t['r:agente3'] || '') + ' ' + (t['r:agente4'] || '');
    const keywords = [
      'compliance', 'LGPD', 'NR-1', 'integração', 'técnica', 'comercial',
      'proposta', 'follow-up', 'objeção', 'contrato', 'deadline', 'automação',
      'vendas', 'CRM', 'API', 'webhook', 'onboarding', 'demo', 'piloto'
    ];
    keywords.forEach(kw => {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        topicKeywords[kw] = (topicKeywords[kw] || 0) + 1;
      }
    });
  });
  const topTopics = Object.entries(topicKeywords)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const total = transcricoes.length;
  const ativas = transcricoes.filter(t => t.status === true).length;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-headline-1 text-primary">Insights</h1>
          <p className="mt-2 text-body-large text-secondary">
            Análise real extraída de {total} reunião{total !== 1 ? 'ões' : ''} transcritas
          </p>
        </div>

        {total === 0 ? (
          <Card className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-neutral-mid mx-auto mb-4" />
            <h3 className="text-headline-2 text-primary">Nenhum dado disponível</h3>
            <p className="mt-2 text-secondary">Aguarde reuniões serem transcritas para gerar insights.</p>
          </Card>
        ) : (
          <>
            {/* Cards de resumo */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card className="p-5">
                <p className="text-xs font-medium text-secondary uppercase tracking-wider">Total de Reuniões</p>
                <p className="mt-2 text-3xl font-bold text-primary">{total}</p>
                <p className="mt-1 text-xs text-secondary">{ativas} ativas</p>
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
              {/* Ranking por qualidade */}
              {sortedByScore.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Award className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Ranking por Qualidade</h2>
                  </div>
                  <div className="space-y-3">
                    {sortedByScore.slice(0, 8).map((x, i) => {
                      const j4 = getAgent4Json(x.t);
                      const j1 = getAgent1Json(x.t);
                      const title = j4?.titulo_reuniao || j1?.meetingInfo?.title || `Transcrição #${x.id}`;
                      return (
                        <div
                          key={x.id}
                          onClick={() => navigate(`/meetings/${x.id}`)}
                          className="flex items-center gap-3 cursor-pointer hover:bg-neutral-lighter rounded-lg px-2 py-1.5 transition-colors group"
                        >
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            i === 0 ? 'bg-accent text-primary' :
                            i === 1 ? 'bg-neutral-light text-primary' :
                            i === 2 ? 'bg-orange-100 text-orange-700' :
                            'bg-neutral-lighter text-secondary'
                          }`}>{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate group-hover:text-primary-light">{title}</p>
                            <p className="text-xs text-secondary">{formatDate(x.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}</p>
                          </div>
                          <ScoreBar score={x.score} />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Distribuição de qualidade */}
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

                    {/* Scores individuais */}
                    <div className="mt-4 pt-4 border-t border-neutral-light">
                      <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">Score por Reunião</p>
                      <div className="space-y-2">
                        {withScores.map(x => {
                          const j4 = getAgent4Json(x.t);
                          const j1 = getAgent1Json(x.t);
                          const title = j4?.titulo_reuniao || j1?.meetingInfo?.title || `#${x.id}`;
                          return (
                            <div key={x.id} className="flex items-center gap-2">
                              <span className="text-xs text-secondary w-28 truncate flex-shrink-0" title={title}>{title}</span>
                              <ScoreBar score={x.score} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Top responsáveis */}
              {topResps.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Responsáveis</h2>
                  </div>
                  <div className="space-y-3">
                    {topResps.map(({ name, count, avg }) => (
                      <div key={name} className="flex items-center justify-between py-2 border-b border-neutral-light last:border-0">
                        <div>
                          <p className="text-sm font-medium text-primary">{name}</p>
                          <p className="text-xs text-secondary">{count} reunião{count !== 1 ? 'ões' : ''}</p>
                        </div>
                        {avg !== null && (
                          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${
                            avg >= 8 ? 'bg-success/10 text-success' :
                            avg >= 5 ? 'bg-amber-50 text-amber-700' :
                            'bg-danger/10 text-danger'
                          }`}>
                            ⭐ {avg}/10
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Empresas mencionadas */}
              {topCompanies.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Building2 className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Empresas Envolvidas</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {topCompanies.map(([company, count]) => (
                      <span
                        key={company}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary"
                        style={{ backgroundColor: 'rgba(45,90,39,0.07)' }}
                      >
                        {company}
                        {count > 1 && (
                          <span className="rounded-full bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">{count}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </Card>
              )}

              {/* Tópicos frequentes */}
              {topTopics.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Tópicos Frequentes</h2>
                  </div>
                  <div className="space-y-2">
                    {topTopics.map(([kw, count]) => (
                      <div key={kw} className="flex items-center gap-3">
                        <span className="text-sm text-primary font-medium w-28 capitalize">{kw}</span>
                        <div className="flex-1 h-2 rounded-full bg-neutral-lighter overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60 transition-all duration-500"
                            style={{ width: `${(count / (topTopics[0]?.[1] || 1)) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-secondary w-10 text-right font-medium">{count}×</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Timeline de reuniões com score */}
              {withScores.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="h-5 w-5 text-primary" />
                    <h2 className="text-headline-2 text-primary">Evolução das Reuniões</h2>
                  </div>
                  <div className="space-y-3">
                    {[...withScores]
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .map((x) => {
                        const j4 = getAgent4Json(x.t);
                        const j1 = getAgent1Json(x.t);
                        const title = j4?.titulo_reuniao || j1?.meetingInfo?.title || `Transcrição #${x.id}`;
                        const scoreColor = x.score >= 8 ? 'bg-success' : x.score >= 5 ? 'bg-accent' : 'bg-danger';
                        return (
                          <div
                            key={x.id}
                            onClick={() => navigate(`/meetings/${x.id}`)}
                            className="flex items-center gap-3 cursor-pointer hover:bg-neutral-lighter rounded-lg px-2 py-2 transition-colors"
                          >
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${scoreColor}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-primary truncate">{title}</p>
                              <p className="text-xs text-secondary">{formatDate(x.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}</p>
                            </div>
                            <span className={`text-sm font-bold ${x.score >= 8 ? 'text-success' : x.score >= 5 ? 'text-amber-600' : 'text-danger'}`}>
                              {x.score}/10
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  {withScores.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-neutral-light flex items-center justify-between text-sm">
                      <span className="text-secondary">Variação total</span>
                      <span className={`font-bold flex items-center gap-1 ${
                        scores[scores.length - 1] > scores[0] ? 'text-success' :
                        scores[scores.length - 1] < scores[0] ? 'text-danger' : 'text-secondary'
                      }`}>
                        <ScoreTrendIcon scores={scores} />
                        {scores[scores.length - 1] > scores[0] ? '+' : ''}{Math.round((scores[scores.length - 1] - scores[0]) * 10) / 10} pts
                      </span>
                    </div>
                  )}
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

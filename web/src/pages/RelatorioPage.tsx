import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import {
  Video, TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, BarChart3,
  CheckSquare, Hash, Calendar
} from 'lucide-react';
import { fetchMeetings as fetchMeetingsCache } from '@/lib/meetingsCache';

// ── Types ────────────────────────────────────────────────────────────────────

interface MeetingInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  commercialQuality: number;
  closingProbability: number;
  actionItems: string[];
  keyTopics: string[];
}

interface Meeting {
  id: string;
  title: string | null;
  platform: string | null;
  status: string | null;
  insights: MeetingInsights | null;
  created_at: string;
}

// ── Week helpers ─────────────────────────────────────────────────────────────

function getWeekBounds(offset: number): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function formatWeekLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (sameMonth) {
    return `${start.getDate()} – ${end.toLocaleDateString('pt-BR', opts)}`;
  }
  return `${start.toLocaleDateString('pt-BR', opts)} – ${end.toLocaleDateString('pt-BR', opts)}`;
}

function isInRange(date: string, start: Date, end: Date): boolean {
  const d = new Date(date);
  return d >= start && d <= end;
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

interface WeekStats {
  total: number;
  completed: number;
  avgScore: number | null;
  scoreCount: number;
  positive: number;
  neutral: number;
  negative: number;
  topics: string[];
  pendingActions: number;
  topMeetings: Array<{ id: string; title: string | null; score: number }>;
}

function computeStats(meetings: Meeting[], start: Date, end: Date): WeekStats {
  const week = meetings.filter(m => isInRange(m.created_at, start, end));
  const completed = week.filter(m => m.status === 'completed');
  const withScore = completed.filter(m => m.insights?.commercialQuality != null);
  const avgScore = withScore.length
    ? Math.round((withScore.reduce((s, m) => s + m.insights!.commercialQuality, 0) / withScore.length) * 10) / 10
    : null;

  const topicBag: string[] = [];
  completed.forEach(m => m.insights?.keyTopics?.forEach(t => topicBag.push(t)));
  const topicCounts: Record<string, number> = {};
  topicBag.forEach(t => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
  const topics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

  const pendingActions = completed.reduce((n, m) => n + (m.insights?.actionItems?.length ?? 0), 0);

  const topMeetings = [...withScore]
    .sort((a, b) => b.insights!.commercialQuality - a.insights!.commercialQuality)
    .slice(0, 5)
    .map(m => ({ id: m.id, title: m.title, score: m.insights!.commercialQuality }));

  return {
    total: week.length,
    completed: completed.length,
    avgScore,
    scoreCount: withScore.length,
    positive: completed.filter(m => m.insights?.sentiment === 'positive').length,
    neutral:  completed.filter(m => m.insights?.sentiment === 'neutral').length,
    negative: completed.filter(m => m.insights?.sentiment === 'negative').length,
    topics,
    pendingActions,
    topMeetings,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DeltaBadge({ curr, prev }: { curr: number | null; prev: number | null }) {
  if (curr === null || prev === null) return <span className="text-[#ccc] text-xs">—</span>;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.05) return <span className="inline-flex items-center gap-0.5 text-xs text-[#888]"><Minus size={11} /> igual</span>;
  if (diff > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#2D5A27]">
      <TrendingUp size={11} /> +{diff.toFixed(1)}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#DC3545]">
      <TrendingDown size={11} /> {diff.toFixed(1)}
    </span>
  );
}

function DeltaCountBadge({ curr, prev }: { curr: number; prev: number }) {
  const diff = curr - prev;
  if (diff === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-[#888]"><Minus size={11} /> igual</span>;
  if (diff > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#2D5A27]">
      <TrendingUp size={11} /> +{diff}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#DC3545]">
      <TrendingDown size={11} /> {diff}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 8 ? 'bg-[#2D5A27]/10 text-[#2D5A27]' :
    score >= 5 ? 'bg-[#FFD700]/30 text-[#7A5C00]' :
    'bg-[#DC3545]/10 text-[#DC3545]';
  return (
    <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 h-6 rounded-lg text-xs font-bold tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RelatorioPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = prev…

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchMeetingsCache();
        setMeetings(data as Meeting[]);
      } catch {}
      finally { setIsLoading(false); }
    };
    load();
  }, []);

  const { start, end } = getWeekBounds(weekOffset);
  const { start: prevStart, end: prevEnd } = getWeekBounds(weekOffset - 1);

  const curr = computeStats(meetings, start, end);
  const prev = computeStats(meetings, prevStart, prevEnd);

  const isCurrentWeek = weekOffset === 0;

  const dominantSentiment = curr.positive >= curr.neutral && curr.positive >= curr.negative
    ? 'positivo'
    : curr.negative >= curr.neutral
    ? 'negativo'
    : 'neutro';

  const sentimentColor =
    dominantSentiment === 'positivo' ? 'text-[#2D5A27]' :
    dominantSentiment === 'negativo' ? 'text-[#DC3545]' : 'text-[#888]';

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#2D5A27] border-r-transparent" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl">

        {/* Header + week nav */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a]">Relatório Semanal</h1>
            <p className="mt-1 text-sm text-[#666]">Resumo consolidado das suas reuniões por semana</p>
          </div>

          <div className="flex items-center gap-2 bg-white border border-[#E0E0E0] rounded-xl px-3 py-2">
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              className="p-1 rounded hover:bg-neutral-100 transition-colors text-[#555]"
              aria-label="Semana anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-[#333] min-w-[150px] text-center">
              {isCurrentWeek ? 'Esta semana' : formatWeekLabel(start, end)}
            </span>
            <button
              onClick={() => setWeekOffset(w => Math.min(w + 1, 0))}
              disabled={isCurrentWeek}
              className="p-1 rounded hover:bg-neutral-100 transition-colors text-[#555] disabled:opacity-30 disabled:cursor-default"
              aria-label="Próxima semana"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Range label */}
        <p className="text-xs text-[#aaa]">
          {start.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' '}até{' '}
          {end.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        {/* Empty state */}
        {curr.total === 0 && (
          <Card className="p-12 text-center">
            <Calendar className="h-12 w-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#333]">Nenhuma reunião nesta semana</h3>
            <p className="mt-2 text-sm text-[#666]">Use as setas para navegar para semanas com dados.</p>
          </Card>
        )}

        {curr.total > 0 && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

              <Card className="p-5 border-l-4 border-l-[#2D5A27]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Reuniões</p>
                    <p className="mt-2 text-4xl font-bold text-[#1a1a1a]">{curr.total}</p>
                    <p className="mt-1 text-xs text-[#888]">{curr.completed} concluídas</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="w-8 h-8 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                      <Video size={15} className="text-[#2D5A27]" />
                    </div>
                    <DeltaCountBadge curr={curr.total} prev={prev.total} />
                  </div>
                </div>
              </Card>

              <Card className="p-5 border-l-4 border-l-[#E0E0E0]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Score médio</p>
                    <p className="mt-2 text-4xl font-bold text-[#1a1a1a]">
                      {curr.avgScore !== null ? curr.avgScore : <span className="text-[#ccc]">—</span>}
                    </p>
                    <p className="mt-1 text-xs text-[#888]">
                      {curr.scoreCount > 0 ? `em ${curr.scoreCount} reuniões` : 'sem dados'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center">
                      <BarChart3 size={15} className="text-[#666]" />
                    </div>
                    <DeltaBadge curr={curr.avgScore} prev={prev.avgScore} />
                  </div>
                </div>
              </Card>

              <Card className="p-5 border-l-4 border-l-[#E0E0E0]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Sentimento</p>
                    <p className={`mt-2 text-2xl font-bold capitalize ${sentimentColor}`}>
                      {curr.completed > 0 ? dominantSentiment : <span className="text-[#ccc]">—</span>}
                    </p>
                    {curr.completed > 0 && (
                      <p className="mt-1 text-xs text-[#888]">
                        {curr.positive}↑ {curr.neutral}= {curr.negative}↓
                      </p>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center">
                    <TrendingUp size={15} className="text-[#666]" />
                  </div>
                </div>
              </Card>

              <Card className="p-5 border-l-4 border-l-[#FFD700]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">Action items</p>
                    <p className="mt-2 text-4xl font-bold text-[#1a1a1a]">{curr.pendingActions}</p>
                    <p className="mt-1 text-xs text-[#888]">identificados nas reuniões</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="w-8 h-8 rounded-xl bg-[#FFD700]/20 flex items-center justify-center">
                      <CheckSquare size={15} className="text-[#7A5C00]" />
                    </div>
                    <DeltaCountBadge curr={curr.pendingActions} prev={prev.pendingActions} />
                  </div>
                </div>
              </Card>
            </div>

            {/* Bottom row: top meetings + topics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Melhores reuniões */}
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                    <BarChart3 size={14} className="text-[#2D5A27]" />
                  </div>
                  <h2 className="text-sm font-semibold text-[#333]">Melhores reuniões da semana</h2>
                </div>
                {curr.topMeetings.length === 0 ? (
                  <p className="text-sm text-[#aaa] py-4 text-center">Nenhuma reunião com score esta semana</p>
                ) : (
                  <ol className="space-y-2">
                    {curr.topMeetings.map((m, i) => (
                      <li key={m.id} className="flex items-center gap-3">
                        <span className="w-5 h-5 flex-shrink-0 rounded-full bg-neutral-100 text-[10px] font-bold text-[#888] flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm text-[#333] truncate">
                          {m.title || 'Reunião sem título'}
                        </span>
                        <ScorePill score={m.score} />
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {/* Tópicos da semana */}
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center">
                    <Hash size={14} className="text-[#666]" />
                  </div>
                  <h2 className="text-sm font-semibold text-[#333]">Tópicos discutidos</h2>
                </div>
                {curr.topics.length === 0 ? (
                  <p className="text-sm text-[#aaa] py-4 text-center">Nenhum tópico registrado</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {curr.topics.map(t => (
                      <span key={t} className="px-2.5 py-1 rounded-full bg-neutral-100 text-xs text-[#555] font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import {
  TrendingUp, TrendingDown, Minus, BarChart3,
  MessageSquare, Award, Calendar, Video, Hash
} from 'lucide-react';
import { formatDate } from '@/lib';
import { fetchMeetings as fetchMeetingsCache } from '@/lib/meetingsCache';
import { fetchUserTeams, type TeamOption } from '@/lib/teamScope';

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
  team_id?: string | null;
}

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 8 ? 'bg-[#2D5A27]/10 text-[#2D5A27]' :
    score >= 5 ? 'bg-[#FFD700]/30 text-[#7A5C00]' :
    'bg-[#DC3545]/10 text-[#DC3545]';
  return (
    <span className={`inline-flex items-center justify-center min-w-[2.25rem] px-2 h-7 rounded-lg text-sm font-bold tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 8 ? 'bg-[#2D5A27]' : score >= 5 ? 'bg-[#FFD700]' : 'bg-[#DC3545]';
  return (
    <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreTrendIcon({ scores }: { scores: number[] }) {
  if (scores.length < 2) return <Minus className="h-4 w-4 text-neutral-400" />;
  const last = scores[scores.length - 1];
  const prev = scores[scores.length - 2];
  if (last > prev) return <TrendingUp className="h-4 w-4 text-[#2D5A27]" />;
  if (last < prev) return <TrendingDown className="h-4 w-4 text-[#DC3545]" />;
  return <Minus className="h-4 w-4 text-neutral-400" />;
}

export function InsightsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [meetingsResult, teamsResult] = await Promise.allSettled([
          fetchMeetingsCache(),
          fetchUserTeams(),
        ]);

        setMeetings(meetingsResult.status === 'fulfilled' ? meetingsResult.value as any : []);
        setTeams(teamsResult.status === 'fulfilled' ? teamsResult.value : []);
      } catch {}
      finally { setIsLoading(false); }
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedTeamId === 'all') return;
    if (!teams.some(team => team.id === selectedTeamId)) {
      setSelectedTeamId('all');
    }
  }, [selectedTeamId, teams]);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      </MainLayout>
    );
  }

  const filteredMeetings = selectedTeamId === 'all'
    ? meetings
    : meetings.filter(meeting => meeting.team_id === selectedTeamId);

  const withScores = filteredMeetings
    .filter(m => m.insights?.commercialQuality != null)
    .map(m => ({ ...m, score: m.insights!.commercialQuality }));

  const avgScore = withScores.length
    ? Math.round((withScores.reduce((s, m) => s + m.score, 0) / withScores.length) * 10) / 10
    : null;

  const scores = withScores.map(m => m.score);
  const highQ = withScores.filter(m => m.score >= 8).length;
  const medQ  = withScores.filter(m => m.score >= 5 && m.score < 8).length;
  const lowQ  = withScores.filter(m => m.score < 5).length;

  const sortedByScore = [...withScores].sort((a, b) => b.score - a.score);

  const topicCounts: Record<string, number> = {};
  filteredMeetings.forEach(m => {
    m.insights?.keyTopics?.forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
  });
  const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

  const total = filteredMeetings.length;
  const completed = filteredMeetings.filter(m => m.status === 'completed').length;

  const sentimentCounts = {
    positive: filteredMeetings.filter(m => m.insights?.sentiment === 'positive').length,
    neutral:  filteredMeetings.filter(m => m.insights?.sentiment === 'neutral').length,
    negative: filteredMeetings.filter(m => m.insights?.sentiment === 'negative').length,
  };

  const hasSentiment = filteredMeetings.some(m => m.insights?.sentiment);
  const lang = i18n.language as 'pt-BR' | 'en-US' | 'es';

  return (
    <MainLayout>
      <div className="space-y-6 max-w-6xl">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a1a]">{t('insights.aggregate.title')}</h1>
          <p className="mt-1 text-sm text-[#666]">
            {t('insights.aggregate.subtitle', { count: total })}
          </p>
        </div>

        {teams.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#666666] mr-1">{t('common.team', 'Time')}:</span>
            <button
              onClick={() => setSelectedTeamId('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                selectedTeamId === 'all'
                  ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                  : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
              }`}
            >
              {t('common.allTeams', 'Todos os times')}
            </button>
            {teams.map(team => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                  selectedTeamId === team.id
                    ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                    : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                }`}
              >
                {team.name}
              </button>
            ))}
          </div>
        )}

        {total === 0 ? (
          <Card className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#333]">{t('insights.aggregate.empty.title')}</h3>
            <p className="mt-2 text-sm text-[#666]">{t('insights.aggregate.empty.text')}</p>
          </Card>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

              <Card className="p-5 border-l-4 border-l-[#2D5A27]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">
                      {t('insights.aggregate.stats.total')}
                    </p>
                    <p className="mt-2 text-4xl font-bold text-[#1a1a1a]">{total}</p>
                    <p className="mt-1 text-xs text-[#888]">
                      {t('insights.aggregate.stats.completed', { count: completed })}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                    <Video size={17} className="text-[#2D5A27]" />
                  </div>
                </div>
              </Card>

              {avgScore !== null ? (
                <Card className="p-5 border-l-4 border-l-[#E0E0E0]">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">
                        {t('insights.aggregate.stats.avgScore')}
                      </p>
                      <div className="mt-2 flex items-end gap-1.5">
                        <span className="text-4xl font-bold text-[#1a1a1a]">{avgScore}</span>
                        <span className="text-sm text-[#888] mb-1">/10</span>
                        <span className="mb-1"><ScoreTrendIcon scores={scores} /></span>
                      </div>
                      <p className="mt-1 text-xs text-[#888]">
                        {t('insights.aggregate.stats.basedOn', { count: withScores.length })}
                      </p>
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-[#F5F5F5] flex items-center justify-center">
                      <BarChart3 size={17} className="text-[#666]" />
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="p-5 border-l-4 border-l-[#E0E0E0]">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">
                    {t('insights.aggregate.stats.avgScore')}
                  </p>
                  <p className="mt-2 text-4xl font-bold text-[#ccc]">—</p>
                </Card>
              )}

              <Card className="p-5 border-l-4 border-l-[#2D5A27]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">
                      {t('insights.aggregate.stats.highQuality')}
                    </p>
                    <p className="mt-2 text-4xl font-bold text-[#2D5A27]">{highQ}</p>
                    <p className="mt-1 text-xs text-[#888]">{t('insights.aggregate.stats.scoreHigh')}</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                    <TrendingUp size={17} className="text-[#2D5A27]" />
                  </div>
                </div>
              </Card>

              <Card className="p-5 border-l-4 border-l-[#DC3545]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#999]">
                      {t('insights.aggregate.stats.needsAttention')}
                    </p>
                    <p className="mt-2 text-4xl font-bold text-[#DC3545]">{lowQ}</p>
                    <p className="mt-1 text-xs text-[#888]">{t('insights.aggregate.stats.scoreLow')}</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-[#DC3545]/8 flex items-center justify-center">
                    <TrendingDown size={17} className="text-[#DC3545]" />
                  </div>
                </div>
              </Card>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Ranking */}
              {sortedByScore.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-[#FFD700]/20 flex items-center justify-center">
                      <Award size={15} className="text-[#7A5C00]" />
                    </div>
                    <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
                      {t('insights.aggregate.ranking.title')}
                    </h2>
                  </div>
                  <div className="space-y-1">
                    {sortedByScore.slice(0, 8).map((m, i) => (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/meetings/${m.id}`)}
                        className="flex items-center gap-3 cursor-pointer hover:bg-[#f5f5f5] rounded-lg px-2 py-2 transition-colors group"
                      >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                          i === 0 ? 'bg-[#FFD700] text-[#333]' :
                          i === 1 ? 'bg-neutral-300 text-white' :
                          i === 2 ? 'bg-neutral-200 text-[#666]' :
                          'bg-neutral-100 text-[#888]'
                        }`}>{i + 1}</span>

                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#222] truncate group-hover:text-[#2D5A27] transition-colors">
                            {m.title || `${t('insights.aggregate.ranking.meeting')} ${m.id.slice(0, 8)}`}
                          </p>
                          <p className="text-[11px] text-[#999]">{formatDate(m.created_at, lang)}</p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 w-28">
                          <ScoreBar score={m.score} />
                          <ScorePill score={m.score} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Distribuição */}
              {withScores.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                      <BarChart3 size={15} className="text-[#2D5A27]" />
                    </div>
                    <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
                      {t('insights.aggregate.distribution.title')}
                    </h2>
                  </div>
                  <div className="space-y-5">
                    {[
                      { key: 'high',   label: t('insights.aggregate.distribution.high'),   count: highQ, barCls: 'bg-[#2D5A27]' },
                      { key: 'medium', label: t('insights.aggregate.distribution.medium'), count: medQ,  barCls: 'bg-[#FFD700]' },
                      { key: 'low',    label: t('insights.aggregate.distribution.low'),    count: lowQ,  barCls: 'bg-[#DC3545]' },
                    ].map(({ key, label, count, barCls }) => {
                      const pct = withScores.length ? Math.round((count / withScores.length) * 100) : 0;
                      return (
                        <div key={key}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[13px] font-medium text-[#333]">{label}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-[#999]">{pct}%</span>
                              <span className="text-[13px] font-semibold text-[#555]">
                                {t('insights.aggregate.distribution.count', { count })}
                              </span>
                            </div>
                          </div>
                          <div className="h-3 rounded-full bg-neutral-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barCls} transition-all duration-700`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Score summary */}
                  <div className="mt-6 pt-5 border-t border-[#F0F0F0] grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: t('insights.aggregate.distribution.high'),   value: highQ, cls: 'text-[#2D5A27]' },
                      { label: t('insights.aggregate.distribution.medium'), value: medQ,  cls: 'text-[#7A5C00]' },
                      { label: t('insights.aggregate.distribution.low'),    value: lowQ,  cls: 'text-[#DC3545]' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="bg-[#fafafa] rounded-xl py-3">
                        <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                        <p className="text-[11px] text-[#999] mt-0.5 leading-tight">{label}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Sentimento */}
              {hasSentiment && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center">
                      <MessageSquare size={15} className="text-[#666]" />
                    </div>
                    <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
                      {t('insights.aggregate.sentiment.title')}
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {[
                      { key: 'positive', emoji: '😊', count: sentimentCounts.positive, barCls: 'bg-[#2D5A27]' },
                      { key: 'neutral',  emoji: '😐', count: sentimentCounts.neutral,  barCls: 'bg-[#E0E0E0]' },
                      { key: 'negative', emoji: '😟', count: sentimentCounts.negative, barCls: 'bg-[#DC3545]' },
                    ].map(({ key, emoji, count, barCls }) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-lg w-5 flex-shrink-0">{emoji}</span>
                        <div className="flex-1">
                          <div className="flex justify-between text-[13px] mb-1">
                            <span className="font-medium text-[#333]">{t(`insights.aggregate.sentiment.${key}`)}</span>
                            <span className="text-[#888] tabular-nums">{count}</span>
                          </div>
                          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barCls} transition-all duration-700`}
                              style={{ width: total ? `${(count / total) * 100}%` : '0%' }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Tópicos frequentes */}
              {topTopics.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                      <Hash size={15} className="text-[#2D5A27]" />
                    </div>
                    <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
                      {t('insights.aggregate.topics.title')}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {topTopics.map(([topic, count]) => (
                      <span
                        key={topic}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#2D5A27]/20 bg-[#2D5A27]/6 px-3 py-1.5 text-[13px] font-medium text-[#2D5A27]"
                      >
                        {topic}
                        {count > 1 && (
                          <span className="rounded-full bg-[#2D5A27] text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">{count}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </div>

            {/* Timeline */}
            {withScores.length > 1 && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                    <Calendar size={15} className="text-[#2D5A27]" />
                  </div>
                  <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
                    {t('insights.aggregate.timeline.title')}
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {[...withScores]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((m) => (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/meetings/${m.id}`)}
                        className="flex items-center gap-3 cursor-pointer hover:bg-[#f5f5f5] rounded-lg px-3 py-2.5 transition-colors group"
                      >
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${m.score >= 8 ? 'bg-[#2D5A27]' : m.score >= 5 ? 'bg-[#FFD700]' : 'bg-[#DC3545]'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#222] truncate group-hover:text-[#2D5A27] transition-colors">
                            {m.title || `${t('insights.aggregate.ranking.meeting')} ${m.id.slice(0, 8)}`}
                          </p>
                          <p className="text-[11px] text-[#999]">{formatDate(m.created_at, lang)}</p>
                        </div>
                        <ScorePill score={m.score} />
                      </div>
                    ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}


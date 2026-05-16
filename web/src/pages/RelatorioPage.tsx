import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import { useAuth } from '@/contexts';
import {
  Video, TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, BarChart3,
  CheckSquare, Hash, Calendar, Download
} from 'lucide-react';
import { fetchMeetings as fetchMeetingsCache } from '@/lib/meetingsCache';
import { fetchUserTeams, type TeamOption } from '@/lib/teamScope';
import html2pdf from 'html2pdf.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string
  user_id: string
  user_name: string
  user_email: string
  status: string
}

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
  team_id?: string | null;
  user_id?: string | null;
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
  const { t } = useTranslation();
  const { session } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = prev…
  const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session?.access_token) {
      setMeetings([]);
      setTeams([]);
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const [meetingsResult, teamsResult] = await Promise.allSettled([
          fetchMeetingsCache(),
          fetchUserTeams(session.access_token),
        ]);

        setMeetings(meetingsResult.status === 'fulfilled' ? meetingsResult.value as Meeting[] : []);
        setTeams(teamsResult.status === 'fulfilled' ? teamsResult.value : []);
      } catch {}
      finally { setIsLoading(false); }
    };
    load();
  }, [session?.access_token]);

  useEffect(() => {
    if (selectedTeamId === 'all') return;
    if (!teams.some(team => team.id === selectedTeamId)) {
      setSelectedTeamId('all');
    }
  }, [selectedTeamId, teams]);

  // Busca membros quando o time muda
  useEffect(() => {
    const loadMembers = async () => {
      if (!session?.access_token) {
        setMembers([])
        return
      }

      // Se "Todos os times" está selecionado, busca membros de todos os times
      if (selectedTeamId === 'all') {
        try {
          const allMembers: TeamMember[] = []
          const seenUserIds = new Set<string>()

          for (const team of teams) {
            const response = await fetch(`${API}/api/teams/${team.id}`, {
              headers: { Authorization: `Bearer ${session.access_token}` }
            })
            
            if (response.ok) {
              const data = await response.json()
              const activeMembers = (data.members || [])
                .filter((m: any) => m.status === 'active' && m.user_id)
                .map((m: any) => ({
                  id: m.id,
                  user_id: m.user_id,
                  user_name: m.name || m.invited_email || 'Sem nome',
                  user_email: m.invited_email,
                  status: m.status
                }))
              
              // Evita duplicatas (usuário pode estar em múltiplos times)
              for (const member of activeMembers) {
                if (!seenUserIds.has(member.user_id)) {
                  seenUserIds.add(member.user_id)
                  allMembers.push(member)
                }
              }
            }
          }
          
          setMembers(allMembers)
        } catch (error) {
          console.error('Erro ao buscar membros:', error)
          setMembers([])
        }
      } else {
        // Busca membros do time específico
        try {
          const response = await fetch(`${API}/api/teams/${selectedTeamId}`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          })
          
          if (response.ok) {
            const data = await response.json()
            const activeMembers = (data.members || [])
              .filter((m: any) => m.status === 'active' && m.user_id)
              .map((m: any) => ({
                id: m.id,
                user_id: m.user_id,
                user_name: m.name || m.invited_email || 'Sem nome',
                user_email: m.invited_email,
                status: m.status
              }))
            setMembers(activeMembers)
          } else {
            setMembers([])
          }
        } catch (error) {
          console.error('Erro ao buscar membros:', error)
          setMembers([])
        }
      }
      
      // Reset seleção de membro ao mudar de time
      setSelectedMemberId('all')
    }

    loadMembers()
  }, [selectedTeamId, teams, session])

  const filteredMeetings = meetings
    .filter(meeting => {
      // Filtro de time
      if (selectedTeamId !== 'all' && meeting.team_id !== selectedTeamId) {
        return false
      }
      // Filtro de membro
      if (selectedMemberId !== 'all' && meeting.user_id !== selectedMemberId) {
        return false
      }
      return true
    });

  const { start, end } = getWeekBounds(weekOffset);
  const { start: prevStart, end: prevEnd } = getWeekBounds(weekOffset - 1);

  const curr = computeStats(filteredMeetings, start, end);
  const prev = computeStats(filteredMeetings, prevStart, prevEnd);

  const isCurrentWeek = weekOffset === 0;

  const dominantSentiment = curr.positive >= curr.neutral && curr.positive >= curr.negative
    ? 'positivo'
    : curr.negative >= curr.neutral
    ? 'negativo'
    : 'neutro';

  const sentimentColor =
    dominantSentiment === 'positivo' ? 'text-[#2D5A27]' :
    dominantSentiment === 'negativo' ? 'text-[#DC3545]' : 'text-[#888]';

  const handleExportPDF = async () => {
    if (!reportRef.current || isExporting) return;

    setIsExporting(true);

    try {
      // Clone o elemento para não afetar o DOM visível
      const element = reportRef.current.cloneNode(true) as HTMLElement;
      
      // Remove botões de navegação e filtros do PDF
      const navButtons = element.querySelectorAll('button');
      navButtons.forEach(btn => btn.remove());

      // Adiciona logo da Lemon no topo
      const header = document.createElement('div');
      header.style.cssText = 'text-align: center; margin-bottom: 30px; padding: 20px; border-bottom: 3px solid #2D5A27;';
      header.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
          <div style="width: 48px; height: 48px; background: #2D5A27; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px;">🍋</div>
          <h1 style="font-size: 32px; font-weight: bold; color: #2D5A27; margin: 0;">Lemon.meet</h1>
        </div>
        <p style="font-size: 14px; color: #666; margin: 8px 0 0 0;">Relatório Semanal - ${formatWeekLabel(start, end)}</p>
        <p style="font-size: 12px; color: #999; margin: 4px 0 0 0;">Gerado em ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      `;
      element.insertBefore(header, element.firstChild);

      // Configurações do PDF
      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `relatorio-semanal-${formatWeekLabel(start, end).replace(/\s+/g, '-')}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
      };

      // Gera e baixa o PDF
      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      alert('Erro ao gerar PDF. Tente novamente.');
    } finally {
      setIsExporting(false);
    }
  };

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

        {/* Header + week nav + export */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a]">Relatório Semanal</h1>
            <p className="mt-1 text-sm text-[#666]">Resumo consolidado das suas reuniões por semana</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Botão Exportar PDF */}
            <button
              onClick={handleExportPDF}
              disabled={isExporting || curr.total === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D5A27] text-white text-sm font-semibold rounded-xl hover:bg-[#234520] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              {isExporting ? 'Gerando PDF...' : 'Exportar PDF'}
            </button>

            {/* Week navigation */}
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
        </div>

        {teams.length > 0 && (
          <div className="space-y-3">
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

            {/* Filtro de membros */}
            {members.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-[#666666] mr-1">Membro:</span>
                <button
                  onClick={() => setSelectedMemberId('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                    selectedMemberId === 'all'
                      ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                      : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                  }`}
                >
                  Todos os membros
                </button>
                {members.map(member => (
                  <button
                    key={member.id}
                    onClick={() => setSelectedMemberId(member.user_id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      selectedMemberId === member.user_id
                        ? 'bg-[#2D5A27] text-white border-[#2D5A27]'
                        : 'bg-white text-[#666666] border-[#E0E0E0] hover:border-[#2D5A27] hover:text-[#2D5A27]'
                    }`}
                  >
                    {member.user_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Range label */}
        <p className="text-xs text-[#aaa]">
          {start.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' '}até{' '}
          {end.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        {/* Container para exportação */}
        <div ref={reportRef}>
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
      </div>
    </MainLayout>
  );
}

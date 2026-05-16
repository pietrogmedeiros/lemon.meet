import { useState, useEffect } from 'react';
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
    if (isExporting) return;

    setIsExporting(true);

    try {
      // Cria um container temporário para o PDF
      const pdfContainer = document.createElement('div');
      pdfContainer.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 210mm; padding: 20px; background: white; font-family: system-ui, -apple-system, sans-serif;';
      
      // Header com logo limpo (sem fundo verde)
      pdfContainer.innerHTML = `
        <div style="text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #2D5A27;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px;">
            <span style="font-size: 48px;">🍋</span>
            <h1 style="font-size: 36px; font-weight: bold; color: #2D5A27; margin: 0;">Lemon.meet</h1>
          </div>
          <h2 style="font-size: 24px; color: #333; margin: 8px 0;">Relatório Semanal Completo</h2>
          <p style="font-size: 16px; color: #666; margin: 4px 0;">${formatWeekLabel(start, end)}</p>
          <p style="font-size: 12px; color: #999; margin: 4px 0;">
            ${start.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} até 
            ${end.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p style="font-size: 11px; color: #aaa; margin: 8px 0 0 0;">Gerado em ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        </div>

        <!-- Sumário Executivo -->
        <div style="background: linear-gradient(135deg, #2D5A27 0%, #3a7030 100%); padding: 24px; border-radius: 12px; margin-bottom: 30px; color: white;">
          <h3 style="font-size: 20px; font-weight: bold; margin: 0 0 16px 0; color: white;">📊 Sumário Executivo</h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
            <div style="background: rgba(255,255,255,0.15); padding: 16px; border-radius: 8px;">
              <p style="font-size: 12px; margin: 0 0 4px 0; opacity: 0.9;">REUNIÕES</p>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${curr.total}</p>
              <p style="font-size: 13px; margin: 4px 0 0 0; opacity: 0.85;">${curr.completed} concluídas • ${curr.total - curr.completed} em andamento</p>
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: 16px; border-radius: 8px;">
              <p style="font-size: 12px; margin: 0 0 4px 0; opacity: 0.9;">SCORE MÉDIO</p>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${curr.avgScore !== null ? curr.avgScore : '—'}</p>
              <p style="font-size: 13px; margin: 4px 0 0 0; opacity: 0.85;">
                ${curr.scoreCount > 0 ? `Baseado em ${curr.scoreCount} reuniões` : 'Sem dados disponíveis'}
              </p>
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: 16px; border-radius: 8px;">
              <p style="font-size: 12px; margin: 0 0 4px 0; opacity: 0.9;">SENTIMENTO</p>
              <p style="font-size: 24px; font-weight: bold; margin: 0; text-transform: capitalize;">${curr.completed > 0 ? dominantSentiment : '—'}</p>
              <p style="font-size: 13px; margin: 4px 0 0 0; opacity: 0.85;">
                ${curr.completed > 0 ? `${curr.positive} positivas • ${curr.neutral} neutras • ${curr.negative} negativas` : ''}
              </p>
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: 16px; border-radius: 8px;">
              <p style="font-size: 12px; margin: 0 0 4px 0; opacity: 0.9;">ACTION ITEMS</p>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${curr.pendingActions}</p>
              <p style="font-size: 13px; margin: 4px 0 0 0; opacity: 0.85;">Identificados nas reuniões</p>
            </div>
          </div>
        </div>

        <!-- Comparação com Semana Anterior -->
        ${prev.total > 0 ? `
        <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 30px;">
          <h3 style="font-size: 18px; font-weight: bold; margin: 0 0 16px 0; color: #333;">📈 Comparação com Semana Anterior</h3>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center;">
            <div>
              <p style="font-size: 11px; color: #666; margin: 0 0 4px 0;">REUNIÕES</p>
              <p style="font-size: 20px; font-weight: bold; margin: 0; color: ${curr.total >= prev.total ? '#2D5A27' : '#DC3545'};">
                ${curr.total > prev.total ? '+' : ''}${curr.total - prev.total}
              </p>
            </div>
            <div>
              <p style="font-size: 11px; color: #666; margin: 0 0 4px 0;">SCORE</p>
              <p style="font-size: 20px; font-weight: bold; margin: 0; color: ${(curr.avgScore || 0) >= (prev.avgScore || 0) ? '#2D5A27' : '#DC3545'};">
                ${curr.avgScore !== null && prev.avgScore !== null ? ((curr.avgScore - prev.avgScore) > 0 ? '+' : '') + (curr.avgScore - prev.avgScore).toFixed(1) : '—'}
              </p>
            </div>
            <div>
              <p style="font-size: 11px; color: #666; margin: 0 0 4px 0;">POSITIVAS</p>
              <p style="font-size: 20px; font-weight: bold; margin: 0; color: ${curr.positive >= prev.positive ? '#2D5A27' : '#DC3545'};">
                ${curr.positive > prev.positive ? '+' : ''}${curr.positive - prev.positive}
              </p>
            </div>
            <div>
              <p style="font-size: 11px; color: #666; margin: 0 0 4px 0;">ACTION ITEMS</p>
              <p style="font-size: 20px; font-weight: bold; margin: 0; color: ${curr.pendingActions >= prev.pendingActions ? '#2D5A27' : '#DC3545'};">
                ${curr.pendingActions > prev.pendingActions ? '+' : ''}${curr.pendingActions - prev.pendingActions}
              </p>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Top 5 Melhores Reuniões -->
        ${curr.topMeetings.length > 0 ? `
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 18px; font-weight: bold; margin: 0 0 16px 0; color: #333;">🏆 Top 5 Melhores Reuniões</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f8f9fa; text-align: left;">
                <th style="padding: 12px 8px; font-size: 12px; color: #666; font-weight: 600;">#</th>
                <th style="padding: 12px 8px; font-size: 12px; color: #666; font-weight: 600;">REUNIÃO</th>
                <th style="padding: 12px 8px; font-size: 12px; color: #666; font-weight: 600; text-align: right;">SCORE</th>
              </tr>
            </thead>
            <tbody>
              ${curr.topMeetings.map((m, i) => `
                <tr style="border-bottom: 1px solid #e0e0e0;">
                  <td style="padding: 12px 8px; font-size: 14px; color: #888; font-weight: bold;">${i + 1}</td>
                  <td style="padding: 12px 8px; font-size: 14px; color: #333;">${m.title || 'Reunião sem título'}</td>
                  <td style="padding: 12px 8px; text-align: right;">
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: bold; background: ${m.score >= 8 ? '#2D5A27' : m.score >= 5 ? '#FFD700' : '#DC3545'}; color: white;">
                      ${m.score}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <!-- Todas as Reuniões Detalhadas -->
        ${filteredMeetings.filter(m => isInRange(m.created_at, start, end) && m.status === 'completed').length > 0 ? `
        <div style="margin-bottom: 30px; page-break-before: always;">
          <h3 style="font-size: 18px; font-weight: bold; margin: 0 0 16px 0; color: #333;">📋 Todas as Reuniões da Semana</h3>
          ${filteredMeetings
            .filter(m => isInRange(m.created_at, start, end) && m.status === 'completed')
            .map(m => `
              <div style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                  <div style="flex: 1;">
                    <h4 style="font-size: 16px; font-weight: bold; margin: 0 0 4px 0; color: #333;">${m.title || 'Reunião sem título'}</h4>
                    <p style="font-size: 12px; color: #888; margin: 0;">
                      ${new Date(m.created_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  ${m.insights?.commercialQuality ? `
                    <span style="padding: 6px 16px; border-radius: 8px; font-size: 14px; font-weight: bold; background: ${m.insights.commercialQuality >= 8 ? '#2D5A27' : m.insights.commercialQuality >= 5 ? '#FFD700' : '#DC3545'}; color: white;">
                      ${m.insights.commercialQuality}/10
                    </span>
                  ` : ''}
                </div>
                
                ${m.insights ? `
                  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px;">
                    <div>
                      <p style="font-size: 11px; color: #666; margin: 0 0 4px 0; text-transform: uppercase; font-weight: 600;">Sentimento</p>
                      <p style="font-size: 14px; margin: 0; color: ${m.insights.sentiment === 'positive' ? '#2D5A27' : m.insights.sentiment === 'negative' ? '#DC3545' : '#888'}; text-transform: capitalize; font-weight: 600;">
                        ${m.insights.sentiment === 'positive' ? '😊 Positivo' : m.insights.sentiment === 'negative' ? '😞 Negativo' : '😐 Neutro'}
                      </p>
                    </div>
                    <div>
                      <p style="font-size: 11px; color: #666; margin: 0 0 4px 0; text-transform: uppercase; font-weight: 600;">Prob. Fechamento</p>
                      <p style="font-size: 14px; margin: 0; font-weight: 600;">${m.insights.closingProbability}%</p>
                    </div>
                  </div>

                  ${m.insights.actionItems && m.insights.actionItems.length > 0 ? `
                    <div style="margin-bottom: 12px;">
                      <p style="font-size: 11px; color: #666; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 600;">✅ Action Items (${m.insights.actionItems.length})</p>
                      <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #333;">
                        ${m.insights.actionItems.slice(0, 5).map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}

                  ${m.insights.keyTopics && m.insights.keyTopics.length > 0 ? `
                    <div>
                      <p style="font-size: 11px; color: #666; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 600;">🏷️ Tópicos</p>
                      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${m.insights.keyTopics.slice(0, 8).map(topic => `
                          <span style="padding: 4px 10px; background: #f0f0f0; border-radius: 16px; font-size: 11px; color: #555;">${topic}</span>
                        `).join('')}
                      </div>
                    </div>
                  ` : ''}
                ` : ''}
              </div>
            `).join('')}
        </div>
        ` : ''}

        <!-- Tópicos Mais Discutidos -->
        ${curr.topics.length > 0 ? `
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: 18px; font-weight: bold; margin: 0 0 16px 0; color: #333;">🏷️ Tópicos Mais Discutidos</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${curr.topics.map(t => `
              <span style="padding: 8px 16px; background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%); border-radius: 20px; font-size: 13px; color: #333; font-weight: 500; border: 1px solid #ddd;">
                ${t}
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Insights e Recomendações -->
        <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 30px; page-break-before: always;">
          <h3 style="font-size: 18px; font-weight: bold; margin: 0 0 16px 0; color: #333;">💡 Insights e Recomendações</h3>
          
          ${curr.avgScore !== null ? `
            <div style="margin-bottom: 16px;">
              <p style="font-size: 14px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Qualidade das Reuniões</p>
              <p style="font-size: 13px; color: #666; line-height: 1.6; margin: 0;">
                ${curr.avgScore >= 7.5 
                  ? `✅ Excelente! Suas reuniões estão com qualidade muito alta (${curr.avgScore}/10). Continue mantendo o foco em preparação e objetivos claros.`
                  : curr.avgScore >= 5 
                  ? `⚠️ Atenção: O score médio está em ${curr.avgScore}/10. Considere melhorar a preparação das reuniões e definir objetivos mais claros.`
                  : `⛔ Crítico: Score médio baixo (${curr.avgScore}/10). Recomendamos revisar o processo de reuniões e focar em qualidade sobre quantidade.`
                }
              </p>
            </div>
          ` : ''}

          ${curr.positive > 0 && curr.negative > 0 ? `
            <div style="margin-bottom: 16px;">
              <p style="font-size: 14px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Análise de Sentimento</p>
              <p style="font-size: 13px; color: #666; line-height: 1.6; margin: 0;">
                ${(curr.positive / curr.completed * 100).toFixed(0)}% das reuniões tiveram sentimento positivo. 
                ${curr.negative > curr.positive 
                  ? 'Atenção: há mais reuniões negativas que positivas. Considere revisar a abordagem.'
                  : 'Continue trabalhando para manter o clima positivo nas reuniões.'
                }
              </p>
            </div>
          ` : ''}

          ${curr.pendingActions > 0 ? `
            <div style="margin-bottom: 16px;">
              <p style="font-size: 14px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Action Items</p>
              <p style="font-size: 13px; color: #666; line-height: 1.6; margin: 0;">
                ${curr.pendingActions} action items identificados. Certifique-se de criar um plano de acompanhamento para cada um.
                ${curr.pendingActions > curr.completed * 3 
                  ? ' ⚠️ Alto número de ações por reunião - considere priorizar os itens mais importantes.'
                  : ''}
              </p>
            </div>
          ` : ''}

          <div>
            <p style="font-size: 14px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Próximos Passos</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #666; line-height: 1.8;">
              <li>Acompanhar os ${curr.pendingActions} action items identificados</li>
              <li>Compartilhar insights com o time</li>
              ${curr.avgScore && curr.avgScore < 7 ? '<li>Revisar preparação e objetivos das reuniões</li>' : ''}
              ${curr.negative > 2 ? '<li>Analisar reuniões com sentimento negativo e identificar melhorias</li>' : ''}
              <li>Continuar monitorando métricas semanalmente</li>
            </ul>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding-top: 20px; border-top: 2px solid #e0e0e0; margin-top: 30px;">
          <p style="font-size: 11px; color: #999; margin: 0;">
            Relatório gerado automaticamente por Lemon.meet • 
            ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
          <p style="font-size: 11px; color: #aaa; margin: 4px 0 0 0;">
            Este relatório contém informações confidenciais. Distribua apenas para pessoas autorizadas.
          </p>
        </div>
      `;

      document.body.appendChild(pdfContainer);

      // Configurações otimizadas para alta qualidade
      const opt = {
        margin: [15, 15, 15, 15] as [number, number, number, number],
        filename: `relatorio-completo-${formatWeekLabel(start, end).replace(/\s+/g, '-')}.pdf`,
        image: { type: 'jpeg' as const, quality: 1.0 },
        html2canvas: { 
          scale: 3,
          useCORS: true,
          letterRendering: true,
          logging: false,
          width: 794,  // A4 width em pixels (210mm)
          windowWidth: 794
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
      };

      // Gera e baixa o PDF
      await html2pdf().set(opt).from(pdfContainer).save();
      
      // Remove o container temporário
      document.body.removeChild(pdfContainer);
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

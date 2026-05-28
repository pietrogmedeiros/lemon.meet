import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import {
  GraduationCap, TrendingUp, TrendingDown, Minus,
  Star, AlertCircle, Lightbulb, RefreshCw, Target
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BantDimAnalysis {
  avg: number;
  insight: string;
}

interface CoachingReport {
  overallScore: number;
  trend: 'improving' | 'stable' | 'declining';
  strengths: Array<{ title: string; description: string }>;
  improvements: Array<{ title: string; description: string }>;
  bantAnalysis: {
    budget: BantDimAnalysis;
    authority: BantDimAnalysis;
    need: BantDimAnalysis;
    timeline: BantDimAnalysis;
  };
  weeklyTip: string;
}

// ── Helper components ──────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? '#2D5A27' : score >= 5 ? '#B8860B' : '#DC3545';
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} strokeWidth="7" stroke="#F0F0F0" fill="none" />
        <circle
          cx="48" cy="48" r={r} strokeWidth="7" stroke={color} fill="none"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold" style={{ color }}>{score.toFixed(1)}</span>
        <span className="text-[10px] text-tertiary">/10</span>
      </div>
    </div>
  );
}

function BANTBar({ label, value, insight }: { label: string; value: number; insight: string }) {
  const pct = (value / 10) * 100;
  const color = value >= 7 ? 'bg-[#2D5A27]' : value >= 4 ? 'bg-[#FFD700]' : 'bg-[#DC3545]';
  const textColor = value >= 7 ? 'text-brand' : value >= 4 ? 'text-[#7A5C00]' : 'text-[#DC3545]';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${textColor}`}>{value.toFixed(1)}</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-secondary">{insight}</p>
    </div>
  );
}

function TrendBadge({ trend }: { trend: CoachingReport['trend'] }) {
  if (trend === 'improving') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-[#2D5A27]/10 text-brand px-2.5 py-1 rounded-full">
      <TrendingUp size={12} /> Em evolução
    </span>
  );
  if (trend === 'declining') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-[#DC3545]/10 text-[#DC3545] px-2.5 py-1 rounded-full">
      <TrendingDown size={12} /> Em queda
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-neutral-lighter text-secondary px-2.5 py-1 rounded-full">
      <Minus size={12} /> Estável
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function CoachingPage() {
  const [report, setReport] = useState<CoachingReport | null>(null);
  const [notEnough, setNotEnough] = useState(false);
  const [meetingsCount, setMeetingsCount] = useState(0);
  const [meetingsAnalyzed, setMeetingsAnalyzed] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  }, []);

  const load = useCallback(async (refresh = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeader();
      const url = `${apiUrl}/api/coaching${refresh ? '?refresh=1' : ''}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Erro ao carregar coaching');
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Erro desconhecido');
      if (data.coaching === null) {
        setNotEnough(true);
        setMeetingsCount(data.count ?? 0);
      } else {
        setReport(data.coaching);
        setMeetingsAnalyzed(data.meetingsAnalyzed ?? 0);
        setFromCache(data.cached ?? false);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar coaching');
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, getAuthHeader]);

  useEffect(() => { load(); }, [load]);

  // ── Loading ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex flex-col h-96 items-center justify-center gap-4 text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-solid border-[#2D5A27] border-r-transparent" />
          <p className="text-sm text-secondary">O seu coach está analisando suas reuniões…</p>
        </div>
      </MainLayout>
    );
  }

  // ── Error ─────────────────────────────────────────────────
  if (error) {
    return (
      <MainLayout>
        <div className="flex flex-col h-96 items-center justify-center gap-4 text-center">
          <AlertCircle className="h-10 w-10 text-[#DC3545]" />
          <p className="text-sm text-[#DC3545]">{error}</p>
          <button
            onClick={() => load(false)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2D5A27] text-white text-sm font-medium hover:bg-[#245221] transition-colors"
          >
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      </MainLayout>
    );
  }

  // ── Not enough data ────────────────────────────────────────
  if (notEnough) {
    return (
      <MainLayout>
        <div className="space-y-6 max-w-3xl">
          <div>
            <h1 className="text-2xl font-bold text-primary">Coaching de Vendas</h1>
            <p className="mt-1 text-sm text-secondary">Análise personalizada do seu desempenho comercial</p>
          </div>
          <Card className="p-12 text-center">
            <GraduationCap className="h-14 w-14 text-tertiary mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-primary">Dados insuficientes</h3>
            <p className="mt-2 text-sm text-secondary max-w-sm mx-auto">
              Você tem <strong>{meetingsCount}</strong> reunião concluída
              {meetingsCount !== 1 ? 's' : ''} com insights. São necessárias pelo menos <strong>3</strong> para gerar
              um coaching personalizado.
            </p>
          </Card>
        </div>
      </MainLayout>
    );
  }

  if (!report) return null;

  const bantMap = [
    { key: 'budget',    label: 'Budget (Orçamento)',   data: report.bantAnalysis.budget },
    { key: 'authority', label: 'Authority (Decisor)',   data: report.bantAnalysis.authority },
    { key: 'need',      label: 'Need (Necessidade)',    data: report.bantAnalysis.need },
    { key: 'timeline',  label: 'Timeline (Prazo)',      data: report.bantAnalysis.timeline },
  ] as const;

  // ── Main render ────────────────────────────────────────────
  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-primary">Coaching de Vendas</h1>
            <p className="mt-1 text-sm text-secondary">
              Baseado nas suas últimas <strong>{meetingsAnalyzed}</strong> reuniões concluídas
              {fromCache && <span className="ml-2 text-xs text-[#bbb]">• resultado em cache</span>}
            </p>
          </div>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-light bg-surface text-sm text-[#555] hover:border-[#2D5A27] hover:text-brand transition-colors"
          >
            <RefreshCw size={14} /> Atualizar análise
          </button>
        </div>

        {/* Overview — score ring + trend */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <Card className="p-6 flex flex-col items-center justify-center gap-3 border-l-4 border-l-[#2D5A27]">
            <p className="text-xs font-semibold uppercase tracking-widest text-tertiary">Maturidade Comercial</p>
            <ScoreRing score={report.overallScore} />
            <TrendBadge trend={report.trend} />
          </Card>

          {/* Dica da semana */}
          <Card className="md:col-span-2 p-6 flex flex-col gap-3 bg-[#2D5A27]/5 border-[#2D5A27]/20">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#FFD700]/30 flex items-center justify-center">
                <Lightbulb size={15} className="text-[#7A5C00]" />
              </div>
              <span className="text-sm font-semibold text-[#7A5C00]">Dica da semana</span>
            </div>
            <p className="text-sm text-primary leading-relaxed">{report.weeklyTip}</p>
          </Card>
        </div>

        {/* Strengths + Improvements */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Pontos fortes */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                <Star size={15} className="text-brand" />
              </div>
              <h2 className="text-sm font-semibold text-primary">Seus pontos fortes</h2>
            </div>
            <div className="space-y-3">
              {report.strengths.map((s, i) => (
                <div key={i} className="rounded-lg bg-[#2D5A27]/5 p-3 space-y-0.5">
                  <p className="text-sm font-semibold text-brand">{s.title}</p>
                  <p className="text-xs text-[#555] leading-relaxed">{s.description}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Áreas de melhoria */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#DC3545]/10 flex items-center justify-center">
                <Target size={15} className="text-[#DC3545]" />
              </div>
              <h2 className="text-sm font-semibold text-primary">Áreas de melhoria</h2>
            </div>
            <div className="space-y-3">
              {report.improvements.map((imp, i) => (
                <div key={i} className="rounded-lg bg-[#DC3545]/5 p-3 space-y-0.5">
                  <p className="text-sm font-semibold text-[#DC3545]">{imp.title}</p>
                  <p className="text-xs text-[#555] leading-relaxed">{imp.description}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* BANT analysis */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-neutral-lighter flex items-center justify-center">
              <TrendingUp size={15} className="text-[#555]" />
            </div>
            <h2 className="text-sm font-semibold text-primary">Análise BANT — média das reuniões</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {bantMap.map(({ key, label, data }) => (
              <BANTBar key={key} label={label} value={data.avg} insight={data.insight} />
            ))}
          </div>
        </Card>

      </div>
    </MainLayout>
  );
}

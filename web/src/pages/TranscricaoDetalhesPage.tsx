import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, Clock, Calendar, Mic, Target, CheckCircle, Mail, BookOpen, Sparkles, X, Copy, Check, Trash2, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSubscription } from '../contexts';

interface TranscriptSegment {
  id: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker: string | null;
  sequence: number;
  created_at: string;
}

interface BantDimension {
  score: number;
  evidence: string;
}

interface MeetingInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  commercialQuality: number;
  executiveContext: string;
  closingProbability: number;
  followUp: string[];
  followUpSuggestions: string[];
  keyTopics: string[];
  actionItems: string[];
  bantScore?: {
    budget: BantDimension;
    authority: BantDimension;
    need: BantDimension;
    timeline: BantDimension;
  };
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

interface ActionItem {
  id: string;
  text: string;
  status: 'pending' | 'done';
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

// ── FollowUpSection — bloqueado no plano Starter ───────────────────────────────

interface FollowUpSectionProps {
  suggestions: string[];
  emailLoading: boolean;
  onGenerateEmail: () => void;
  copiedIndex: number | null;
  onCopy: (text: string, idx: number) => void;
}

function FollowUpSection({ suggestions, emailLoading, onGenerateEmail, copiedIndex, onCopy }: FollowUpSectionProps) {
  const { subscription } = useSubscription();
  const isPro = subscription?.plan === 'professional' || subscription?.plan === 'trial';

  return (
    <div className="relative">
      <Card className={`p-5 ${!isPro ? 'select-none' : ''}`}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-headline-2 text-primary flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Mensagens de Follow-up para o Cliente
            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Vendas</span>
          </h2>
          {isPro && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onGenerateEmail}
              disabled={emailLoading}
              className="flex items-center gap-2"
            >
              {emailLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {emailLoading ? 'Gerando…' : 'Gerar E-mail Completo'}
            </Button>
          )}
        </div>
        <div className={`space-y-3 ${!isPro ? 'blur-sm pointer-events-none' : ''}`}>
          {suggestions.slice(0, 4).map((suggestion, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10 group">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-secondary leading-relaxed">{suggestion}</span>
              {isPro && (
                <button
                  onClick={() => onCopy(suggestion, i)}
                  title="Copiar mensagem"
                  className={`flex-shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-all ${
                    copiedIndex === i
                      ? 'bg-primary text-white'
                      : 'text-secondary opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {copiedIndex === i ? (
                    <><Check className="h-3.5 w-3.5" />Copiado</>
                  ) : (
                    <><Copy className="h-3.5 w-3.5" />Copiar</>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Overlay de bloqueio para plano Starter */}
      {!isPro && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-white shadow-lg border border-[#E8E8E8]">
            <Lock className="h-6 w-6 text-[#888]" />
            <p className="text-sm font-semibold text-[#444]">Disponível no plano Professional</p>
            <a
              href="/subscription"
              className="mt-1 text-xs font-medium text-[#2D5A27] underline underline-offset-2 hover:text-[#1a3a17]"
            >
              Fazer upgrade
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function TranscricaoDetalhesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Action items state
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [actionItemsLoaded, setActionItemsLoaded] = useState(false);

  // Follow-up email state
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailText, setEmailText] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // Per-suggestion copy state
  const [copiedSuggestionIndex, setCopiedSuggestionIndex] = useState<number | null>(null);

  // Briefing state
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  // Pipedrive state
  const [pipedriveConnected, setPipedriveConnected] = useState(false);
  const [pipedriveSyncing, setPipedriveSyncing] = useState(false);
  const [pipedriveSynced, setPipedriveSynced] = useState(false);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  }, []);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/meetings/${id}`, { headers });
        if (!res.ok) { navigate('/meetings'); return; }
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
  }, [id, navigate, apiUrl, getAuthHeader]);

  // Load action items once meeting is ready
  useEffect(() => {
    if (!id || !meeting || actionItemsLoaded) return;

    const loadActionItems = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/meetings/${id}/action-items`, { headers });
        if (!res.ok) return;
        const data = await res.json();

        if (data.items && data.items.length > 0) {
          setActionItems(data.items);
          setActionItemsLoaded(true);
        } else if (meeting.insights?.actionItems?.length) {
          // Seed action items from insights on first load
          const seedRes = await fetch(`${apiUrl}/api/meetings/${id}/action-items`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: meeting.insights.actionItems }),
          });
          if (seedRes.ok) {
            const seedData = await seedRes.json();
            setActionItems(seedData.items || []);
          }
          setActionItemsLoaded(true);
        }
      } catch {
        // Non-critical — if fails, falls back to static display
      }
    };

    loadActionItems();
  }, [id, meeting, actionItemsLoaded, apiUrl, getAuthHeader]);

  // Load briefing once meeting is ready (non-blocking)
  useEffect(() => {
    if (!id || !meeting || meeting.status !== 'completed') return;
    setBriefingLoading(true);
    const loadBriefing = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/meetings/${id}/briefing`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBriefing(data.briefing ?? null);
        }
      } catch {
        // Non-critical
      } finally {
        setBriefingLoading(false);
      }
    };
    loadBriefing();
  }, [id, meeting?.status, apiUrl, getAuthHeader]);

  // Check if Pipedrive is connected
  useEffect(() => {
    const check = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/pipedrive/status`, { headers });
        if (res.ok) {
          const data = await res.json();
          setPipedriveConnected(data.connected);
        }
      } catch {}
    };
    check();
  }, [apiUrl, getAuthHeader]);

  const handleSyncPipedrive = async () => {
    if (!id || pipedriveSyncing) return;
    setPipedriveSyncing(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/pipedrive/sync/${id}`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        setPipedriveSynced(true);
        setTimeout(() => setPipedriveSynced(false), 4000);
      }
    } catch {
      // Silent fail
    } finally {
      setPipedriveSyncing(false);
    }
  };

  const toggleActionItem = async (item: ActionItem) => {
    const newStatus = item.status === 'done' ? 'pending' : 'done';
    setActionItems(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i));
    try {
      const headers = await getAuthHeader();
      await fetch(`${apiUrl}/api/meetings/${id}/action-items/${item.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      // Revert on failure
      setActionItems(prev => prev.map(i => i.id === item.id ? { ...i, status: item.status } : i));
    }
  };

  const deleteActionItem = async (itemId: string) => {
    setActionItems(prev => prev.filter(i => i.id !== itemId));
    try {
      const headers = await getAuthHeader();
      await fetch(`${apiUrl}/api/meetings/${id}/action-items/${itemId}`, {
        method: 'DELETE',
        headers,
      });
    } catch {
      // Silent fail — item already removed from UI
    }
  };

  const generateEmail = async () => {
    if (!id) return;
    setEmailLoading(true);
    setEmailText(null);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/meetings/${id}/follow-up-email`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setEmailText(data.email);
      }
    } catch {
      // Silent fail
    } finally {
      setEmailLoading(false);
    }
  };

  const copyEmail = async () => {
    if (!emailText) return;
    await navigator.clipboard.writeText(emailText);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  const copySuggestion = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedSuggestionIndex(index);
    setTimeout(() => setCopiedSuggestionIndex(null), 2000);
  };

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
          {/* Pipedrive sync button */}
          {pipedriveConnected && meeting.status === 'completed' && meeting.insights && (
            <button
              onClick={handleSyncPipedrive}
              disabled={pipedriveSyncing || pipedriveSynced}
              className={`flex items-center gap-2 text-[13px] font-medium px-3 py-2 rounded-lg border transition-all mt-1 ${
                pipedriveSynced
                  ? 'border-[#2D5A27] text-[#2D5A27] bg-[#2D5A27]/8'
                  : 'border-[#E0E0E0] text-[#555] hover:border-[#2D5A27] hover:text-[#2D5A27] bg-white'
              }`}
              title="Enviar resumo e follow-up para o Pipedrive"
            >
              {pipedriveSyncing ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              ) : pipedriveSynced ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <img src="/pipedrive.png" alt="Pipedrive" className="w-4 h-4 object-contain" />
              )}
              {pipedriveSynced ? 'Enviado!' : 'Enviar para Pipedrive'}
            </button>
          )}
        </div>

        {/* Briefing pré-reunião */}
        {(briefingLoading || briefing) && (
          <Card className="p-5 border-l-4 border-l-[#FFD700] bg-[#FFFDF0]">
            <h2 className="text-headline-2 text-primary mb-3 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-[#B8860B]" />
              Contexto de Reuniões Anteriores
              <span className="ml-2 text-xs bg-[#FFD700]/30 text-[#7A5C00] px-2 py-0.5 rounded-full font-medium">Exclusivo Lemon</span>
            </h2>
            {briefingLoading ? (
              <div className="flex items-center gap-2 text-sm text-secondary">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#B8860B] border-r-transparent" />
                Gerando contexto…
              </div>
            ) : (
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">{briefing}</p>
            )}
          </Card>
        )}

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

            {/* BANT Scorecard */}
            {meeting.insights.bantScore && (
              <Card className="p-5">
                <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Scorecard BANT
                </h2>
                <div className="space-y-3">
                  {(
                    [
                      { key: 'budget', label: 'Budget', color: '#22c55e' },
                      { key: 'authority', label: 'Authority', color: '#3b82f6' },
                      { key: 'need', label: 'Need', color: '#f59e0b' },
                      { key: 'timeline', label: 'Timeline', color: '#a855f7' },
                    ] as const
                  ).map(({ key, label, color }) => {
                    const dim = meeting.insights!.bantScore![key];
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{label}</span>
                          <span className="text-xs font-bold" style={{ color }}>{dim.score}/10</span>
                        </div>
                        <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden mb-1">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${dim.score * 10}%`, backgroundColor: color }}
                          />
                        </div>
                        <p className="text-xs text-secondary leading-snug">{dim.evidence}</p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Action items with status tracking */}
            <Card className="p-5 lg:col-span-2">
              <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Próximos Passos
                {actionItems.filter(i => i.status === 'done').length > 0 && (
                  <span className="ml-auto text-xs text-secondary font-normal">
                    {actionItems.filter(i => i.status === 'done').length}/{actionItems.length} concluídos
                  </span>
                )}
              </h2>
              {actionItems.length > 0 ? (
                <ul className="space-y-2 mb-4">
                  {actionItems.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 group">
                      <button
                        onClick={() => toggleActionItem(item)}
                        className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border transition-colors ${
                          item.status === 'done'
                            ? 'bg-primary border-primary'
                            : 'border-gray-300 hover:border-primary'
                        }`}
                        aria-label={item.status === 'done' ? 'Marcar como pendente' : 'Marcar como concluído'}
                      >
                        {item.status === 'done' && (
                          <svg viewBox="0 0 12 12" fill="none" className="w-full h-full p-0.5">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span className={`flex-1 text-sm leading-snug ${item.status === 'done' ? 'line-through text-secondary/50' : 'text-secondary'}`}>
                        {item.text}
                      </span>
                      <button
                        onClick={() => deleteActionItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-secondary/50 hover:text-red-500 flex-shrink-0"
                        aria-label="Remover item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : meeting.insights.actionItems?.length > 0 ? (
                <ul className="space-y-2 mb-4">
                  {meeting.insights.actionItems.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-secondary">
                      <span className="text-primary font-bold mt-0.5">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
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

        {/* Follow-up Suggestions + Email Generator */}
        {(meeting.insights?.followUpSuggestions ?? []).length > 0 && (
          <FollowUpSection
            suggestions={meeting.insights!.followUpSuggestions}
            emailLoading={emailLoading}
            onGenerateEmail={generateEmail}
            copiedIndex={copiedSuggestionIndex}
            onCopy={copySuggestion}
          />
        )}

        {/* Email Modal */}
        {emailText && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between p-5 border-b">
                <h3 className="text-headline-2 text-primary flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  E-mail de Follow-up
                </h3>
                <button
                  onClick={() => setEmailText(null)}
                  className="text-secondary hover:text-primary transition-colors"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <pre className="whitespace-pre-wrap text-sm text-secondary font-sans leading-relaxed">{emailText}</pre>
              </div>
              <div className="flex gap-3 p-5 border-t">
                <Button onClick={copyEmail} className="flex items-center gap-2">
                  {emailCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {emailCopied ? 'Copiado!' : 'Copiar E-mail'}
                </Button>
                <Button variant="secondary" onClick={() => setEmailText(null)}>Fechar</Button>
              </div>
            </div>
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

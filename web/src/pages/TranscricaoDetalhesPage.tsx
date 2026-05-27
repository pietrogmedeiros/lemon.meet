import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { DecisionSummaryCard, type DecisionSummary } from '../components/ui/DecisionSummaryCard';
import { DecisionInsightsAnnounceModal } from '../components/DecisionInsightsAnnounceModal';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, Clock, Calendar, Mic, Target, CheckCircle, Mail, BookOpen, Sparkles, X, Copy, Check, Trash2, Lock, Users, RefreshCw, Download, Phone, Edit2, Save, MessageCircle, Heart, AlertTriangle, Smile, ExternalLink } from 'lucide-react';
import { RapportSection } from '../components/ui/RapportSection';
import { MeetingChatPanel } from '../components/MeetingChatPanel';
import { supabase } from '../lib/supabase';
import { describeFailure } from '../lib/failureReason';
import { useSubscription, useAuth } from '../contexts';

interface TranscriptSegment {
  id: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker: string | null;
  sequence: number;
  created_at: string;
}

interface ScoreDimension {
  score: number;
  evidence: string;
}

interface BantScore {
  budget: ScoreDimension;
  authority: ScoreDimension;
  need: ScoreDimension;
  timeline: ScoreDimension;
}

interface SpinScore {
  situation: ScoreDimension;
  problem: ScoreDimension;
  implication: ScoreDimension;
  needPayoff: ScoreDimension;
}

interface EscalationFlag {
  description: string;
  severity: 'low' | 'medium' | 'high';
}

interface BaseInsights {
  sentiment: 'positive' | 'neutral' | 'negative';
  executiveContext: string;
  followUp: string[];
  followUpSuggestions: string[];
  keyTopics: string[];
  actionItems: string[];
  decisionSummary?: DecisionSummary;
}

interface BantInsights extends BaseInsights {
  framework: 'bant';
  commercialQuality: number;
  closingProbability: number;
  bantScore: BantScore;
}

interface SpinInsights extends BaseInsights {
  framework: 'spin';
  commercialQuality: number;
  closingProbability: number;
  spinScore: SpinScore;
}

interface CsInsights extends BaseInsights {
  framework: 'cs';
  healthScore: number;
  churnRisk: 'low' | 'medium' | 'high';
  churnRiskEvidence: string;
  satisfactionScore: number;
  escalationFlags: EscalationFlag[];
}

type MeetingInsights = BantInsights | SpinInsights | CsInsights;

// Insights antigos não tinham `framework`; assumimos BANT (era o único modo).
function getFramework(insights: MeetingInsights | null | undefined): 'bant' | 'spin' | 'cs' {
  if (!insights) return 'bant';
  return (insights as any).framework ?? 'bant';
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
  participant_emails?: string[] | null;
  user_name?: string | null;
  user_email?: string | null;
  user_avatar_url?: string | null;
  failure_reason?: string | null;
}

// Traduz códigos de failure_reason em mensagens amigáveis pro usuário.
// O mapeamento PT/BR vive em lib/failureReason (compartilhado com a lista).
function describeFailureReason(reason: string | null | undefined): { title: string; detail: string } | null {
  const d = describeFailure(reason);
  return d ? { title: d.title, detail: d.detail } : null;
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
    case 'failed': return <Badge variant="danger">Falhou</Badge>;
    case 'error': return <Badge variant="danger">Erro</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

// ── FollowUpSection — bloqueado no plano Starter ───────────────────────────────

type ToneType = 'formal' | 'objetivo' | 'urgente' | 'consultivo' | 'criativo';

interface FollowUpSectionProps {
  suggestions: string[];
  emailLoading: boolean;
  onGenerateEmail: () => void;
  copiedIndex: number | null;
  onCopy: (text: string, idx: number) => void;
  meetingId: string;
  contactPhone: string | null;
}

function FollowUpSection({ suggestions, emailLoading, onGenerateEmail, copiedIndex, onCopy, meetingId, contactPhone }: FollowUpSectionProps) {
  const { subscription } = useSubscription();
  const isPro = subscription?.plan === 'professional' || subscription?.plan === 'trial';
  const { session } = useAuth();
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  
  // Estado da barra de controle global
  const [selectedFupIndex, setSelectedFupIndex] = useState<number | null>(null);
  const [selectedTone, setSelectedTone] = useState<ToneType | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // Estado para FUPs regenerados (carrega do banco + novos)
  const [regeneratedFups, setRegeneratedFups] = useState<{ [key: number]: { [tone: string]: string } }>({});
  // FUP atualmente exibido por índice
  const [currentFups, setCurrentFups] = useState<{ [key: number]: { content: string; tone?: string } }>({});

  // Carrega versões salvas do banco ao montar o componente
  useEffect(() => {
    if (!isPro || !session?.access_token) return;

    const loadSavedVersions = async () => {
      try {
        const headers = {
          Authorization: `Bearer ${session.access_token}`,
        };
        
        const res = await fetch(`${apiUrl}/api/meetings/${meetingId}/fup-versions`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.versions) {
            setRegeneratedFups(data.versions);
            
            // Define o FUP atual para cada índice (usa a última versão salva se existir)
            const initialCurrentFups: { [key: number]: { content: string; tone?: string } } = {};
            suggestions.forEach((suggestion, i) => {
              const versions = data.versions[i];
              if (versions && Object.keys(versions).length > 0) {
                // Usa a primeira versão disponível como padrão
                const firstTone = Object.keys(versions)[0];
                initialCurrentFups[i] = {
                  content: versions[firstTone],
                  tone: firstTone
                };
              } else {
                initialCurrentFups[i] = { content: suggestion };
              }
            });
            setCurrentFups(initialCurrentFups);
          }
        }
      } catch (error) {
        console.error('Error loading saved FUP versions:', error);
      }
    };

    loadSavedVersions();
  }, [isPro, session?.access_token, meetingId, apiUrl, suggestions]);

  const toneLabels: { value: ToneType; label: string; description: string }[] = [
    { value: 'formal', label: 'Formal', description: 'Profissional e estruturado' },
    { value: 'objetivo', label: 'Objetivo', description: 'Direto ao ponto' },
    { value: 'urgente', label: 'Urgente', description: 'Ação imediata' },
    { value: 'consultivo', label: 'Consultivo', description: 'Empático e dialógico' },
    { value: 'criativo', label: 'Criativo', description: 'Descontraído e humano' },
  ];

  const handleRegenerate = async () => {
    if (selectedFupIndex === null || !selectedTone) return;

    const currentFup = currentFups[selectedFupIndex]?.content || suggestions[selectedFupIndex];
    
    setIsRegenerating(true);
    try {
      const headers = {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      };
      
      const res = await fetch(`${apiUrl}/api/meetings/${meetingId}/regenerate-fup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          originalFup: currentFup,
          tone: selectedTone,
          fupIndex: selectedFupIndex,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        
        // Atualiza o estado com a nova versão
        setRegeneratedFups(prev => ({
          ...prev,
          [selectedFupIndex]: {
            ...prev[selectedFupIndex],
            [selectedTone]: data.regeneratedFup
          }
        }));

        // Atualiza o FUP atual exibido
        setCurrentFups(prev => ({
          ...prev,
          [selectedFupIndex]: {
            content: data.regeneratedFup,
            tone: selectedTone
          }
        }));

        // Limpa os controles após regenerar com sucesso
        setSelectedFupIndex(null);
        setSelectedTone(null);
      } else {
        console.error('Failed to regenerate FUP:', res.status);
        alert('Erro ao regenerar FUP. Tente novamente.');
      }
    } catch (error) {
      console.error('Error regenerating FUP:', error);
      alert('Erro ao regenerar FUP. Tente novamente.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopy = (fupIndex: number) => {
    const textToCopy = currentFups[fupIndex]?.content || suggestions[fupIndex];
    onCopy(textToCopy, fupIndex);
  };

  const handleSwitchToVersion = (fupIndex: number, tone: ToneType | null) => {
    if (tone === null) {
      // Volta ao original
      setCurrentFups(prev => ({
        ...prev,
        [fupIndex]: { content: suggestions[fupIndex] }
      }));
    } else if (regeneratedFups[fupIndex]?.[tone]) {
      // Troca para a versão específica
      setCurrentFups(prev => ({
        ...prev,
        [fupIndex]: {
          content: regeneratedFups[fupIndex][tone],
          tone
        }
      }));
    }
  };

  return (
    <div className="relative">
      <Card className={`p-5 ${!isPro ? 'select-none' : ''}`}>
        {/* Header */}
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

        {/* Barra de controle unificada (apenas se isPro) */}
        {isPro && (selectedFupIndex !== null) && (
          <div className="mb-4 p-4 bg-primary/5 border border-primary/15 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-secondary">
                Editando FUP #{(selectedFupIndex ?? 0) + 1}
              </span>
              <button
                onClick={() => {
                  setSelectedFupIndex(null);
                  setSelectedTone(null);
                }}
                className="ml-auto text-xs text-secondary/70 hover:text-secondary transition-colors"
              >
                ✕ Cancelar
              </button>
            </div>

            <div className="space-y-3">
              {/* Tons disponíveis */}
              <div>
                <p className="text-xs font-medium text-secondary mb-2">Selecione o tom:</p>
                <div className="flex flex-wrap gap-2">
                  {toneLabels.map(({ value, label, description }) => {
                    const hasVersion = regeneratedFups[selectedFupIndex]?.[value];
                    return (
                      <button
                        key={value}
                        onClick={() => setSelectedTone(value)}
                        disabled={isRegenerating}
                        className={`relative px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                          selectedTone === value
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-secondary border-primary/20 hover:border-primary/40 hover:bg-primary/5'
                        } ${isRegenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={description}
                      >
                        {label}
                        {hasVersion && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full border border-white"></span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botão de regenerar */}
              <button
                onClick={handleRegenerate}
                disabled={!selectedTone || isRegenerating}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
                  !selectedTone || isRegenerating
                    ? 'bg-neutral-lighter text-secondary/50 cursor-not-allowed'
                    : 'bg-primary text-white hover:bg-primary/90'
                }`}
              >
                {isRegenerating ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    Regenerando…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Regenerar com tom {selectedTone && toneLabels.find(t => t.value === selectedTone)?.label}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Lista de FUPs */}
        <div className={`space-y-3 ${!isPro ? 'blur-sm pointer-events-none' : ''}`}>
          {suggestions.slice(0, 4).map((suggestion, i) => {
            const currentFup = currentFups[i]?.content || suggestion;
            const currentTone = currentFups[i]?.tone;
            const hasVersions = regeneratedFups[i] && Object.keys(regeneratedFups[i]).length > 0;
            const isEditing = selectedFupIndex === i;

            return (
              <div
                key={i}
                className={`rounded-lg border transition-all ${
                  isEditing
                    ? 'bg-primary/10 border-primary/30 shadow-sm'
                    : 'bg-primary/5 border-primary/10'
                }`}
              >
                {/* Conteúdo do FUP */}
                <div className="flex items-start gap-3 p-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-secondary leading-relaxed">{currentFup}</span>
                  
                  {/* Botões à direita */}
                  {isPro && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Indicador de tom + versões salvas */}
                      {hasVersions && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleSwitchToVersion(i, null)}
                            className={`px-2 py-1 text-xs font-medium rounded border transition-all ${
                              !currentTone
                                ? 'bg-primary text-white border-primary'
                                : 'bg-white text-secondary/70 border-primary/10 hover:border-primary/30'
                            }`}
                            title="Versão original"
                          >
                            Original
                          </button>
                          {Object.keys(regeneratedFups[i] || {}).map((tone) => (
                            <button
                              key={tone}
                              onClick={() => handleSwitchToVersion(i, tone as ToneType)}
                              className={`px-2 py-1 text-xs font-medium rounded border transition-all ${
                                currentTone === tone
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-white text-secondary/70 border-primary/10 hover:border-primary/30'
                              }`}
                              title={`Tom: ${toneLabels.find(t => t.value === tone)?.label}`}
                            >
                              {toneLabels.find(t => t.value === tone)?.label}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Botão Refinar */}
                      <button
                        onClick={() => setSelectedFupIndex(isEditing ? null : i)}
                        disabled={isRegenerating}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${
                          isEditing
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-secondary border-primary/20 hover:border-primary/40 hover:bg-primary/5'
                        } ${isRegenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Refinar
                      </button>

                      {/* Botão Copiar */}
                      <button
                        onClick={() => handleCopy(i)}
                        disabled={isRegenerating}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${
                          copiedIndex === i
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-secondary border-primary/20 hover:border-primary/40 hover:bg-primary/5'
                        } ${isRegenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {copiedIndex === i ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copiar
                          </>
                        )}
                      </button>

                      {/* Botão WhatsApp */}
                      {contactPhone && (
                        <a
                          href={`https://wa.me/${contactPhone}?text=${encodeURIComponent(currentFup)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border bg-green-500 text-white border-green-600 hover:bg-green-600 transition-all"
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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

  // Anúncio one-time da feature "Insights que impulsionam decisões" (pop-up ao abrir a reunião)
  const { user } = useAuth();
  const [showFeatureAnnounce, setShowFeatureAnnounce] = useState(false);
  const announceKey = user?.id ? `lemon_announce_decision_insights_${user.id}` : null;
  useEffect(() => {
    if (announceKey && !localStorage.getItem(announceKey)) setShowFeatureAnnounce(true);
  }, [announceKey]);
  const dismissFeatureAnnounce = () => {
    if (announceKey) localStorage.setItem(announceKey, '1');
    setShowFeatureAnnounce(false);
  };

  // Action items state
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [actionItemsLoaded, setActionItemsLoaded] = useState(false);

  // Follow-up email state
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailText, setEmailText] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // Per-suggestion copy state
  const [copiedSuggestionIndex, setCopiedSuggestionIndex] = useState<number | null>(null);

  // Rapport state
  const [rapport, setRapport] = useState<{
    website_url: string | null;
    linkedin_url: string | null;
    instagram_url: string | null;
    rapport_data: any | null;
  } | null>(null);
  const [rapportFetchDone, setRapportFetchDone] = useState(false);

  // Briefing state
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  // HubSpot state
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [hubspotSyncing, setHubspotSyncing] = useState(false);
  const [hubspotSynced, setHubspotSynced] = useState(false);
  const [hubspotError, setHubspotError] = useState<string | null>(null);
  const [hubspotNeedsConnect, setHubspotNeedsConnect] = useState(false);
  const [hubspotResult, setHubspotResult] = useState<{ action: string; dealUrl: string | null; ownerAssigned: boolean } | null>(null);

  // Contact phone state
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);

  // Chat AI state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string>('');

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
        
        // Remove duplicatas baseado em text + start_seconds
        const segmentsMap = new Map<string, TranscriptSegment>();
        (data.segments || []).forEach((seg: TranscriptSegment) => {
          const key = `${seg.text.trim()}_${seg.start_seconds}`;
          if (!segmentsMap.has(key)) {
            segmentsMap.set(key, seg);
          }
        });
        const uniqueSegments = Array.from(segmentsMap.values()).sort((a, b) => a.sequence - b.sequence);
        
        setSegments(uniqueSegments);
      } catch {
        navigate('/meetings');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, navigate, apiUrl, getAuthHeader]);

  // Load auth token for chat
  useEffect(() => {
    const loadToken = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAuthToken(session.access_token);
      }
    };
    loadToken();
  }, []);

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

  // Load rapport once meeting is ready — só busca dados existentes, nunca gera automaticamente
  useEffect(() => {
    if (!id || !meeting || rapportFetchDone) return;
    const loadRapport = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/meetings/${id}/rapport`, { headers });
        if (res.ok) {
          const data = await res.json();
          setRapport(data.rapport ?? null);
        }
      } catch {
        // Non-critical
      } finally {
        setRapportFetchDone(true);
      }
    };
    loadRapport();
  }, [id, meeting, rapportFetchDone, apiUrl, getAuthHeader]);

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
        } else {
          console.error('Failed to load briefing:', res.status);
          setBriefing(null);
        }
      } catch (error) {
        console.error('Error loading briefing:', error);
        setBriefing(null);
      } finally {
        setBriefingLoading(false);
      }
    };
    loadBriefing();
  }, [id, meeting?.status, apiUrl, getAuthHeader]);

  // Load contact phone
  useEffect(() => {
    if (!id || !meeting) return;
    const loadPhone = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/meetings/${id}/contact-phone`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.phone) {
            setContactPhone(data.phone);
            setPhoneInput(data.phone);
          }
        }
      } catch (error) {
        console.error('Error loading contact phone:', error);
      }
    };
    loadPhone();
  }, [id, meeting, apiUrl, getAuthHeader]);

  // Check if HubSpot is connected
  useEffect(() => {
    const check = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/api/hubspot/status`, { headers });
        if (res.ok) {
          const data = await res.json();
          setHubspotConnected(data.connected);
        }
      } catch {}
    };
    check();
  }, [apiUrl, getAuthHeader]);

  const handleSyncHubspot = async () => {
    if (!id || hubspotSyncing) return;
    setHubspotSyncing(true);
    setHubspotError(null);
    setHubspotNeedsConnect(false);
    setHubspotResult(null);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/hubspot/sync/${id}`, {
        method: 'POST',
        headers,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setHubspotSynced(true);
        setHubspotResult({
          action: data.action ?? 'created',
          dealUrl: data.dealUrl ?? null,
          ownerAssigned: data.ownerAssigned !== false,
        });
      } else {
        const code = data?.error as string | undefined;
        const notConnected = res.status === 401 || code === 'HubSpot not connected or invalid token';
        if (notConnected) {
          setHubspotNeedsConnect(true);
          setHubspotError('Você ainda não conectou o HubSpot (ou a sessão expirou). Conecte sua conta para enviar o negócio.');
        } else {
          const msg =
            code === 'Meeting not found' ? 'Reunião não encontrada ou você não tem permissão para sincronizá-la.'
            : code === 'Failed to create deal in HubSpot' ? 'Não foi possível criar o negócio no HubSpot. Tente novamente.'
            : code === 'Deal was not properly created/updated in HubSpot' ? 'O negócio não foi confirmado no HubSpot. Tente novamente.'
            : code || `Falha ao enviar (HTTP ${res.status}).`;
          setHubspotError(msg);
        }
      }
    } catch {
      setHubspotError('Erro de conexão ao enviar para o HubSpot. Tente novamente.');
    } finally {
      setHubspotSyncing(false);
    }
  };

  const saveContactPhone = async () => {
    if (!phoneInput.trim()) return;
    setPhoneSaving(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/meetings/${id}/contact-phone`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      if (res.ok) {
        const data = await res.json();
        setContactPhone(data.phone);
        setPhoneEditing(false);
      }
    } catch (error) {
      console.error('Error saving contact phone:', error);
    } finally {
      setPhoneSaving(false);
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
      <DecisionInsightsAnnounceModal isOpen={showFeatureAnnounce} onClose={dismissFeatureAnnounce} />
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
            {meeting.participant_emails && meeting.participant_emails.length > 0 && (
              <div className="mt-2 flex items-start gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-secondary flex-shrink-0 mt-0.5">
                  <Users className="h-3.5 w-3.5" />
                  Participantes:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.participant_emails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 text-xs bg-neutral-100 text-secondary px-2 py-0.5 rounded-full"
                    >
                      <Mail className="h-3 w-3" />
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Campo de telefone do contato */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-secondary flex-shrink-0">
                <Phone className="h-3.5 w-3.5" />
                Telefone:
              </span>
              {phoneEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="DDI+DD+TELEFONE (ex: 5511999999999)"
                    className="text-xs border border-neutral-300 rounded px-2 py-1 w-64"
                    disabled={phoneSaving}
                  />
                  <button
                    onClick={saveContactPhone}
                    disabled={phoneSaving}
                    className="text-xs text-primary hover:text-primary-dark disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setPhoneEditing(false);
                      setPhoneInput(contactPhone || '');
                    }}
                    disabled={phoneSaving}
                    className="text-xs text-secondary hover:text-primary disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : contactPhone ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-neutral-100 text-secondary px-2 py-0.5 rounded-full">
                    +{contactPhone}
                  </span>
                  <button
                    onClick={() => setPhoneEditing(true)}
                    className="text-xs text-secondary hover:text-primary"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPhoneEditing(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Adicionar telefone
                </button>
              )}
            </div>

            {(meeting.user_name || meeting.user_email) && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-secondary flex-shrink-0">Gravada por:</span>
                <div className="flex items-center gap-1.5">
                  {meeting.user_avatar_url ? (
                    <img
                      src={meeting.user_avatar_url}
                      alt={meeting.user_name ?? meeting.user_email ?? ''}
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-primary">
                        {(meeting.user_name ?? meeting.user_email ?? '?')[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span className="text-xs font-medium text-secondary">
                    {meeting.user_name ?? meeting.user_email}
                  </span>
                </div>
              </div>
            )}
          </div>
          {/* HubSpot sync button */}
          {hubspotConnected && meeting.status === 'completed' && meeting.insights && (
            <div className="mt-1 flex flex-col gap-2 items-start">
              <button
                onClick={handleSyncHubspot}
                disabled={hubspotSyncing}
                className={`flex items-center gap-2 text-[13px] font-medium px-3 py-2 rounded-lg border transition-all disabled:opacity-60 ${
                  hubspotSynced
                    ? 'border-[#FF7A59] text-[#FF7A59] bg-[#FF7A59]/8'
                    : 'border-[#E0E0E0] text-[#555] hover:border-[#FF7A59] hover:text-[#FF7A59] bg-white'
                }`}
                title="Enviar resumo e deal para o HubSpot"
              >
                {hubspotSyncing ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                ) : hubspotSynced ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <img src="/hubspot.webp" alt="HubSpot" className="w-4 h-4 object-contain" />
                )}
                {hubspotSyncing
                  ? 'Enviando...'
                  : hubspotSynced
                    ? (hubspotResult?.action === 'updated' ? 'Negócio atualizado' : 'Negócio criado')
                    : 'Enviar para HubSpot'}
              </button>

              {/* Sucesso: link do negócio criado/atualizado */}
              {hubspotResult && (
                <div className="flex flex-col gap-1.5 text-[12px] text-[#555] bg-[#FF7A59]/8 border border-[#FF7A59]/30 rounded-lg px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5 text-[#FF7A59] shrink-0" />
                    <span>Negócio {hubspotResult.action === 'updated' ? 'atualizado' : 'criado'} no HubSpot.</span>
                    {hubspotResult.dealUrl && (
                      <a
                        href={hubspotResult.dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#FF7A59] hover:underline"
                      >
                        Abrir negócio <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {!hubspotResult.ownerAssigned && (
                    <div className="flex items-start gap-2 text-[#92400E]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Seu usuário não foi encontrado como proprietário (owner) no HubSpot, então o negócio ficou sem proprietário.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Erro visível */}
              {hubspotError && (
                <div className="flex flex-col gap-1.5 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{hubspotError}</span>
                  </div>
                  {hubspotNeedsConnect && (
                    <button
                      onClick={() => navigate('/integrations/apps')}
                      className="inline-flex items-center gap-1 font-medium text-[#FF7A59] hover:underline self-start"
                    >
                      Conectar HubSpot <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rapport pré-reunião */}
        {rapportFetchDone && (
          <RapportSection
            meetingId={id!}
            initialRapport={rapport}
            apiUrl={apiUrl}
            getAuthHeader={getAuthHeader}
          />
        )}

        {/* Briefing pré-reunião */}
        {(briefingLoading || briefing || (!briefingLoading && briefing === null)) && meeting.status === 'completed' && (
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
            ) : briefing ? (
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">{briefing}</p>
            ) : (
              <p className="text-sm text-secondary/70 italic">
                Nenhuma reunião anterior encontrada com este cliente. O contexto será gerado quando houver histórico de reuniões.
              </p>
            )}
          </Card>
        )}

        {/* Banner de falha — exibe motivo quando a reunião terminou em erro
            ou quando insights falharam mesmo com transcript disponível */}
        {(() => {
          const info = describeFailureReason(meeting.failure_reason);
          if (!info) return null;
          return (
            <Card className="p-4 border-l-4 border-l-red-500 bg-red-50/40">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center mt-0.5">
                  <X className="h-4 w-4 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-700">{info.title}</p>
                  <p className="text-sm text-secondary mt-1 leading-relaxed">{info.detail}</p>
                  <p className="text-xs text-secondary/60 mt-2 font-mono">
                    código: {meeting.failure_reason}
                  </p>
                </div>
              </div>
            </Card>
          );
        })()}

        {/* Insights que impulsionam decisões — card; ou aviso de disponibilidade
            para reuniões anteriores ao lançamento (24/05/2026). */}
        {meeting.insights?.decisionSummary ? (
          <DecisionSummaryCard summary={meeting.insights.decisionSummary} />
        ) : (meeting.status === 'completed' && meeting.insights && meeting.created_at < '2026-05-24') ? (
          <Card className="p-4 border-l-4 border-l-[#2D5A27] bg-[#F6FBF6]">
            <p className="text-sm text-secondary flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-[#2D5A27] flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold text-primary">Insights que impulsionam decisões</span> está
                disponível para reuniões a partir de 24/05/2026.
              </span>
            </p>
          </Card>
        ) : null}

        {/* Insights */}
        {meeting.insights && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Card 1: Score Comercial (Sales) ou Saúde da Conta (CS) */}
            {(() => {
              const insights = meeting.insights!;
              const framework = getFramework(insights);

              const sentimentLabel = insights.sentiment === 'positive' ? '😊 Positivo' :
                                     insights.sentiment === 'negative' ? '😟 Negativo' : '😐 Neutro';

              if (framework === 'cs') {
                const cs = insights as CsInsights;
                const churnColor = cs.churnRisk === 'high' ? '#ef4444' : cs.churnRisk === 'medium' ? '#f59e0b' : '#22c55e';
                const churnLabel = cs.churnRisk === 'high' ? 'Alto' : cs.churnRisk === 'medium' ? 'Médio' : 'Baixo';
                return (
                  <Card className="p-5">
                    <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                      <Heart className="h-5 w-5" />
                      Saúde da Conta
                    </h2>
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-20 h-20 rounded-full border-4 border-accent flex items-center justify-center">
                        <span className="text-2xl font-bold text-primary">
                          {cs.healthScore ?? '–'}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="h-3 rounded-full bg-neutral-lighter overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${cs.healthScore ?? 0}%` }}
                          />
                        </div>
                        <p className="mt-2 text-sm text-secondary">
                          Sentimento: {sentimentLabel}
                        </p>
                        <p className="mt-1 text-sm text-secondary">
                          Risco de churn:{' '}
                          <strong style={{ color: churnColor }}>{churnLabel}</strong>
                        </p>
                      </div>
                    </div>
                    {insights.executiveContext && (
                      <p className="mt-4 text-sm text-secondary bg-neutral-lighter rounded-lg p-3 leading-relaxed">
                        {insights.executiveContext}
                      </p>
                    )}
                  </Card>
                );
              }

              // Sales (BANT ou SPIN) — mesma estrutura
              const sales = insights as BantInsights | SpinInsights;
              return (
                <Card className="p-5">
                  <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Score Comercial
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-20 h-20 rounded-full border-4 border-accent flex items-center justify-center">
                      <span className="text-2xl font-bold text-primary">
                        {sales.commercialQuality ?? '–'}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="h-3 rounded-full bg-neutral-lighter overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${(sales.commercialQuality / 10) * 100}%` }}
                        />
                      </div>
                      <p className="mt-2 text-sm text-secondary">
                        Sentimento: {sentimentLabel}
                      </p>
                      <p className="mt-1 text-sm text-secondary">
                        Probabilidade de fechamento:{' '}
                        <strong className="text-primary">{sales.closingProbability}%</strong>
                      </p>
                    </div>
                  </div>
                  {insights.executiveContext && (
                    <p className="mt-4 text-sm text-secondary bg-neutral-lighter rounded-lg p-3 leading-relaxed">
                      {insights.executiveContext}
                    </p>
                  )}
                </Card>
              );
            })()}

            {/* Card 2: Scorecard por framework */}
            {(() => {
              const insights = meeting.insights!;
              const framework = getFramework(insights);

              // BANT scorecard
              if (framework === 'bant') {
                const bant = (insights as BantInsights).bantScore;
                if (!bant) return null;
                return (
                  <Card className="p-5">
                    <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Scorecard BANT
                    </h2>
                    <div className="space-y-3">
                      {([
                        { key: 'budget', label: 'Budget', color: '#22c55e' },
                        { key: 'authority', label: 'Authority', color: '#3b82f6' },
                        { key: 'need', label: 'Need', color: '#f59e0b' },
                        { key: 'timeline', label: 'Timeline', color: '#a855f7' },
                      ] as const).map(({ key, label, color }) => {
                        const dim = bant[key];
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{label}</span>
                              <span className="text-xs font-bold" style={{ color }}>{dim.score}/10</span>
                            </div>
                            <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden mb-1">
                              <div className="h-full rounded-full transition-all" style={{ width: `${dim.score * 10}%`, backgroundColor: color }} />
                            </div>
                            <p className="text-xs text-secondary leading-snug">{dim.evidence}</p>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              }

              // SPIN scorecard
              if (framework === 'spin') {
                const spin = (insights as SpinInsights).spinScore;
                if (!spin) return null;
                return (
                  <Card className="p-5">
                    <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Scorecard SPIN
                    </h2>
                    <div className="space-y-3">
                      {([
                        { key: 'situation', label: 'Situation', color: '#22c55e' },
                        { key: 'problem', label: 'Problem', color: '#3b82f6' },
                        { key: 'implication', label: 'Implication', color: '#f59e0b' },
                        { key: 'needPayoff', label: 'Need-payoff', color: '#a855f7' },
                      ] as const).map(({ key, label, color }) => {
                        const dim = spin[key];
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{label}</span>
                              <span className="text-xs font-bold" style={{ color }}>{dim.score}/10</span>
                            </div>
                            <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden mb-1">
                              <div className="h-full rounded-full transition-all" style={{ width: `${dim.score * 10}%`, backgroundColor: color }} />
                            </div>
                            <p className="text-xs text-secondary leading-snug">{dim.evidence}</p>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              }

              // CS indicadores
              const cs = insights as CsInsights;
              return (
                <Card className="p-5">
                  <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
                    <Smile className="h-5 w-5" />
                    Indicadores CS
                  </h2>
                  <div className="space-y-4">
                    {/* Satisfaction */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wider text-secondary">Satisfação</span>
                        <span className="text-xs font-bold text-primary">{cs.satisfactionScore ?? '–'}/10</span>
                      </div>
                      <div className="h-2 rounded-full bg-neutral-lighter overflow-hidden">
                        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((cs.satisfactionScore ?? 0) / 10) * 100}%` }} />
                      </div>
                    </div>

                    {/* Churn risk evidence */}
                    {cs.churnRiskEvidence && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-secondary mb-1">
                          Evidência do risco de churn
                        </p>
                        <p className="text-xs text-secondary bg-neutral-lighter rounded-lg p-2.5 leading-relaxed">
                          {cs.churnRiskEvidence}
                        </p>
                      </div>
                    )}

                    {/* Escalation flags */}
                    {cs.escalationFlags && cs.escalationFlags.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-secondary mb-2 flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Momentos críticos ({cs.escalationFlags.length})
                        </p>
                        <ul className="space-y-1.5">
                          {cs.escalationFlags.map((flag, i) => {
                            const sevColor = flag.severity === 'high' ? '#ef4444' : flag.severity === 'medium' ? '#f59e0b' : '#22c55e';
                            return (
                              <li key={i} className="flex items-start gap-2 text-xs text-secondary">
                                <span
                                  className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: sevColor }}
                                />
                                <span className="leading-snug">{flag.description}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })()}

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
            meetingId={id!}
            suggestions={meeting.insights!.followUpSuggestions}
            emailLoading={emailLoading}
            onGenerateEmail={generateEmail}
            copiedIndex={copiedSuggestionIndex}
            onCopy={copySuggestion}
            contactPhone={contactPhone}
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-headline-2 text-primary flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Transcrição
              <span className="ml-3 text-xs font-normal text-secondary">
                {segments.length} segmento{segments.length !== 1 ? 's' : ''}
              </span>
            </h2>
            {segments.length > 0 && (
              <button
                onClick={() => {
                  const transcriptText = segments
                    .map(seg => `[${formatSeconds(seg.start_seconds)}] ${seg.speaker ? seg.speaker + ': ' : ''}${seg.text}`)
                    .join('\n\n');
                  
                  const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `transcricao-${meeting?.title?.replace(/[^a-z0-9]/gi, '-').toLowerCase() || id}.txt`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#2D5A27] bg-[#2D5A27]/5 hover:bg-[#2D5A27]/10 rounded-lg transition-colors"
                title="Exportar transcrição em TXT"
              >
                <Download size={14} />
                Exportar TXT
              </button>
            )}
          </div>
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
                  <div className="flex-1">
                    {seg.speaker && (
                      <span className="text-xs font-semibold text-primary mb-1 block">
                        {seg.speaker}
                      </span>
                    )}
                    <p className="text-sm text-secondary leading-relaxed">{seg.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Botão flutuante de chat - só aparece se houver transcrição */}
      {meeting && meeting.transcript && meeting.transcript.trim().length > 0 && (
        <div className="fixed bottom-8 right-8 z-30">
          {/* Badge "NOVO" */}
          <div className="absolute -top-1 -right-1 bg-[#FFD700] text-[#1a1a1a] text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md uppercase tracking-wide">
            NOVO
          </div>
          
          {/* Tooltip informativo */}
          <div className="absolute bottom-full right-0 mb-3 w-56 bg-[#2D5A27] text-white text-xs px-4 py-3 rounded-xl shadow-xl opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
            <div className="font-semibold mb-1">💡 Nova Feature: Chat de IA</div>
            <div className="text-[10px] leading-relaxed opacity-90">
              Faça perguntas sobre esta reunião e receba insights instantâneos!
            </div>
            <div className="absolute top-full right-6 -mt-1">
              <div className="w-2 h-2 bg-[#2D5A27] transform rotate-45"></div>
            </div>
          </div>
          
          <button
            onClick={() => setIsChatOpen(true)}
            className="w-14 h-14 bg-[#2D5A27] text-white rounded-full shadow-lg hover:bg-[#234520] transition-all hover:scale-110 flex items-center justify-center"
            title="Abrir Chat de IA"
          >
            <MessageCircle className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Painel de Chat */}
      {meeting && id && authToken && (
        <MeetingChatPanel
          meetingId={id}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          apiUrl={apiUrl}
          authToken={authToken}
        />
      )}
    </MainLayout>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, User, Mail, Calendar, Clock, FileText, ExternalLink, Package, MessageSquare, Star, MailOpen, Maximize2, X, Award } from 'lucide-react';
import { formatDate, formatTime } from '../lib/dateUtils';

interface Transcricao {
  id: number;
  created_at: string;
  id_drive: string | null;
  responsavel: string | null;
  'r:agente1': string | null;
  'r:agente2': string | null;
  'r:agente3': string | null;
  'r:agente4': string | null;
  status: boolean | null;
  email_lead: string | null;
}

// Tenta parsear JSON, retorna null se falhar
function tryParseJSON(text: string | null): any {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Renderiza texto com markdown simples (**negrito**, listas numeradas, bullets)
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} className="h-3" />;

    // Substitui **texto** por negrito
    const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold text-primary">{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    // Linha de título numerada (ex: "1. **Resumo...")
    if (/^\d+\.\s/.test(trimmed)) {
      return <p key={i} className="mt-4 mb-1 text-sm font-semibold text-primary">{rendered}</p>;
    }
    // Bullet com *
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      return <p key={i} className="pl-4 text-sm text-secondary before:content-['•'] before:mr-2 before:text-primary">{rendered}</p>;
    }
    return <p key={i} className="text-sm text-secondary leading-relaxed">{rendered}</p>;
  });
}

// Renderiza conteúdo do Agente 1 (JSON estruturado)
function Agente1Content({ text }: { text: string }) {
  const json = tryParseJSON(text);
  if (!json) return <div className="text-sm text-secondary whitespace-pre-wrap">{text}</div>;

  const info = json.meetingInfo || {};
  const participants: any[] = json.participants || [];
  const companies: string[] = json.otherCompaniesInvolved || [];
  const reasons: string[] = json.summaryReasons || [];

  return (
    <div className="space-y-4 text-sm">
      {(info.title || info.date) && (
        <div className="rounded-lg bg-neutral-lighter p-3 space-y-1">
          {info.title && <p><span className="font-semibold text-primary">Título: </span><span className="text-secondary">{info.title}</span></p>}
          {info.date && <p><span className="font-semibold text-primary">Data: </span><span className="text-secondary">{info.date}</span></p>}
        </div>
      )}
      {participants.length > 0 && (
        <div>
          <p className="font-semibold text-primary mb-2">Participantes</p>
          <div className="space-y-1">
            {participants.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-neutral-lighter px-3 py-2">
                <User className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-secondary">{p.name}{p.email && p.email !== 'Não informado' ? ` — ${p.email}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {companies.length > 0 && (
        <div>
          <p className="font-semibold text-primary mb-2">Empresas Envolvidas</p>
          <div className="flex flex-wrap gap-2">
            {companies.map((c: string, i: number) => (
              <span key={i} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{c}</span>
            ))}
          </div>
        </div>
      )}
      {reasons.length > 0 && (
        <div>
          <p className="font-semibold text-primary mb-2">Pontos Relevantes</p>
          <ul className="space-y-1">
            {reasons.map((r: string, i: number) => (
              <li key={i} className="flex gap-2 text-secondary"><span className="text-primary font-bold">•</span>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Preview de e-mail estilizado para Agente 4
function EmailPreview({ text, transcricao }: { text: string; transcricao: Transcricao }) {
  const json = tryParseJSON(text);
  const agente1Json = tryParseJSON(transcricao['r:agente1']);
  const meetingTitle = json?.titulo_reuniao || agente1Json?.meetingInfo?.title || `Transcrição #${transcricao.id}`;
  const meetScore = json?.meet_score || null;
  const resumo = json?.resumo_executivo || null;
  const decisoes: string[] = json?.principais_decisoes || [];
  const analiseVendedor = json?.analise_vendedor || null;
  const proximosPassos = json?.proximos_passos_curto || null;
  const dataReuniaoFmt = new Date(transcricao.created_at).toLocaleDateString('pt-BR');

  // Se não tem JSON com campos de email, renderiza como markdown
  if (!json || (!resumo && !meetScore)) {
    return <div className="space-y-1">{renderMarkdown(text)}</div>;
  }

  const scoreNum = meetScore ? parseFloat(String(meetScore).replace('/10', '').replace(',', '.').trim()) : null;

  return (
    <div className="rounded-xl overflow-hidden border border-neutral-light shadow-sm" style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>
      {/* Header — fundo branco + borda inferior #FFD700 */}
      <div className="bg-white px-6 py-5 text-center" style={{ borderBottom: '5px solid #FFD700' }}>
        <img src="/lemon.meet.png" alt="Lemon.meet" style={{ maxWidth: 80, height: 'auto', marginBottom: 10, display: 'inline-block' }} />
        <h3 className="text-lg font-bold mt-0 mb-0" style={{ color: '#2D5A27' }}>{meetingTitle}</h3>
        <p className="text-xs mt-1 mb-0" style={{ color: '#666' }}>Diagnóstico da Meet em: {dataReuniaoFmt}</p>
      </div>

      {/* Score box */}
      {scoreNum !== null && (
        <div className="px-6 py-6 text-center" style={{ backgroundColor: '#fcfdf3', borderBottom: '1px solid #eee' }}>
          <span className="block mb-3" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: '#2D5A27', opacity: 0.9 }}>
            Diagnóstico Meet Score
          </span>
          {/* Círculo */}
          <div className="mx-auto mb-3" style={{ width: 90, height: 90, background: '#ffffff', border: '4px solid #FFD700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#FFD700', lineHeight: 1 }}>
              {scoreNum}<span style={{ fontSize: 14, color: '#2D5A27', fontWeight: 'normal', verticalAlign: 'super' }}>/10</span>
            </span>
          </div>
          {/* Barra */}
          <div className="mx-auto" style={{ background: 'rgba(0,0,0,0.08)', height: 10, borderRadius: 5, width: '70%', overflow: 'hidden' }}>
            <div style={{ background: '#FFD700', height: '100%', borderRadius: 5, width: `${scoreNum * 10}%` }} />
          </div>
          {/* Lead badge */}
          {transcricao.email_lead && (
            <span className="inline-block mt-3" style={{ background: '#fffde7', color: '#2D5A27', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, border: '1px solid #ffe082' }}>
              Lead Atribuído: {transcricao.email_lead}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="bg-white px-6 py-5 space-y-5">
        {resumo && (
          <div>
            <p className="font-bold uppercase" style={{ color: '#2D5A27', borderLeft: '4px solid #4CAF50', paddingLeft: 12, fontSize: 14, marginBottom: 8 }}>Resumo Executivo</p>
            <div className="rounded-lg p-4 text-sm whitespace-pre-line" style={{ background: '#fafafa', border: '1px solid #eee', color: '#444' }}>{resumo}</div>
          </div>
        )}
        {decisoes.length > 0 && (
          <div>
            <p className="font-bold uppercase" style={{ color: '#2D5A27', borderLeft: '4px solid #4CAF50', paddingLeft: 12, fontSize: 14, marginBottom: 8 }}>Principais Decisões</p>
            <ul className="pl-5 space-y-2">
              {decisoes.map((d, i) => (
                <li key={i} className="text-sm" style={{ color: '#444' }}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        {analiseVendedor && (
          <div>
            <p className="font-bold uppercase" style={{ color: '#2D5A27', borderLeft: '4px solid #4CAF50', paddingLeft: 12, fontSize: 14, marginBottom: 8 }}>Análise de Saúde do Deal</p>
            <div className="rounded-lg p-4 text-sm whitespace-pre-line" style={{ background: '#fafafa', border: '1px solid #eee', borderLeft: '3px solid #2D5A27', color: '#444' }}>{analiseVendedor}</div>
          </div>
        )}
        {proximosPassos && (
          <div>
            <p className="font-bold uppercase" style={{ color: '#2D5A27', borderLeft: '4px solid #4CAF50', paddingLeft: 12, fontSize: 14, marginBottom: 8 }}>Ações Imediatas</p>
            <div className="rounded-lg p-4 text-sm whitespace-pre-line font-medium" style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', color: '#1b5e20' }}>{proximosPassos}</div>
          </div>
        )}
        {/* Footer */}
        <div className="text-center pt-3" style={{ borderTop: '1px solid #eee', fontSize: 11, color: '#666' }}>
          {transcricao.responsavel && (
            <p>Responsável pelo Deal: <span className="font-bold" style={{ color: '#2D5A27' }}>{transcricao.responsavel}</span></p>
          )}
          <p className="mt-1">Relatório gerado automaticamente através da Lemon.AI</p>
        </div>
      </div>
    </div>
  );
}

export function TranscricaoDetalhesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [transcricao, setTranscricao] = useState<Transcricao | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  // Busca dados da transcrição
  useEffect(() => {
    if (!id) return;

    const fetchTranscricao = async () => {
      setIsLoading(true);

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/transcricoes/${id}`
        );

        if (!response.ok) {
          console.error('Erro ao buscar transcrição');
          navigate('/dashboard');
          return;
        }

        const data = await response.json();
        setTranscricao(data.transcricao);
      } catch (error) {
        console.error('Erro:', error);
        navigate('/dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTranscricao();
  }, [id, navigate]);

  const handleOpenDrive = () => {
    if (transcricao?.id_drive) {
      window.open(`https://drive.google.com/file/d/${transcricao.id_drive}/view`, '_blank');
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
        </div>
      </MainLayout>
    );
  }

  if (!transcricao) {
    return (
      <MainLayout>
        <div className="text-center">
          <h2 className="text-headline-1 text-primary">
            Transcrição não encontrada
          </h2>
          <Button onClick={() => navigate('/dashboard')} className="mt-4">
            Voltar ao Dashboard
          </Button>
        </div>
      </MainLayout>
    );
  }

  const getStatusBadge = (status: boolean | null) => {
    if (status === null) {
      return <Badge variant="secondary">Indefinido</Badge>;
    }
    return status ? (
      <Badge variant="success">Ativa</Badge>
    ) : (
      <Badge variant="secondary">Inativa</Badge>
    );
  };

  // Extrai nota do Agente 3 (ex: "Nota da Reunião: 6/10")
  const extractMeetScore = (): string | null => {
    const text = transcricao['r:agente3'] || transcricao['r:agente4'];
    if (!text) return null;
    // Tenta do agente 4 (JSON)
    const json4 = tryParseJSON(transcricao['r:agente4']);
    if (json4?.meet_score) return String(json4.meet_score).includes('/') ? String(json4.meet_score) : `${json4.meet_score}/10`;
    // Tenta do agente 3 (markdown)
    const match = (transcricao['r:agente3'] || '').match(/[Nn]ota.*?[:\s]+([0-9]+(?:[.,][0-9]+)?\s*\/\s*10)/i);
    if (match) return match[1].trim();
    return null;
  };

  const meetScore = extractMeetScore();

  const getScoreColor = (score: string): string => {
    const num = parseFloat(score.replace(',', '.'));
    if (num >= 8) return 'bg-success/10 text-success border border-success/20';
    if (num >= 5) return 'bg-accent/20 text-primary border border-accent/40';
    return 'bg-danger/10 text-danger border border-danger/20';
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => navigate('/dashboard')}
              variant="secondary"
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <div>
              <h1 className="text-headline-1 text-primary">
                Transcrição #{transcricao.id}
              </h1>
              <p className="mt-1 text-body-large text-secondary dark:text-gray-400">
                {formatDate(transcricao.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')} às{' '}
                {formatTime(transcricao.created_at)}
              </p>
            </div>
          </div>
          {getStatusBadge(transcricao.status)}
        </div>

        {/* Informações Principais */}
        <Card className="p-6">
          <h2 className="mb-4 text-headline-2 text-primary">
            Informações Gerais
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Responsável */}
            {transcricao.responsavel && (
              <div className="flex items-start gap-3">
                <User className="mt-0.5 h-5 w-5 text-neutral-mid" />
                <div>
                  <p className="text-body-small font-medium text-secondary dark:text-gray-400">
                    Responsável
                  </p>
                  <p className="mt-1 text-body-large text-primary dark:text-white">
                    {transcricao.responsavel}
                  </p>
                </div>
              </div>
            )}

            {/* Email do Lead */}
            {transcricao.email_lead && (
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 text-neutral-mid" />
                <div>
                  <p className="text-body-small font-medium text-secondary dark:text-gray-400">
                    Email do Lead
                  </p>
                  <p className="mt-1 text-body-large text-primary dark:text-white">
                    {transcricao.email_lead}
                  </p>
                </div>
              </div>
            )}

            {/* Data de Criação */}
            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-5 w-5 text-neutral-mid" />
              <div>
                <p className="text-body-small font-medium text-secondary dark:text-gray-400">
                  Data de Criação
                </p>
                <p className="mt-1 text-body-large text-primary dark:text-white">
                  {formatDate(transcricao.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}
                </p>
              </div>
            </div>

            {/* Horário */}
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 text-neutral-mid" />
              <div>
                <p className="text-body-small font-medium text-secondary dark:text-gray-400">
                  Horário
                </p>
                <p className="mt-1 text-body-large text-primary dark:text-white">
                  {formatTime(transcricao.created_at)}
                </p>
              </div>
            </div>

            {/* ID Drive */}
            {transcricao.id_drive && (
              <div className="flex items-start gap-3 md:col-span-2">
                <FileText className="mt-0.5 h-5 w-5 text-neutral-mid" />
                <div className="flex-1">
                  <p className="text-body-small font-medium text-secondary dark:text-gray-400">
                    Arquivo no Google Drive
                  </p>
                  <div className="mt-2">
                    <Button
                      onClick={handleOpenDrive}
                      variant="secondary"
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir no Google Drive
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Meet Score badge */}
            {meetScore && (
              <div className="flex items-start gap-3 md:col-span-2">
                <Award className="mt-0.5 h-5 w-5 text-neutral-mid" />
                <div>
                  <p className="text-body-small font-medium text-secondary">Nota da Reunião</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-4 py-1 text-base font-bold ${getScoreColor(meetScore)}`}>
                      ⭐ {meetScore}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Informações dos Agentes */}
        {(transcricao['r:agente1'] || transcricao['r:agente2'] ||
          transcricao['r:agente3'] || transcricao['r:agente4']) && (
          <div className="space-y-4">
            <h2 className="text-headline-2 text-primary">Informações dos Agentes</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Agente 1 */}
              {transcricao['r:agente1'] && (
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-primary text-sm">Agente 1</h3>
                      <span className="inline-block mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Extração de conteúdo importante
                      </span>
                    </div>
                  </div>
                  <Agente1Content text={transcricao['r:agente1']} />
                </Card>
              )}

              {/* Agente 2 */}
              {transcricao['r:agente2'] && (
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-primary text-sm">Agente 2</h3>
                      <span className="inline-block mt-0.5 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-primary">
                        Gerador de Follow-up
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">{renderMarkdown(transcricao['r:agente2'])}</div>
                </Card>
              )}

              {/* Agente 3 */}
              {transcricao['r:agente3'] && (
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
                      <Star className="h-4 w-4 text-success" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-primary text-sm">Agente 3</h3>
                      <span className="inline-block mt-0.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        Avaliação e Meet Score
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">{renderMarkdown(transcricao['r:agente3'])}</div>
                </Card>
              )}

              {/* Agente 4 — compacto no grid, com botão expandir */}
              {transcricao['r:agente4'] && (() => {
                const json = tryParseJSON(transcricao['r:agente4']);
                const agente1Json = tryParseJSON(transcricao['r:agente1']);
                const meetingTitle = json?.titulo_reuniao || agente1Json?.meetingInfo?.title || `Transcrição #${transcricao.id}`;
                const scoreNum = json?.meet_score ? parseInt(String(json.meet_score).replace('/10', '').trim()) : null;
                const resumo = json?.resumo_executivo || null;
                const decisoes: string[] = json?.principais_decisoes || [];
                const analiseVendedor = json?.analise_vendedor || null;
                const proximosPassos = json?.proximos_passos_curto || null;

                return (
                  <Card className="p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <MailOpen className="h-4 w-4 text-[#182848]" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-primary text-sm">Agente 4</h3>
                          <span className="inline-block mt-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#182848]">
                            Resumo para E-mail
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => setEmailModalOpen(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-neutral-light px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary hover:border-primary transition-all"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        Expandir
                      </button>
                    </div>

                    {/* Preview compacto */}
                    <div className="rounded-xl overflow-hidden border border-neutral-light flex-1">
                      <div className="bg-[#182848] px-4 py-3 text-center">
                        <p className="text-white font-semibold text-sm truncate">{meetingTitle}</p>
                        {transcricao.email_lead && (
                          <p className="text-white/60 text-xs mt-0.5 truncate">{transcricao.email_lead}</p>
                        )}
                      </div>
                      {scoreNum !== null && (
                        <div className="bg-[#1e3a6e] px-4 py-3 text-center">
                          <span className="block text-[9px] uppercase tracking-wider text-white/60 mb-1">Meet Score</span>
                          <span className="block text-3xl font-extrabold text-[#FF914D] leading-none">{scoreNum}/10</span>
                          <div className="mx-auto mt-2 w-32 h-2 rounded-full bg-white/20 overflow-hidden">
                            <div className="h-full rounded-full bg-[#FF914D]" style={{ width: `${scoreNum * 10}%` }} />
                          </div>
                        </div>
                      )}
                      {resumo && (
                        <div className="bg-white px-4 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#182848] border-l-4 border-[#FF914D] pl-2 mb-1.5">Resumo Executivo</p>
                          <p className="text-xs text-secondary whitespace-pre-line">{resumo}</p>
                        </div>
                      )}
                      {decisoes.length > 0 && (
                        <div className="bg-white px-4 py-3 border-t border-neutral-light">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#182848] border-l-4 border-[#FF914D] pl-2 mb-1.5">Principais Decisões</p>
                          <ul className="space-y-1">
                            {decisoes.map((d, i) => (
                              <li key={i} className="flex gap-1.5 text-xs text-secondary"><span className="text-[#FF914D] font-bold flex-shrink-0">•</span>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analiseVendedor && (
                        <div className="bg-blue-50/50 px-4 py-3 border-t border-neutral-light">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#182848] border-l-4 border-[#FF914D] pl-2 mb-1.5">Análise de Saúde do Deal</p>
                          <p className="text-xs text-secondary whitespace-pre-line">{analiseVendedor}</p>
                        </div>
                      )}
                      {proximosPassos && (
                        <div className="bg-yellow-50 px-4 py-3 border-t border-yellow-200">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#182848] border-l-4 border-[#FF914D] pl-2 mb-1.5">Ações Imediatas</p>
                          <p className="text-xs text-secondary whitespace-pre-line">{proximosPassos}</p>
                        </div>
                      )}
                      {!json && (
                        <div className="bg-white px-4 py-3">
                          <div className="space-y-1">{renderMarkdown(transcricao['r:agente4']!)}</div>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })()}
            </div>
          </div>
        )}

        {/* Modal E-mail Expandido */}
        {emailModalOpen && transcricao['r:agente4'] && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEmailModalOpen(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-20 flex items-center justify-between bg-white px-5 py-3 border-b border-neutral-light">
                <span className="font-semibold text-primary text-sm">Visualizar E-mail — Agente 4</span>
                <button
                  onClick={() => setEmailModalOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-mid hover:text-primary hover:bg-neutral-lighter transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <EmailPreview text={transcricao['r:agente4']} transcricao={transcricao} />
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

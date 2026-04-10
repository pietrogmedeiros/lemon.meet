import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import { FileText, Clock, Calendar, User, Mail, ChevronRight } from 'lucide-react';
import { formatDate, formatTime } from '@/lib';

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

export function MeetingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [transcricoes, setTranscricoes] = useState<Transcricao[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTranscricoes = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/transcricoes?limit=100`
        );
        if (response.ok) {
          const data = await response.json();
          setTranscricoes(data.transcricoes || []);
        }
      } catch (error) {
        console.error('Erro ao buscar transcrições:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTranscricoes();
  }, []);

  const getStatusBadge = (status: boolean | null) => {
    if (status === null) return <Badge variant="secondary">Indefinido</Badge>;
    return status ? (
      <Badge variant="success">Ativa</Badge>
    ) : (
      <Badge variant="secondary">Inativa</Badge>
    );
  };

  const getAgentes = (t: Transcricao) => {
    return [t['r:agente1'], t['r:agente2'], t['r:agente3'], t['r:agente4']].filter(Boolean);
  };

  const extractMeetScore = (transcricao: Transcricao): string | null => {
    try {
      const json4 = transcricao['r:agente4'] ? JSON.parse(transcricao['r:agente4']) : null;
      if (json4?.meet_score) return String(json4.meet_score).includes('/') ? String(json4.meet_score) : `${json4.meet_score}/10`;
    } catch {}
    const match = (transcricao['r:agente3'] || '').match(/[Nn]ota.*?[:\s]+([0-9]+(?:[.,][0-9]+)?\s*\/\s*10)/i);
    return match ? match[1].trim() : null;
  };

  const getScoreBadgeStyle = (score: string): string => {
    const num = parseFloat(score.replace(',', '.'));
    if (num >= 8) return 'bg-success/10 text-success border border-success/30 font-bold';
    if (num >= 5) return 'bg-amber-50 text-amber-700 border border-amber-200 font-bold';
    return 'bg-danger/10 text-danger border border-danger/20 font-bold';
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-headline-1 text-primary">
            {t('nav.meetings', 'Reuniões')}
          </h1>
          <p className="mt-2 text-body-large text-secondary">
            {t('meetings.subtitle', 'Acompanhe todas as suas reuniões transcritas e insights gerados')}
          </p>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
            <p className="mt-4 text-body-large text-secondary">Carregando reuniões...</p>
          </div>
        ) : transcricoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="h-12 w-12 text-neutral-mid" />
            <h3 className="mt-4 text-headline-2 text-primary">Nenhuma reunião encontrada</h3>
            <p className="mt-2 text-body-large text-secondary">Aguarde novos dados serem adicionados</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {transcricoes.map((transcricao) => (
              <Card
                key={transcricao.id}
                onClick={() => navigate(`/meetings/${transcricao.id}`)}
                className="p-5 cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 group"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-headline-2 text-primary leading-tight">
                        Transcrição #{transcricao.id}
                      </h3>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-neutral-mid group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                </div>

                {/* Status + Score */}
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  {getStatusBadge(transcricao.status)}
                  {(() => {
                    const score = extractMeetScore(transcricao);
                    return score ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${getScoreBadgeStyle(score)}`}>
                        ⭐ {score}
                      </span>
                    ) : null;
                  })()}
                </div>

                {/* Info */}
                <div className="space-y-1.5 text-body-small text-secondary">
                  {transcricao.responsavel && (
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{transcricao.responsavel}</span>
                    </div>
                  )}
                  {transcricao.email_lead && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{transcricao.email_lead}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{formatDate(transcricao.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{formatTime(transcricao.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Agentes */}
                {getAgentes(transcricao).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-light flex flex-wrap gap-1.5">
                    {getAgentes(transcricao).map((_, i) => (
                      <Badge key={i} variant="secondary">Agente {i + 1}</Badge>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

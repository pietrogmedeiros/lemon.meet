import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout';
import { Card, Button, Badge } from '@/components/ui';
import { FileText, Clock, Calendar, TrendingUp, User, Mail } from 'lucide-react';
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

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [transcricoes, setTranscricoes] = useState<Transcricao[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    ativas: 0,
    inativas: 0
  });

  // Busca transcrições da API
  useEffect(() => {
    fetchTranscricoes();
    fetchStats();
  }, []);

  const fetchTranscricoes = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/transcricoes?limit=50`
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

  const fetchStats = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/transcricoes/api/stats`
      );

      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Erro ao buscar estatísticas:', error);
    }
  };

  const handleTranscricaoClick = (transcricao: Transcricao) => {
    navigate(`/meetings/${transcricao.id}`);
  };

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
            {t('dashboard.title', 'Dashboard')}
          </h1>
          <p className="mt-2 text-body-large text-secondary dark:text-gray-400">
            {t('dashboard.subtitle', 'Visualize e gerencie suas transcrições')}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">
                  Total de Transcrições
                </p>
                <p className="mt-2 text-3xl font-bold text-primary">
                  {stats.total}
                </p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <FileText className="h-6 w-6 text-primary" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">
                  Transcrições Ativas
                </p>
                <p className="mt-2 text-3xl font-bold text-primary">
                  {stats.ativas}
                </p>
              </div>
              <div className="rounded-full bg-success/10 p-3">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-small font-medium text-secondary">
                  Transcrições Inativas
                </p>
                <p className="mt-2 text-3xl font-bold text-primary">
                  {stats.inativas}
                </p>
              </div>
              <div className="rounded-full bg-neutral-light p-3">
                <Clock className="h-6 w-6 text-neutral-mid" />
              </div>
            </div>
          </Card>
        </div>

        {/* Transcrições List */}
        <Card>
          <div className="border-b border-neutral-light dark:border-gray-700 p-6">
            <h2 className="text-headline-2 text-primary">
              Transcrições Recentes
            </h2>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
              <p className="mt-4 text-body-large text-secondary">
                Carregando transcrições...
              </p>
            </div>
          ) : transcricoes.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-neutral-mid" />
              <h3 className="mt-4 text-headline-2 text-primary">
                Nenhuma transcrição encontrada
              </h3>
              <p className="mt-2 text-body-large text-secondary">
                Aguarde novos dados serem adicionados à tabela
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-light dark:divide-gray-700">
              {transcricoes.map((transcricao) => (
                <div
                  key={transcricao.id}
                  onClick={() => handleTranscricaoClick(transcricao)}
                  className="cursor-pointer p-6 transition-colors hover:bg-neutral-light/30 dark:hover:bg-gray-700/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-headline-2 text-primary">
                          Transcrição #{transcricao.id}
                        </h3>
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

                      <div className="mt-2 grid grid-cols-1 gap-2 text-body-small text-secondary dark:text-gray-400 sm:grid-cols-2 lg:grid-cols-4">
                        {transcricao.responsavel && (
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            {transcricao.responsavel}
                          </div>
                        )}
                        {transcricao.email_lead && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            {transcricao.email_lead}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {formatDate(transcricao.created_at, i18n.language as 'pt-BR' | 'en-US' | 'es')}
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {formatTime(transcricao.created_at)}
                        </div>
                      </div>

                      {/* Agentes */}
                      {(transcricao['r:agente1'] || transcricao['r:agente2'] || 
                        transcricao['r:agente3'] || transcricao['r:agente4']) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {transcricao['r:agente1'] && (
                            <Badge variant="secondary">Agente 1</Badge>
                          )}
                          {transcricao['r:agente2'] && (
                            <Badge variant="secondary">Agente 2</Badge>
                          )}
                          {transcricao['r:agente3'] && (
                            <Badge variant="secondary">Agente 3</Badge>
                          )}
                          {transcricao['r:agente4'] && (
                            <Badge variant="secondary">Agente 4</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </MainLayout>
  );
}

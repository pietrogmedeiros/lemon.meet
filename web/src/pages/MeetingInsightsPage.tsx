import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ArrowLeft, TrendingUp, Target, Lightbulb, CheckCircle, Clock, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDate, formatTime } from '../lib/dateUtils';

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
  meet_link: string;
  status: string;
  started_at: string;
  ended_at?: string;
  transcript: string;
  insights: MeetingInsights | null;
  created_at: string;
}

export function MeetingInsightsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [insights, setInsights] = useState<MeetingInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Busca dados da reunião
  useEffect(() => {
    if (!id) return;

    const fetchMeeting = async () => {
      setIsLoading(true);

      try {
        const { data, error } = await supabase
          .from('meetings')
          .select('*')
          .eq('id', id)
          .single();

        if (error || !data) {
          console.error('Error fetching meeting:', error);
          navigate('/dashboard');
          return;
        }

        setMeeting(data);
        setInsights(data.insights);
      } catch (error) {
        console.error('Error:', error);
        navigate('/dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMeeting();
  }, [id, navigate]);

  // Gera insights se não existirem
  const handleGenerateInsights = async () => {
    if (!id) return;

    setIsGenerating(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/meetings/${id}/insights?generate=true`,
        {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setInsights(data.insights);
        if (meeting) {
          setMeeting({ ...meeting, insights: data.insights });
        }
      } else {
        alert(t('insights.error.generationFailed'));
      }
    } catch (error) {
      console.error('Error generating insights:', error);
      alert(t('insights.error.generationFailed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'text-green-500';
      case 'negative': return 'text-red-500';
      default: return 'text-yellow-500';
    }
  };

  const getQualityColor = (quality: number) => {
    if (quality >= 7) return 'text-green-500';
    if (quality >= 4) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getProbabilityColor = (probability: number) => {
    if (probability >= 70) return 'text-green-500';
    if (probability >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-secondary">{t('common.loading')}</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!meeting) {
    return null;
  }

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('common.back')}
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-primary">
                {t('insights.title')}
              </h1>
              <p className="text-sm text-secondary mt-1">
                {formatDate(meeting.created_at, i18n.language as any)} • {formatTime(meeting.created_at, i18n.language as any)}
              </p>
            </div>
          </div>
          <Badge status={meeting.status as any} />
        </div>

        {/* Insights não gerados */}
        {!insights && (
          <Card>
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full mx-auto mb-4 flex items-center justify-center">
                <Lightbulb className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-primary mb-2">
                {t('insights.notGenerated')}
              </h3>
              <p className="text-secondary mb-6">
                {t('insights.notGeneratedHint')}
              </p>
              <Button
                onClick={handleGenerateInsights}
                disabled={isGenerating || !meeting.transcript}
              >
                {isGenerating ? t('insights.generating') : t('insights.generate')}
              </Button>
              {!meeting.transcript && (
                <p className="text-xs text-red-500 mt-2">
                  {t('insights.noTranscript')}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Insights gerados */}
        {insights && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Métricas principais */}
            <div className="lg:col-span-1 space-y-4">
              <Card>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-primary">{t('insights.metrics')}</h3>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wide mb-2">
                        {t('insights.sentiment')}
                      </p>
                      <p className={`text-lg font-bold ${getSentimentColor(insights.sentiment)}`}>
                        {t(`insights.sentiments.${insights.sentiment}`)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wide mb-2">
                        {t('insights.commercialQuality')}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className={`text-2xl font-bold ${getQualityColor(insights.commercialQuality)}`}>
                          {insights.commercialQuality}/10
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-secondary uppercase tracking-wide mb-2">
                        {t('insights.closingProbability')}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className={`text-2xl font-bold ${getProbabilityColor(insights.closingProbability)}`}>
                          {insights.closingProbability}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-primary">{t('insights.meetingInfo')}</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-secondary">{t('insights.date')}</span>
                      <span className="text-primary">{formatDate(meeting.created_at, i18n.language as any)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-secondary">{t('insights.time')}</span>
                      <span className="text-primary">{formatTime(meeting.started_at, i18n.language as any)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-secondary">{t('insights.words')}</span>
                      <span className="text-primary">
                        {meeting.transcript?.split(/\s+/).filter((w: string) => w.length > 0).length || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Contexto executivo e detalhes */}
            <div className="lg:col-span-2 space-y-6">
              {/* Contexto Executivo */}
              <Card>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-primary">{t('insights.executiveContext')}</h3>
                  </div>
                  <p className="text-primary leading-relaxed">
                    {insights.executiveContext}
                  </p>
                </div>
              </Card>

              {/* Tópicos-chave */}
              <Card>
                <div className="p-6">
                  <h3 className="font-semibold text-primary mb-3">{t('insights.keyTopics')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {insights.keyTopics.map((topic, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Itens de Ação */}
              <Card>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-primary">{t('insights.actionItems')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {insights.actionItems.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-primary">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0"></span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              {/* Follow-up */}
              <Card>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-primary">{t('insights.followUp')}</h3>
                  </div>
                  <ul className="space-y-2">
                    {insights.followUp.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-primary">
                        <span className="text-primary font-bold">{index + 1}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              {/* Transcrição completa */}
              <Card>
                <div className="p-6">
                  <h3 className="font-semibold text-primary mb-4">{t('insights.fullTranscript')}</h3>
                  <div className="bg-surface-container rounded-lg p-4 max-h-96 overflow-y-auto">
                    <p className="text-primary text-sm leading-relaxed whitespace-pre-wrap">
                      {meeting.transcript}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

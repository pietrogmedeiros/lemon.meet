import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { io, Socket } from 'socket.io-client';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ArrowLeft, StopCircle, Mic, Volume2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TranscriptChunk {
  text: string;
  timestamp: string;
  duration?: number;
  language?: string;
}

interface Meeting {
  id: string;
  meet_link: string;
  status: string;
  started_at: string;
}

export function ActiveMeetingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o final da transcrição
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Busca dados da reunião
  useEffect(() => {
    if (!id) return;

    const fetchMeeting = async () => {
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
      setTranscript(data.transcript || '');
    };

    fetchMeeting();
  }, [id, navigate]);

  // Conecta ao WebSocket
  useEffect(() => {
    if (!id) return;

    const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
      socket.emit('join-meeting', id);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket');
      setIsConnected(false);
    });

    // Escuta eventos de transcrição
    socket.on('transcript:chunk', (data: any) => {
      console.log('Received transcript chunk:', data);
      
      const newChunk: TranscriptChunk = {
        text: data.text,
        timestamp: data.timestamp,
        duration: data.duration,
        language: data.language
      };

      setChunks(prev => [...prev, newChunk]);
      setTranscript(prev => prev ? `${prev} ${data.text}` : data.text);
    });

    socket.on('transcript:update', (data: any) => {
      console.log('Transcript update:', data);
    });

    socket.on('transcript:complete', (data: any) => {
      console.log('Transcription complete:', data);
      // Poderia mostrar notificação ou redirecionar
    });

    socket.on('bot:left', (data: any) => {
      console.log('Bot left meeting:', data);
      setMeeting(prev => prev ? { ...prev, status: 'completed' } : null);
    });

    socketRef.current = socket;

    return () => {
      socket.emit('leave-meeting', id);
      socket.disconnect();
    };
  }, [id]);

  // Para a gravação
  const handleStopRecording = async () => {
    if (!id) return;

    setIsStopping(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/meetings/${id}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      });

      if (response.ok) {
        // Aguarda um pouco para garantir que a transcrição foi finalizada
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      } else {
        console.error('Error stopping recording');
        alert(t('meeting.error.stopFailed'));
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      alert(t('meeting.error.stopFailed'));
    } finally {
      setIsStopping(false);
    }
  };

  if (!meeting) {
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

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('common.back')}
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-primary">
                {t('meeting.activeTitle')}
              </h1>
              <p className="text-sm text-secondary mt-1">
                {meeting.meet_link}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={meeting.status as any} />
            <Button
              variant="danger"
              onClick={handleStopRecording}
              disabled={isStopping || meeting.status !== 'recording'}
            >
              <StopCircle className="w-4 h-4 mr-2" />
              {isStopping ? t('meeting.stopping') : t('meeting.stopRecording')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status e Informações */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-sm text-secondary">
                    {isConnected ? t('meeting.connected') : t('meeting.disconnected')}
                  </span>
                </div>

                <div>
                  <p className="text-xs text-secondary uppercase tracking-wide mb-1">
                    {t('meeting.startedAt')}
                  </p>
                  <p className="text-sm text-primary">
                    {new Date(meeting.started_at).toLocaleTimeString()}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-secondary uppercase tracking-wide mb-1">
                    {t('meeting.transcriptChunks')}
                  </p>
                  <p className="text-sm text-primary">
                    {chunks.length} {t('meeting.segments')}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-secondary uppercase tracking-wide mb-1">
                    {t('meeting.wordCount')}
                  </p>
                  <p className="text-sm text-primary">
                    {transcript.split(/\s+/).filter(w => w.length > 0).length} {t('meeting.words')}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Mic className="w-4 h-4 text-primary" />
                  <h3 className="font-medium text-primary">{t('meeting.audioStatus')}</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">{t('meeting.recording')}</span>
                    <span className={`font-medium ${meeting.status === 'recording' ? 'text-green-500' : 'text-secondary'}`}>
                      {meeting.status === 'recording' ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">{t('meeting.transcribing')}</span>
                    <span className={`font-medium ${chunks.length > 0 ? 'text-green-500' : 'text-secondary'}`}>
                      {chunks.length > 0 ? t('common.active') : t('common.waiting')}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Transcrição em Tempo Real */}
          <div className="lg:col-span-2">
            <Card>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Volume2 className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-semibold text-primary">
                    {t('meeting.liveTranscript')}
                  </h2>
                </div>
                
                <div className="bg-surface-container rounded-lg p-6 max-h-[600px] overflow-y-auto">
                  {transcript ? (
                    <div className="space-y-4">
                      <p className="text-primary leading-relaxed whitespace-pre-wrap">
                        {transcript}
                      </p>
                      <div ref={transcriptEndRef} />
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <div className="animate-pulse mb-4">
                        <div className="w-12 h-12 bg-primary/20 rounded-full mx-auto flex items-center justify-center">
                          <Mic className="w-6 h-6 text-primary" />
                        </div>
                      </div>
                      <p className="text-secondary">
                        {t('meeting.waitingForTranscript')}
                      </p>
                      <p className="text-xs text-secondary mt-2">
                        {t('meeting.transcriptHint')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

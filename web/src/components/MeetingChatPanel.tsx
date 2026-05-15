import { useState, useEffect, useRef } from 'react';
import { X, Send, MessageCircle, Loader, AlertCircle } from 'lucide-react';

interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

// Função para processar markdown básico (negrito, quebras de linha, etc)
function processMarkdown(text: string): string {
  if (!text) return '';
  
  return text
    // Converte **texto** em <strong>texto</strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Converte quebras de linha em <br>
    .replace(/\n/g, '<br>')
    // Preserva espaços múltiplos
    .replace(/  /g, '&nbsp;&nbsp;');
}

interface MeetingChatPanelProps {
  meetingId: string;
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  authToken: string;
}

export function MeetingChatPanel({ meetingId, isOpen, onClose, apiUrl, authToken }: MeetingChatPanelProps) {
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [remainingQuestions, setRemainingQuestions] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll para última mensagem
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chats]);

  // Carrega histórico de chat ao abrir
  useEffect(() => {
    if (isOpen && meetingId) {
      loadChatHistory();
    }
  }, [isOpen, meetingId]);

  // Focus no input ao abrir
  useEffect(() => {
    if (isOpen && !isLoading) {
      inputRef.current?.focus();
    }
  }, [isOpen, isLoading]);

  const loadChatHistory = async () => {
    setIsLoadingHistory(true);
    setError(null);
    
    try {
      const url = `${apiUrl}/api/meetings/${meetingId}/chat`;
      console.log('[MeetingChatPanel] Loading chat history from:', url);
      
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      console.log('[MeetingChatPanel] Response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('[MeetingChatPanel] Error response:', errorData);
        throw new Error(errorData.message || 'Erro ao carregar histórico');
      }

      const data = await res.json();
      setChats(data.chats || []);
      setRemainingQuestions(data.remainingQuestions ?? 10);
    } catch (err: any) {
      console.error('Error loading chat history:', err);
      setError('Erro ao carregar histórico de perguntas');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!question.trim() || isLoading) return;

    if (question.length > 500) {
      setError('Pergunta muito longa (máximo 500 caracteres)');
      return;
    }

    if (remainingQuestions <= 0) {
      setError('Você atingiu o limite de 10 perguntas por reunião nas últimas 24 horas');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `${apiUrl}/api/meetings/${meetingId}/chat`;
      console.log('[MeetingChatPanel] Sending question to:', url);
      console.log('[MeetingChatPanel] Question:', question.trim());
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ question: question.trim() }),
      });

      console.log('[MeetingChatPanel] Response status:', res.status);

      const data = await res.json();
      console.log('[MeetingChatPanel] Response data:', data);

      if (!res.ok) {
        throw new Error(data.message || 'Erro ao enviar pergunta');
      }

      // Adiciona nova mensagem ao histórico
      setChats(prev => [...prev, data.chat]);
      setRemainingQuestions(data.remainingQuestions ?? 0);
      setQuestion('');
      
    } catch (err: any) {
      console.error('Error sending question:', err);
      setError(err.message || 'Erro ao gerar resposta. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Painel lateral */}
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0] bg-[#F8F9FA]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-[#2D5A27]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[#333333]">Chat de IA</h2>
                <span className="text-[10px] text-[#999999] font-mono">v1.2.0</span>
              </div>
              <p className="text-xs text-[#666666]">
                {remainingQuestions} {remainingQuestions === 1 ? 'pergunta restante' : 'perguntas restantes'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#E0E0E0] flex items-center justify-center transition"
          >
            <X className="w-5 h-5 text-[#666666]" />
          </button>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 animate-spin text-[#2D5A27]" />
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#F5F5F5] flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-[#CCCCCC]" />
              </div>
              <p className="text-sm font-medium text-[#666666] mb-2">
                Nenhuma pergunta ainda
              </p>
              <p className="text-xs text-[#999999] max-w-xs">
                Faça perguntas sobre esta reunião para obter insights instantâneos da IA
              </p>
            </div>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className="space-y-3">
                {/* Pergunta do usuário */}
                <div className="flex justify-end">
                  <div className="bg-[#2D5A27] text-white px-4 py-3 rounded-2xl rounded-tr-sm max-w-[85%]">
                    <p className="text-sm whitespace-pre-wrap">{chat.question}</p>
                  </div>
                </div>

                {/* Resposta da IA */}
                <div className="flex justify-start">
                  <div className="bg-[#F5F5F5] text-[#333333] px-4 py-3 rounded-2xl rounded-tl-sm max-w-[85%]">
                    <div 
                      className="text-sm leading-relaxed [&_strong]:font-bold [&_strong]:text-[#1a1a1a]"
                      dangerouslySetInnerHTML={{ __html: processMarkdown(chat.answer) }}
                    />
                    <p className="text-xs text-[#999999] mt-2">
                      {new Date(chat.created_at).toLocaleTimeString('pt-BR', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-[#E0E0E0] bg-white">
          {error && (
            <div className="mb-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua pergunta sobre a reunião..."
              className="flex-1 px-4 py-3 border border-[#E0E0E0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
              rows={2}
              disabled={isLoading || remainingQuestions <= 0}
              maxLength={500}
            />
            <button
              type="submit"
              disabled={isLoading || !question.trim() || remainingQuestions <= 0}
              className="px-4 py-3 bg-[#2D5A27] text-white rounded-xl hover:bg-[#234520] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center self-end"
            >
              {isLoading ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>

          <div className="mt-2 flex items-center justify-between text-xs text-[#999999]">
            <span>Pressione Enter para enviar, Shift+Enter para nova linha</span>
            <span>{question.length}/500</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  );
}

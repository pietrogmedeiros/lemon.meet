import { useState, useEffect, useRef } from 'react';
import { X, Send, MessageCircle, Loader, AlertCircle, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * Token SEMPRE fresco. A prop `authToken` é capturada uma única vez na montagem
 * da página; numa aba aberta por mais de uma hora ela vence e o backend responde
 * 401 — só neste painel, porque o resto da página busca a sessão a cada request
 * (e o supabase-js renova sozinho). Mantém a prop como fallback.
 */
async function freshToken(fallback: string): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Mensagem de erro legível. O `authMiddleware` responde `{ error }` e as rotas
 * respondem `{ message }` — ler só um dos dois fazia toda falha de autenticação
 * virar "Erro ao enviar pergunta", sem o usuário saber que era só relogar.
 */
function errorMessage(status: number, body: any, fallback: string): string {
  if (status === 401) return 'Sua sessão expirou. Recarregue a página e tente novamente.';
  return body?.message || body?.error || fallback;
}

interface QuickAction {
  emoji: string;
  label: string;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { emoji: '📋', label: 'Resumir reunião', prompt: 'Faça um resumo executivo dessa reunião destacando os 3-5 pontos mais importantes, decisões tomadas e o que ficou pendente.' },
  { emoji: '✅', label: 'Próximos passos', prompt: 'Quais são os próximos passos concretos dessa reunião? Liste cada ação com responsável (se foi mencionado) e prazo (se foi mencionado).' },
  { emoji: '⚠️', label: 'Riscos e objeções', prompt: 'Quais riscos, objeções e sinais de alerta apareceram nessa reunião? Cite a evidência da transcrição pra cada um e sugira como mitigar.' },
  { emoji: '📧', label: 'Email de follow-up', prompt: 'Escreva um email de follow-up pronto pra enviar, em português brasileiro, referenciando pontos específicos discutidos e propondo os próximos passos. Inclua assunto.' },
  { emoji: '🎯', label: 'Por que pode não fechar?', prompt: 'Olhando essa reunião, quais são os fatores que podem fazer esse deal NÃO fechar? Seja brutalmente honesto e cite evidências da transcrição.' },
  { emoji: '👤', label: 'Quem é o decisor?', prompt: 'Quem foi identificado como decisor (ou potencial decisor) nessa reunião? Quem mais precisa estar envolvido na decisão? Cite evidências da fala.' },
];

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

const CHAT_WHATS_NEW_KEY = 'chat_ia_v2_whatsnew_seen';

export function MeetingChatPanel({ meetingId, isOpen, onClose, apiUrl, authToken }: MeetingChatPanelProps) {
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [remainingQuestions, setRemainingQuestions] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [showWhatsNew, setShowWhatsNew] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return !window.localStorage.getItem(CHAT_WHATS_NEW_KEY);
    } catch {
      return false;
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const dismissWhatsNew = () => {
    try {
      window.localStorage.setItem(CHAT_WHATS_NEW_KEY, new Date().toISOString());
    } catch {}
    setShowWhatsNew(false);
  };

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
          Authorization: `Bearer ${await freshToken(authToken)}`,
        },
      });

      console.log('[MeetingChatPanel] Response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('[MeetingChatPanel] Error response:', errorData);
        throw new Error(errorMessage(res.status, errorData, 'Erro ao carregar histórico'));
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
          Authorization: `Bearer ${await freshToken(authToken)}`,
        },
        body: JSON.stringify({ question: question.trim() }),
      });

      console.log('[MeetingChatPanel] Response status:', res.status);

      const data = await res.json().catch(() => ({}));
      console.log('[MeetingChatPanel] Response data:', data);

      if (!res.ok) {
        throw new Error(errorMessage(res.status, data, 'Erro ao enviar pergunta'));
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

  const handleQuickAction = (prompt: string) => {
    setQuestion(prompt);
    // foca no input pra usuário poder revisar/editar antes de enviar
    setTimeout(() => inputRef.current?.focus(), 0);
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
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-surface shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* What's new popup — primeira abertura pós-upgrade v2 */}
        {showWhatsNew && (
          <div className="absolute inset-0 bg-black/30 z-10 flex items-center justify-center p-4" onClick={dismissWhatsNew}>
            <div
              className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 max-h-[90%] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#2D5A27]/10 text-brand text-[10px] font-semibold uppercase tracking-wider mb-1">
                      Novidades
                    </div>
                    <h3 className="text-base font-bold text-primary leading-tight">
                      Chat IA v2.0 — muito mais útil
                    </h3>
                  </div>
                </div>
                <button
                  onClick={dismissWhatsNew}
                  className="text-tertiary hover:text-primary transition shrink-0"
                  aria-label="Fechar"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-secondary leading-relaxed">
                Refizemos o Chat IA do zero pra entregar análise de verdade, não só extração. Veja o que mudou:
              </p>

              <ul className="space-y-2.5 text-xs text-primary leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">💡</span>
                  <span><strong>Observações proativas:</strong> toda resposta termina com um insight que você não perguntou (riscos, oportunidades, próximos passos críticos).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">🧠</span>
                  <span><strong>Acesso à análise completa:</strong> a IA agora usa os scores de BANT/SPIN/CS, sentimento, satisfação e action items pra responder com contexto.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">💬</span>
                  <span><strong>Conversa contínua:</strong> faz follow-up entre perguntas — "e quanto a isso?", "explica melhor o item 2" funcionam.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">⚡</span>
                  <span><strong>Atalhos prontos:</strong> 6 ações em 1 clique (Resumir, Próximos passos, Riscos, Email follow-up, Por que pode não fechar?, Decisor).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">📧</span>
                  <span><strong>Drafts prontos:</strong> peça "email de follow-up" e receba texto pronto pra copiar — com assunto e referências específicas da reunião.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">📈</span>
                  <span><strong>Respostas mais longas:</strong> dobro de espaço pra análises profundas quando a pergunta pede.</span>
                </li>
              </ul>

              <button
                onClick={dismissWhatsNew}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition shadow-sm"
              >
                Entendi, vamos lá
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-light bg-background">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-brand" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-primary">Chat de IA</h2>
                <span className="text-[10px] text-tertiary font-mono">v2.0.0</span>
              </div>
              <p className="text-xs text-secondary">
                {remainingQuestions} {remainingQuestions === 1 ? 'pergunta restante' : 'perguntas restantes'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#E0E0E0] flex items-center justify-center transition"
          >
            <X className="w-5 h-5 text-secondary" />
          </button>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 animate-spin text-brand" />
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center text-center pt-2">
              <div className="w-14 h-14 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center mb-3">
                <Sparkles className="w-7 h-7 text-brand" />
              </div>
              <p className="text-base font-semibold text-primary mb-1">
                Como posso ajudar com essa reunião?
              </p>
              <p className="text-xs text-secondary max-w-xs mb-6">
                Escolha um atalho abaixo ou faça uma pergunta livre. A IA tem acesso à transcrição completa e à análise estruturada.
              </p>

              <div className="grid grid-cols-1 gap-2 w-full">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action.prompt)}
                    disabled={isLoading || remainingQuestions <= 0}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-neutral-light hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg leading-none" aria-hidden>{action.emoji}</span>
                    <span className="text-sm font-medium text-primary">{action.label}</span>
                  </button>
                ))}
              </div>
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
                  <div className="bg-neutral-lighter text-primary px-4 py-3 rounded-2xl rounded-tl-sm max-w-[85%]">
                    <div 
                      className="text-sm leading-relaxed [&_strong]:font-bold [&_strong]:text-primary"
                      dangerouslySetInnerHTML={{ __html: processMarkdown(chat.answer) }}
                    />
                    <p className="text-xs text-tertiary mt-2">
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
        <div className="p-4 border-t border-neutral-light bg-surface">
          {/* Quick-actions compactas (visíveis quando já tem histórico) */}
          {chats.length > 0 && !error && (
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={isLoading || remainingQuestions <= 0}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-light hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition text-xs font-medium text-secondary hover:text-brand disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  title={action.prompt}
                >
                  <span aria-hidden>{action.emoji}</span>
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mb-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua pergunta sobre a reunião..."
              className="flex-1 px-4 py-3 border border-neutral-light rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
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

          <div className="mt-2 flex items-center justify-between text-xs text-tertiary">
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

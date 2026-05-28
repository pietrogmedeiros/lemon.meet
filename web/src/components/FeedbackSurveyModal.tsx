import { useState } from 'react';
import { Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface FeedbackSurveyModalProps {
  isOpen: boolean;
  onSubmitted: () => void;
}

export function FeedbackSurveyModal({ isOpen, onSubmitted }: FeedbackSurveyModalProps) {
  const [howUsing, setHowUsing] = useState('');
  const [whatThink, setWhatThink] = useState('');
  const [featureRequest, setFeatureRequest] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!howUsing.trim() || !whatThink.trim() || !featureRequest.trim()) {
      setError('Por favor, responda todas as perguntas');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Sessão expirada. Faça login novamente.');
        return;
      }

      const res = await fetch(`${apiUrl}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          how_using: howUsing.trim(),
          what_think: whatThink.trim(),
          feature_request: featureRequest.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Se o backend diz que já respondeu, também marca como enviado e fecha
        if (res.status === 409) {
          localStorage.setItem('lemon-feedback-submitted', 'true');
          onSubmitted();
          return;
        }
        throw new Error(data.message || 'Erro ao enviar feedback');
      }

      localStorage.setItem('lemon-feedback-submitted', 'true');
      onSubmitted();

    } catch (err: any) {
      console.error('Error submitting feedback:', err);
      setError(err.message || 'Erro ao enviar feedback. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay — sem onClick para impedir fechar clicando fora */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        {/* Modal */}
        <div className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header — sem botão de fechar */}
          <div className="px-6 py-4 border-b border-neutral-light">
            <h2 className="text-xl font-bold text-primary">Queremos ouvir você! 🎤</h2>
            <p className="text-sm text-secondary mt-1">
              Ajude-nos a melhorar o Lemon.meet respondendo 3 perguntas rápidas
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
            {/* Pergunta 1 */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                1. Como você está utilizando o Lemon.meet?
              </label>
              <textarea
                value={howUsing}
                onChange={(e) => setHowUsing(e.target.value)}
                placeholder="Ex: Para gravar minhas reuniões comerciais, análise de vendas..."
                className="w-full px-4 py-3 border border-neutral-light rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={3}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-tertiary mt-1 text-right">{howUsing.length}/2000</div>
            </div>

            {/* Pergunta 2 */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                2. O que você está achando do Lemon.meet?
              </label>
              <textarea
                value={whatThink}
                onChange={(e) => setWhatThink(e.target.value)}
                placeholder="Ex: Adorei a feature de insights, mas sinto falta de..."
                className="w-full px-4 py-3 border border-neutral-light rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={3}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-tertiary mt-1 text-right">{whatThink.length}/2000</div>
            </div>

            {/* Pergunta 3 */}
            <div>
              <label className="block text-sm font-semibold text-primary mb-2">
                3. Se pudesse fazer UM pedido de nova funcionalidade ou melhoria, qual seria?
              </label>
              <textarea
                value={featureRequest}
                onChange={(e) => setFeatureRequest(e.target.value)}
                placeholder="Ex: Gostaria de integração com Notion, ou melhor..."
                className="w-full px-4 py-3 border border-neutral-light rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={4}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-tertiary mt-1 text-right">{featureRequest.length}/2000</div>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Footer — apenas botão de enviar */}
            <div className="flex items-center justify-end pt-4 border-t border-neutral-light">
              <button
                type="submit"
                disabled={isSubmitting || !howUsing.trim() || !whatThink.trim() || !featureRequest.trim()}
                className="px-6 py-3 bg-[#2D5A27] text-white rounded-xl hover:bg-[#234520] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm font-semibold"
              >
                {isSubmitting ? (
                  <>Enviando...</>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Enviar Feedback
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-center text-tertiary">
              Seu feedback nos ajuda a criar um produto melhor para você! ❤️
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

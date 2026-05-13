import { useState, useEffect } from 'react';
import { X, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface FeedbackSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeedbackSurveyModal({ isOpen, onClose }: FeedbackSurveyModalProps) {
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
        throw new Error(data.message || 'Erro ao enviar feedback');
      }

      // Marca como enviado no localStorage
      localStorage.setItem('lemon-feedback-submitted', 'true');
      
      // Fecha o modal
      onClose();

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
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        {/* Modal */}
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0]">
            <div>
              <h2 className="text-xl font-bold text-[#333333]">Queremos ouvir você! 🎤</h2>
              <p className="text-sm text-[#666666] mt-1">
                Ajude-nos a melhorar o Lemon.meet respondendo 3 perguntas rápidas
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#F5F5F5] flex items-center justify-center transition"
            >
              <X className="w-5 h-5 text-[#666666]" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
            {/* Pergunta 1 */}
            <div>
              <label className="block text-sm font-semibold text-[#333333] mb-2">
                1. Como você está utilizando o Lemon.meet?
              </label>
              <textarea
                value={howUsing}
                onChange={(e) => setHowUsing(e.target.value)}
                placeholder="Ex: Para gravar minhas reuniões comerciais, análise de vendas..."
                className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={3}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-[#999999] mt-1 text-right">{howUsing.length}/2000</div>
            </div>

            {/* Pergunta 2 */}
            <div>
              <label className="block text-sm font-semibold text-[#333333] mb-2">
                2. O que você está achando do Lemon.meet?
              </label>
              <textarea
                value={whatThink}
                onChange={(e) => setWhatThink(e.target.value)}
                placeholder="Ex: Adorei a feature de insights, mas sinto falta de..."
                className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={3}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-[#999999] mt-1 text-right">{whatThink.length}/2000</div>
            </div>

            {/* Pergunta 3 */}
            <div>
              <label className="block text-sm font-semibold text-[#333333] mb-2">
                3. Se pudesse fazer UM pedido de nova funcionalidade ou melhoria, qual seria?
              </label>
              <textarea
                value={featureRequest}
                onChange={(e) => setFeatureRequest(e.target.value)}
                placeholder="Ex: Gostaria de integração com Notion, ou melhor..."
                className="w-full px-4 py-3 border border-[#E0E0E0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 focus:border-[#2D5A27] transition text-sm"
                rows={4}
                maxLength={2000}
                disabled={isSubmitting}
              />
              <div className="text-xs text-[#999999] mt-1 text-right">{featureRequest.length}/2000</div>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[#E0E0E0]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[#666666] hover:text-[#333333] transition"
                disabled={isSubmitting}
              >
                Agora não
              </button>
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

            <p className="text-xs text-center text-[#999999]">
              Seu feedback nos ajuda a criar um produto melhor para você! ❤️
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

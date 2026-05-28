import { Sparkles, ThumbsUp, ThumbsDown, AlertTriangle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ROWS = [
  { icon: ThumbsUp, color: '#2D7A34', title: 'A favor', desc: 'Sinais que jogam pro avanço do negócio.' },
  { icon: ThumbsDown, color: '#B25E00', title: 'Contra', desc: 'Fricções e objeções que apareceram.' },
  { icon: AlertTriangle, color: '#B42318', title: 'Riscos', desc: 'O que pode travar — com severidade e mitigação.' },
];

/** Pop-up de anúncio da feature "Insights que impulsionam decisões". One-time. */
export function DecisionInsightsAnnounceModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-neutral-light">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand bg-[#2D5A27]/10 px-2.5 py-1 rounded-full mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            Novidade
          </span>
          <h2 className="text-xl font-bold text-primary flex items-center gap-2">
            Insights que impulsionam decisões
          </h2>
          <p className="text-sm text-secondary mt-1">
            Toda reunião analisada agora traz, no topo, uma síntese pronta pra você decidir o próximo passo —
            sem precisar reler a transcrição inteira.
          </p>
        </div>

        {/* Como funciona */}
        <div className="px-6 py-5 space-y-3">
          {ROWS.map((r) => (
            <div key={r.title} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5" style={{ color: r.color }}>
                <r.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">{r.title}</p>
                <p className="text-sm text-secondary leading-relaxed">{r.desc}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-tertiary pt-1">
            Cada ponto vem com a evidência da própria conversa, gerado automaticamente.
            Disponível nas reuniões a partir de <span className="font-medium text-secondary">24/05/2026</span>.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-light flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#2D5A27] text-white rounded-xl hover:bg-[#234520] transition text-sm font-semibold"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

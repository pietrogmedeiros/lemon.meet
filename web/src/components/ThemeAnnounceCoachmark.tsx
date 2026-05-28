import { Sparkles, X } from 'lucide-react';

/** Coachmark one-time apontando pro toggle de tema (no header do Sidebar).
 *  Reaparece a cada reload ATÉ o usuário fechar; depois nunca mais. */
export function ThemeAnnounceCoachmark({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed left-4 top-[66px] z-[60] w-72">
      {/* setinha apontando pra cima (em direção ao toggle) */}
      <div className="absolute -top-2 left-[156px] h-4 w-4 rotate-45 rounded-[3px] bg-surface border-l border-t border-neutral-light" />
      <div className="relative rounded-2xl bg-surface border border-neutral-light shadow-2xl p-4">
        <button
          onClick={onClose}
          className="absolute top-2.5 right-2.5 text-tertiary hover:text-primary transition-colors"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 text-brand font-semibold text-sm mb-1.5">
          <Sparkles className="h-4 w-4" />
          Tema escuro chegou!
        </div>
        <p className="text-sm text-secondary leading-relaxed pr-4">
          Vocês pediram, nossos dev's espremeram o tema dark <span className="whitespace-nowrap">🤤</span>
        </p>
        <p className="text-xs text-tertiary mt-2">
          Alterne ali em cima <span aria-hidden>↑</span>, ao lado de “Lemon.meet”.
        </p>
        <button
          onClick={onClose}
          className="mt-3 w-full py-2 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition-colors"
        >
          Entendi
        </button>
      </div>
    </div>
  );
}

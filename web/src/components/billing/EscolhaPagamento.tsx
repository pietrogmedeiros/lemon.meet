import { useEffect, useState } from 'react';
import { Loader, Copy, Check, CreditCard, QrCode, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const API = import.meta.env.VITE_API_URL || 'https://api.lemon-meet.com';

interface PixData {
  brCode: string;
  brCodeBase64: string;
  expiresAt?: string;
  amountCents: number;
}

/**
 * Escolha do meio de pagamento e, no caso do PIX, o QR dentro do app.
 *
 * Os dois trilhos se comportam de forma diferente por causa das APIs, não por
 * escolha: o cartão da InfinitePay é checkout hospedado (leva para fora) e o
 * PIX da AbacatePay devolve o código (fica aqui). Menos redirecionamento é
 * menos gente perdida no meio do pagamento.
 *
 * ⚠️ A confirmação do PIX é por CONSULTA, não por webhook: a AbacatePay não
 * documenta evento para QR Code, e "pagou e o plano não ativou" é a pior falha
 * possível deste fluxo.
 */
export function EscolhaPagamento({
  plano,
  trilhos,
  onFechar,
}: {
  plano: 'starter' | 'professional';
  trilhos: ('pix' | 'card')[];
  onFechar: () => void;
}) {
  const [carregando, setCarregando] = useState<'pix' | 'card' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pix, setPix] = useState<PixData | null>(null);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pago, setPago] = useState(false);

  const nome = plano === 'starter' ? 'Starter' : 'Professional';

  async function pagar(meio: 'pix' | 'card') {
    setErro(null);
    setCarregando(meio);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const rota = meio === 'pix' ? '/api/payments/pix' : '/api/subscription/checkout';
      const res = await fetch(`${API}${rota}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ plan: plano }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Falha ao iniciar o pagamento.');

      if (meio === 'card' && data.url) {
        window.location.href = data.url;
        return;
      }
      if (meio === 'pix' && data.pix) {
        setPix(data.pix);
        setChargeId(data.chargeId ?? null);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao iniciar o pagamento.');
    } finally {
      setCarregando(null);
    }
  }

  // Enquanto o QR estiver na tela, pergunta a cada 5s se o PIX caiu.
  useEffect(() => {
    if (!chargeId || pago) return;
    const t = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/payments/charge/${chargeId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const d = await res.json().catch(() => null);
      if (d?.status === 'paid') {
        setPago(true);
        clearInterval(t);
        setTimeout(() => window.location.reload(), 1500);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [chargeId, pago]);

  function copiar() {
    if (!pix) return;
    navigator.clipboard.writeText(pix.brCode);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onFechar}>
      <div
        className="bg-surface rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-bold text-primary">Assinar {nome}</p>
          <button onClick={onFechar} className="text-tertiary hover:text-secondary" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {pago ? (
          <div className="text-center py-6 space-y-2">
            <Check className="mx-auto text-brand" size={36} />
            <p className="font-semibold text-primary">Pagamento confirmado!</p>
            <p className="text-sm text-secondary">Liberando seu plano…</p>
          </div>
        ) : pix ? (
          <div className="space-y-3">
            <p className="text-sm text-secondary">
              Abra o app do seu banco, escolha PIX e escaneie o código — ou copie e cole.
            </p>
            {pix.brCodeBase64 && (
              <img src={pix.brCodeBase64} alt="QR Code do PIX" className="w-48 h-48 mx-auto rounded-lg" />
            )}
            <button
              onClick={copiar}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-neutral-light text-sm font-medium hover:bg-neutral-lighter transition"
            >
              {copiado ? <Check size={14} /> : <Copy size={14} />}
              {copiado ? 'Código copiado' : 'Copiar código PIX'}
            </button>
            <p className="text-xs text-tertiary text-center">
              Assim que o pagamento cair, seu plano é liberado automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-secondary">Como você quer pagar?</p>
            {trilhos.includes('pix') && (
              <button
                onClick={() => pagar('pix')}
                disabled={carregando !== null}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-[#2D5A27] text-brand font-semibold hover:bg-[#2D5A27]/5 transition disabled:opacity-50"
              >
                {carregando === 'pix' ? <Loader size={16} className="animate-spin" /> : <QrCode size={16} />}
                PIX — na hora
              </button>
            )}
            {trilhos.includes('card') && (
              <button
                onClick={() => pagar('card')}
                disabled={carregando !== null}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#2D5A27] text-white font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50"
              >
                {carregando === 'card' ? <Loader size={16} className="animate-spin" /> : <CreditCard size={16} />}
                Cartão de crédito
              </button>
            )}
          </div>
        )}

        {erro && <p className="text-sm text-red-600">{erro}</p>}
      </div>
    </div>
  );
}

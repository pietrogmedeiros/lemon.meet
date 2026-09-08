import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://api.lemon-meet.com';

export interface PaymentAvailability {
  habilitado: boolean;
  trilhos: ('pix' | 'card')[];
  motivo?: string;
}

/**
 * O SERVIDOR decide se dá para cobrar; a tela obedece.
 *
 * Enquanto a loja da AbacatePay não tiver trilho de recorrência, oferecer
 * "Assinar" é mandar a pessoa para um 500 — e antes disso ela era jogada em
 * /settings sem explicação. Quando um trilho for configurado no EasyPanel, o
 * botão volta sozinho, sem deploy do front.
 *
 * Em caso de falha na consulta, assume INDISPONÍVEL: melhor não oferecer do que
 * oferecer e quebrar.
 */
export function usePaymentAvailability(): { data: PaymentAvailability; loading: boolean } {
  const [data, setData] = useState<PaymentAvailability>({ habilitado: false, trilhos: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch(`${API}/api/subscription/payment-availability`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setData(d); })
      .catch(() => { if (vivo) setData({ habilitado: false, trilhos: [] }); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  return { data, loading };
}

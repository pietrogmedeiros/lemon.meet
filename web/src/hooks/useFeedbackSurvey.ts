import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useFeedbackSurvey() {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    checkIfShouldShow();
  }, []);

  const checkIfShouldShow = async () => {
    try {
      // Atalho local: já respondeu nesta máquina/navegador
      const hasSubmittedLocal = localStorage.getItem('lemon-feedback-submitted');
      if (hasSubmittedLocal === 'true') {
        return;
      }

      // Só mostra para usuários autenticados
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Confirma no backend (fonte da verdade entre dispositivos)
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/api/feedback/check`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) return;

      const data = await res.json();

      if (data.hasSubmitted) {
        localStorage.setItem('lemon-feedback-submitted', 'true');
        return;
      }

      // Ainda não respondeu — mostra o modal (bloqueante até responder).
      // Pequeno delay pra não aparecer no exato instante em que a página monta.
      setTimeout(() => setShouldShow(true), 1500);
    } catch (error) {
      console.error('Error checking feedback status:', error);
    }
  };

  const markSubmitted = () => {
    setShouldShow(false);
  };

  return { shouldShow, markSubmitted };
}

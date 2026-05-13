import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useFeedbackSurvey() {
  const [shouldShow, setShouldShow] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    checkIfShouldShow();
  }, []);

  const checkIfShouldShow = async () => {
    try {
      // Verifica localStorage primeiro (mais rápido)
      const hasSubmittedLocal = localStorage.getItem('lemon-feedback-submitted');
      if (hasSubmittedLocal === 'true') {
        setShouldShow(false);
        setIsChecking(false);
        return;
      }

      // Verifica se está autenticado
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setShouldShow(false);
        setIsChecking(false);
        return;
      }

      // Verifica no backend se já respondeu
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      
      const res = await fetch(`${apiUrl}/api/feedback/check`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        setShouldShow(false);
        setIsChecking(false);
        return;
      }

      const data = await res.json();
      
      if (data.hasSubmitted) {
        // Sincroniza com localStorage
        localStorage.setItem('lemon-feedback-submitted', 'true');
        setShouldShow(false);
      } else {
        // Verifica se já mostrou a pesquisa nesta sessão
        const hasSeenThisSession = sessionStorage.getItem('lemon-feedback-shown');
        if (!hasSeenThisSession) {
          // Adiciona delay de 3 segundos antes de mostrar
          setTimeout(() => {
            setShouldShow(true);
            sessionStorage.setItem('lemon-feedback-shown', 'true');
          }, 3000);
        }
      }

    } catch (error) {
      console.error('Error checking feedback status:', error);
      setShouldShow(false);
    } finally {
      setIsChecking(false);
    }
  };

  const dismiss = () => {
    setShouldShow(false);
    // Marca como visto nesta sessão (mas não submete)
    sessionStorage.setItem('lemon-feedback-shown', 'true');
  };

  return { shouldShow, isChecking, dismiss };
}

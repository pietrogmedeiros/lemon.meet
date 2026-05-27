// Traduz códigos de `failure_reason` (gravados pelo backend) em mensagens
// amigáveis pro usuário. Espelha o reasonMap de
// server/src/services/NotificationService.ts — manter os dois em sincronia.
//
// O backend grava com prefixo de origem, ex.:
//   "bot_failed: waiting_room_timeout"  (MeetingBaas)
//   "attendee_fatal_error: request_to_join_denied"  (Attendee)
//   "no_transcript_in_webhook"  (códigos de transcrição, sem prefixo)
//   "transcription_download_failed: <erro>"  (com detalhe livre após ':')

export interface FailureDescription {
  /** Frase curta para badge/lista (MeetingsPage). */
  short: string;
  /** Título para a tela de detalhes (TranscricaoDetalhesPage). */
  title: string;
  /** Explicação acionável para a tela de detalhes. */
  detail: string;
}

const REASON_MAP: Record<string, FailureDescription> = {
  // ── Bot não foi admitido / não entrou na reunião ───────────────────────────
  waiting_room_timeout: {
    short: 'O bot não foi admitido na reunião.',
    title: 'Bot não foi admitido na reunião',
    detail:
      'O bot ficou na sala de espera e não foi aceito a tempo. Peça para um participante admitir o "Lemon Notetaker" assim que ele pedir para entrar.',
  },
  request_to_join_denied: {
    short: 'O bot não foi aceito na reunião.',
    title: 'Bot não foi aceito na reunião',
    detail:
      'O "Lemon Notetaker" pediu para entrar mas não foi admitido. Peça para um participante admitir o bot assim que ele solicitar entrada na reunião.',
  },
  bot_rejected: {
    short: 'O bot foi recusado ao entrar na reunião.',
    title: 'Bot recusado na reunião',
    detail:
      'O bot foi recusado ao tentar entrar na reunião. Peça para um participante admitir o "Lemon Notetaker" na próxima vez.',
  },
  meeting_error: {
    short: 'Erro na plataforma da reunião.',
    title: 'Erro na plataforma da reunião',
    detail:
      'Ocorreu um erro na plataforma da reunião e o bot não conseguiu permanecer. Tente novamente.',
  },
  invalid_meeting_url: {
    short: 'Link da reunião inválido.',
    title: 'Link da reunião inválido',
    detail: 'O link da reunião era inválido ou a reunião não existia mais.',
  },
  meeting_not_found: {
    short: 'Reunião não encontrada.',
    title: 'Reunião não encontrada',
    detail:
      'O link era inválido/expirado ou a reunião ainda não tinha sido aberta quando o bot tentou entrar.',
  },

  // ── Entrou mas não capturou áudio / falha de transcrição ───────────────────
  no_transcript_in_webhook: {
    short: 'O bot entrou mas não capturou áudio.',
    title: 'Reunião sem transcrição',
    detail:
      'O bot entrou na reunião mas não capturou áudio. Verifique se a sala admitiu o bot e se o microfone dos participantes estava ativo.',
  },
  no_transcript: {
    short: 'Não capturou áudio.',
    title: 'Reunião sem transcrição',
    detail: 'A gravação não capturou áudio. Verifique se o microfone dos participantes estava ativo.',
  },
  no_transcription_url: {
    short: 'Serviço externo não retornou link de transcrição.',
    title: 'Serviço de transcrição não retornou áudio',
    detail:
      'O serviço externo concluiu o bot mas não disponibilizou link de transcrição. Tente reprocessar a reunião.',
  },
  transcription_download_failed: {
    short: 'Falha ao baixar a transcrição (instabilidade externa).',
    title: 'Falha ao baixar a transcrição',
    detail:
      'Não foi possível obter a transcrição do serviço externo (provavelmente instabilidade temporária). Tente reprocessar.',
  },
  transcription_fallback_failed: {
    short: 'Falha ao transcrever o áudio (fallback).',
    title: 'Falha ao transcrever o áudio',
    detail:
      'A transcrição automática falhou mesmo no fallback. Tente reprocessar a reunião.',
  },
  transcription_failed: {
    short: 'Falha ao transcrever o áudio.',
    title: 'Falha ao transcrever o áudio',
    detail: 'Não foi possível transcrever o áudio da reunião. Tente reprocessar.',
  },
  insights_generation_failed: {
    short: 'Transcrição existe, mas IA falhou ao analisar.',
    title: 'Análise por IA falhou',
    detail:
      'A transcrição está disponível, mas não foi possível gerar os insights. Tente reprocessar para gerar a análise.',
  },
  extension_no_audio_captured: {
    short: 'Extensão não capturou áudio.',
    title: 'Extensão não capturou áudio',
    detail:
      'A extensão não capturou áudio durante a reunião. Verifique as permissões de áudio da aba/guia.',
  },
};

/** Extrai o código do `failure_reason`, removendo o prefixo de origem e detalhes. */
function extractCode(reason: string): string {
  let r = reason.trim();
  const wrapped = r.match(/^(?:bot_failed|attendee_fatal_error)\s*:\s*(.*)$/);
  if (wrapped) r = wrapped[1].trim();
  // O código é o token antes de qualquer ": <detalhe livre>".
  return r.split(':')[0].trim();
}

/** Descreve um `failure_reason` em mensagem amigável, ou null se não houver motivo. */
export function describeFailure(
  reason: string | null | undefined
): FailureDescription | null {
  if (!reason) return null;
  const mapped = REASON_MAP[extractCode(reason)];
  if (mapped) return mapped;
  return {
    short: 'O bot não conseguiu gravar a reunião.',
    title: 'Reunião com erro',
    detail: `O bot encerrou com uma falha não identificada (${reason}).`,
  };
}

// Traduz códigos de `failure_reason` (gravados pelo backend) em mensagens
// amigáveis pro usuário. Espelha o reasonMap de
// server/src/services/NotificationService.ts — manter os dois em sincronia.
//
// O backend grava com prefixo de origem, ex.:
//   "bot_failed: waiting_room_timeout"  (MeetingBaas)
//   "attendee_fatal_error: request_to_join_denied"  (Attendee)
//   "no_transcript_in_webhook"  (códigos de transcrição, sem prefixo)
//   "transcription_download_failed: <erro>"  (com detalhe livre após ':')

/**
 * `erro`        = algo do nosso lado falhou. Vermelho.
 * `nao_gravada` = nada quebrou: o bot não foi admitido, o evento foi cancelado,
 *                 a reunião não aconteceu. Azul — pintar isso de vermelho faz o
 *                 usuário achar que a plataforma está fora do ar, e em 02/09
 *                 foram 12 de 21 reuniões nessa situação.
 */
export type FailureKind = 'erro' | 'nao_gravada'

export interface FailureDescription {
  /** Severidade, que decide a cor no front. */
  kind: FailureKind
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
    kind: 'nao_gravada',
    short: 'O bot não foi admitido na reunião.',
    title: 'Bot não foi admitido na reunião',
    detail:
      'O bot ficou na sala de espera e não foi aceito a tempo. Peça para um participante admitir o "Lemon Notetaker" assim que ele pedir para entrar.',
  },
  request_to_join_denied: {
    kind: 'nao_gravada',
    short: 'O bot não foi aceito na reunião.',
    title: 'Bot não foi aceito na reunião',
    detail:
      'O "Lemon Notetaker" pediu para entrar mas não foi admitido. Peça para um participante admitir o bot assim que ele solicitar entrada na reunião.',
  },
  bot_rejected: {
    kind: 'nao_gravada',
    short: 'O bot foi recusado ao entrar na reunião.',
    title: 'Bot recusado na reunião',
    detail:
      'O bot foi recusado ao tentar entrar na reunião. Peça para um participante admitir o "Lemon Notetaker" na próxima vez.',
  },
  meeting_error: {
    kind: 'erro',
    short: 'Erro na plataforma da reunião.',
    title: 'Erro na plataforma da reunião',
    detail:
      'Ocorreu um erro na plataforma da reunião e o bot não conseguiu permanecer. Tente novamente.',
  },
  invalid_meeting_url: {
    kind: 'nao_gravada',
    short: 'Link da reunião inválido.',
    title: 'Link da reunião inválido',
    detail: 'O link da reunião era inválido ou a reunião não existia mais.',
  },
  meeting_not_found: {
    kind: 'nao_gravada',
    short: 'Reunião não encontrada.',
    title: 'Reunião não encontrada',
    detail:
      'O link era inválido/expirado ou a reunião ainda não tinha sido aberta quando o bot tentou entrar.',
  },
  dispatch_failed: {
    kind: 'erro',
    short: 'Não foi possível enviar o bot.',
    title: 'Falha ao enviar o bot',
    detail:
      'Houve instabilidade no serviço de bots e o bot não chegou a ser enviado para a reunião. Tente iniciar a reunião novamente.',
  },

  // ── Entrou mas não capturou áudio / falha de transcrição ───────────────────
  no_transcript_in_webhook: {
    kind: 'erro',
    short: 'O bot entrou mas não capturou áudio.',
    title: 'Reunião sem transcrição',
    detail:
      'O bot entrou na reunião mas não capturou áudio. Verifique se a sala admitiu o bot e se o microfone dos participantes estava ativo.',
  },
  no_transcript: {
    kind: 'nao_gravada',
    short: 'Não capturou áudio.',
    title: 'Reunião sem transcrição',
    detail: 'A gravação não capturou áudio. Verifique se o microfone dos participantes estava ativo.',
  },
  no_transcription_url: {
    kind: 'erro',
    short: 'Serviço externo não retornou link de transcrição.',
    title: 'Serviço de transcrição não retornou áudio',
    detail:
      'O serviço externo concluiu o bot mas não disponibilizou link de transcrição. Tente reprocessar a reunião.',
  },
  transcription_download_failed: {
    kind: 'erro',
    short: 'Falha ao baixar a transcrição (instabilidade externa).',
    title: 'Falha ao baixar a transcrição',
    detail:
      'Não foi possível obter a transcrição do serviço externo (provavelmente instabilidade temporária). Tente reprocessar.',
  },
  transcription_fallback_failed: {
    kind: 'erro',
    short: 'Falha ao transcrever o áudio (fallback).',
    title: 'Falha ao transcrever o áudio',
    detail:
      'A transcrição automática falhou mesmo no fallback. Tente reprocessar a reunião.',
  },
  transcription_failed: {
    kind: 'erro',
    short: 'Falha ao transcrever o áudio.',
    title: 'Falha ao transcrever o áudio',
    detail: 'Não foi possível transcrever o áudio da reunião.',
  },
  // Gravações do celular e do Mac não podem ser reprocessadas: o áudio é
  // apagado do servidor logo após o processamento, como diz a política de
  // privacidade. Prometer "tente reprocessar" aqui é mandar o usuário para um
  // botão que sempre falha.
  audio_too_large: {
    kind: 'nao_gravada',
    short: 'Gravação longa demais para transcrever.',
    title: 'A gravação não pôde ser transcrita',
    detail:
      'O arquivo ficou acima do limite do serviço de transcrição e o áudio não fica guardado depois do processamento, então esta reunião não pode ser recuperada. Já corrigimos o tratamento de gravações longas — as próximas passam normalmente.',
  },
  insights_generation_failed: {
    kind: 'erro',
    short: 'Transcrição existe, mas IA falhou ao analisar.',
    title: 'Análise por IA falhou',
    detail:
      'A transcrição está disponível, mas não foi possível gerar os insights. Tente reprocessar para gerar a análise.',
  },
  extension_no_audio_captured: {
    kind: 'nao_gravada',
    short: 'Extensão não capturou áudio.',
    title: 'Extensão não capturou áudio',
    detail:
      'A extensão não capturou áudio durante a reunião. Verifique as permissões de áudio da aba/guia.',
  },
  // ── Códigos do Skribby (provider atual) ───────────────────────────────────
  // 31 ocorrências no banco e NENHUMA mapeada até 02/09: caíam todas no texto
  // genérico "O bot não conseguiu gravar a reunião", que faz parecer defeito da
  // plataforma. Em 02/09 foram 12 das 21 reuniões do dia.
  skribby_not_admitted: {
    kind: 'nao_gravada',
    short: 'Ninguém admitiu o bot na reunião.',
    title: 'O bot ficou esperando e não foi admitido',
    detail:
      'O "Lemon Notetaker" pediu para entrar e esperou até a reunião acabar, mas nenhum participante o admitiu. Não é falha da plataforma: alguém de dentro da sala precisa aceitar o pedido. Para reuniões recorrentes, convidar contato@lemon-meet.com no evento faz o Google Meet admitir o bot sozinho.',
  },
  stuck_bot_not_admitted_cleanup: {
    kind: 'nao_gravada',
    short: 'Ninguém admitiu o bot na reunião.',
    title: 'O bot ficou esperando e não foi admitido',
    detail:
      'O bot esperou na sala de espera até a reunião terminar sem ser admitido. Alguém de dentro da sala precisa aceitar o pedido de entrada.',
  },
  skribby_failed: {
    kind: 'erro',
    short: 'O serviço de gravação falhou.',
    title: 'O serviço de gravação falhou',
    detail:
      'O bot foi enviado, mas o serviço de gravação encerrou com erro. Se a reunião ainda estiver em andamento, dá para gravar pelo aplicativo.',
  },
  skribby_invalid_credentials: {
    kind: 'erro',
    short: 'A conta do bot foi recusada pelo Google.',
    title: 'A conta do bot foi recusada',
    detail:
      'O serviço de gravação não conseguiu autenticar a conta que o bot usa para entrar nas reuniões. É um problema nosso, não seu — a equipe do Lemon é avisada automaticamente quando isso acontece.',
  },
  bot_failed: {
    kind: 'erro',
    short: 'O bot não chegou a entrar.',
    title: 'O bot não chegou a entrar na reunião',
    detail:
      'O bot foi solicitado mas não conseguiu iniciar. Se a reunião ainda estiver acontecendo, dá para gravar pelo aplicativo.',
  },
  calendar_event_cancelled: {
    kind: 'nao_gravada',
    short: 'O evento foi cancelado na agenda.',
    title: 'Evento cancelado na agenda',
    detail:
      'O compromisso foi cancelado no Google Agenda antes do horário, então o bot foi retirado e nada foi gravado.',
  },
  no_usable_audio: {
    kind: 'nao_gravada',
    short: 'Não houve fala para transcrever.',
    title: 'A gravação não tem conversa',
    detail:
      'O bot esteve na sala, mas não captou fala: sala vazia, microfones desligados, ou a conversa aconteceu em outro link. Preferimos não gerar resumo nem insights nesse caso — analisar silêncio produziria uma leitura inventada da reunião.',
  },
  ui_element_not_found: {
    kind: 'erro',
    short: 'O bot não conseguiu operar a tela da reunião.',
    title: 'O bot travou ao entrar na reunião',
    detail:
      'A plataforma da reunião mudou algo na tela e o bot não encontrou o botão de entrar. É um problema do serviço de gravação, e a equipe do Lemon acompanha esses casos.',
  },
  attendee_internal_error: {
    kind: 'erro',
    short: 'Erro interno do serviço de gravação.',
    title: 'Erro interno do serviço de gravação',
    detail: 'O serviço que envia o bot falhou por conta própria. A reunião não foi gravada.',
  },
  no_transcript_in_webhook_legacy: {
    kind: 'erro',
    short: 'O serviço externo não devolveu a transcrição.',
    title: 'Transcrição não veio do serviço externo',
    detail: 'O bot gravou, mas o serviço externo não devolveu o texto da reunião.',
  },
  provider_sem_creditos: {
    kind: 'erro',
    short: 'Sem capacidade para enviar o bot.',
    title: 'Não havia capacidade para enviar o bot',
    detail:
      'O serviço de gravação estava sem saldo para lançar o bot no horário da reunião. É um problema nosso de capacidade, não da sua conta.',
  },
  provider_timeout_gravacao: {
    kind: 'erro',
    short: 'O bot entrou mas não começou a gravar.',
    title: 'A gravação não chegou a começar',
    detail:
      'O bot entrou na reunião, mas o serviço de gravação não iniciou a captura a tempo e desistiu.',
  },
  provider_bot_nao_aceito: {
    kind: 'nao_gravada',
    short: 'O bot não foi aceito na reunião.',
    title: 'O bot não foi aceito na reunião',
    detail:
      'Os participantes ou a própria plataforma não aceitaram a entrada do bot. Alguém de dentro da sala precisa admitir o "Lemon Notetaker".',
  },
  provider_reuniao_curta: {
    kind: 'nao_gravada',
    short: 'A reunião foi curta demais para gravar.',
    title: 'Reunião curta demais',
    detail:
      'O bot foi retirado logo no começo e o trecho gravado é curto demais para gerar transcrição.',
  },
};

/**
 * O provedor grava FRASE, não código — e são as causas mais frequentes no banco
 * (357 "Timeout waiting to start recording.", 322 "Not enough tokens…", 87
 * "Bot was not accepted…"). Sem esta tradução elas caem todas no texto genérico.
 */
const FRASES_DO_PROVEDOR: Array<[RegExp, string]> = [
  [/not enough tokens/i,            'provider_sem_creditos'],
  [/timeout waiting to start/i,     'provider_timeout_gravacao'],
  [/was not accepted into the meeting/i, 'provider_bot_nao_aceito'],
  [/removed too early|video is too short/i, 'provider_reuniao_curta'],
];

/** Extrai o código do `failure_reason`, removendo o prefixo de origem e detalhes. */
function extractCode(reason: string): string {
  let r = reason.trim();
  const wrapped = r.match(/^(?:bot_failed|attendee_fatal_error)\s*:\s*(.*)$/);
  if (wrapped) r = wrapped[1].trim();
  const frase = FRASES_DO_PROVEDOR.find(([re]) => re.test(r));
  if (frase) return frase[1];
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
    kind: 'erro',
    short: 'A reunião não foi gravada.',
    title: 'A reunião não foi gravada',
    detail: `O bot encerrou por um motivo que ainda não sabemos traduzir (${reason}). Se isso se repetir, avise a equipe do Lemon.`,
  };
}

-- migration-meetings-with-segments.sql
--
-- POR QUE ESTA FUNÇÃO EXISTE
-- A listagem (GET /api/meetings) precisa saber quais reuniões têm transcrição.
-- Antes ela perguntava `transcript_segments?select=meeting_id&meeting_id=in.(...)`,
-- que devolve UMA LINHA POR SEGMENTO. Como o PostgREST corta a resposta em 1000
-- linhas, e cada reunião tem centenas de segmentos, 300 reuniões viravam 1000
-- linhas cobrindo apenas 4 delas — todas as outras eram reportadas como "sem
-- transcrição". Medido em produção em 2026-08-26.
--
-- Esta função faz o DISTINCT dentro do banco: no máximo 1 linha por reunião,
-- muito abaixo de qualquer teto.
--
-- Como rodar: Supabase → SQL Editor → colar → Run. É idempotente.

create or replace function public.meetings_with_segments(p_ids uuid[])
returns table (meeting_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.meeting_id
  from public.transcript_segments s
  where s.meeting_id = any(p_ids)
$$;

-- O backend chama com a service_role, mas deixamos explícito.
grant execute on function public.meetings_with_segments(uuid[]) to service_role;

-- Sem este índice o distinct vira seq scan na tabela inteira.
--
-- ⚠️ RODE ESTA LINHA SEPARADO DAS DE CIMA, e note o CONCURRENTLY.
-- transcript_segments tem ~686 mil linhas (medido em 2026-08-26). Um
-- `create index` normal TRAVA ESCRITA na tabela enquanto constrói — e escrita
-- ali acontece toda vez que uma reunião termina de transcrever. Com
-- CONCURRENTLY o índice sobe sem bloquear ninguém.
--
-- CONCURRENTLY não roda dentro de transação. Se o SQL Editor reclamar de
-- "cannot run inside a transaction block", execute SÓ esta linha, sozinha,
-- numa aba nova.
create index concurrently if not exists idx_transcript_segments_meeting_id
  on public.transcript_segments (meeting_id);

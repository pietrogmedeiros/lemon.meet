# Runbook: isolar o staging da produção

## Por que isto existe (incidente 2026-05-27)

O ambiente **staging** do `@vibe-ai/server` (Railway) estava configurado com as
credenciais de **produção**:

- `SUPABASE_URL` → mesmo banco de prod (`fzphfdvlsvxqrpwpmfuv`)
- `MEETINGBAAS_API_KEY` → mesma chave de prod
- `ATTENDEE_ENABLED` ausente → Attendee desligado

Resultado: o `CalendarCronService` do staging pollava os eventos do Google dos
usuários **de produção**, criava as reuniões no **banco de prod** e disparava o
bot **MeetingBaas antes** da produção (ganhando a corrida pelo dedupe
`(user_id, baas_event_uuid)`). A produção só via "já tem reunião — ignorando" e
**nunca chegava a rotear** → 100% MeetingBaas, Attendee nunca entrava, por dias.

**Ação emergencial aplicada (2026-05-27):** `railway down -e staging -s @vibe-ai/server`
(deploy `3926cefb` → REMOVED). Confirmado: reunião de calendário voltou a ir
pro Attendee.

## O que este PR já entrega (seguro p/ mergear a qualquer momento)

**Guardrail no `CalendarCronService.start()`**: o cron só roda quando
`RAILWAY_ENVIRONMENT_NAME === 'production'` (ou `CALENDAR_CRON_ENABLED=true`
explícito). Em staging (`RAILWAY_ENVIRONMENT_NAME=staging`) ele se auto-desliga
e loga `[CalendarCron] DESLIGADO ...` — sem depender de ninguém lembrar de setar
flag. Não muda nada em produção (lá `RAILWAY_ENVIRONMENT_NAME=production`).

> Este guardrail é independente do dump — pode (e deveria) ir pra prod antes,
> pra que religar o staging nunca mais sequestre o fluxo.

## Checklist para reativar o staging com segurança (fazer depois, com o dump)

1. **Banco próprio de staging no Supabase**
   - Criar um projeto/branch Supabase separado para staging.
   - Dump de prod → restore no banco de staging (`pg_dump` / Supabase branching).
   - Setar no env de staging: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do
     banco **de staging** (NÃO os de prod).

2. **Chave MeetingBaas sandbox**
   - Trocar `MEETINGBAAS_API_KEY` do staging por uma chave **sandbox/dev**
     (não a de prod), pra bots de teste não caírem na conta de produção.
   - Idem para qualquer credencial externa compartilhada (Attendee
     `ATTENDEE_API_URL`/`ATTENDEE_API_KEY`, webhooks, etc.).

3. **Confirmar o guardrail do cron**
   - Em staging, deixar `CALENDAR_CRON_ENABLED` **unset** (o gate por
     `RAILWAY_ENVIRONMENT_NAME` já desliga) — ou setar explicitamente `=false`.
   - Em produção: nada a fazer (default já liga). Só setar `=true` se algum dia
     prod rodar num env name diferente de `production`.

4. **Religar o staging** (`railway up` / redeploy) e validar:
   - Log de boot do staging mostra `[CalendarCron] DESLIGADO (env=staging ...)`.
   - Criar evento de teste e confirmar que **nenhum** bot foi disparado pelo
     staging (nem reunião criada no banco de prod).

## Verificação rápida (pós-deploy do guardrail em prod)

- Logs de prod no boot: `[CalendarCron] Iniciado — intervalo de 3 minutos` (segue ligado).
- Logs de staging no boot (quando religado): `[CalendarCron] DESLIGADO`.

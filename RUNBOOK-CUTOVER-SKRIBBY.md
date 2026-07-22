# Runbook — Cutover MeetingBaaS → Skribby

**Objetivo:** migrar o provider de bots do MeetingBaaS para o Skribby, cortando
o custo fixo mensal (assinatura $99–299/mo) e a taxa de falha de join (~69% por
bloqueio de bots anônimos do Google).

**Estado atual:** Fase 0 (dark) commitada em `adb49fe`. Todo o código do Skribby
existe mas está **inerte** — `SKRIBBY_ENABLED=false` e o roteador **ainda não
despacha** para o Skribby (ver Fase 1a). Sem impacto em produção.

**Modelo de cobrança Skribby:** usage-based, sem assinatura/mínimo. Base
$0.35/h + transcrição $0.04–0.35/h. 5h grátis no signup, sem cartão pra começar.
⚠️ Confirmar no dashboard se é **cartão pós-pago** (fatura automática) ou
**crédito pré-pago** (recarga) antes de virar produção.

---

## ⚠️ O que a Fase 0 NÃO cobre (ler antes de tudo)

1. **Roteamento não existe.** `BotRouter.chooseProvider()` só conhece
   `attendee` e `meetingbaas`. O env `SKRIBBY_ROLLOUT_PERCENT` está documentado
   mas **não é lido em lugar nenhum**. Ligar o Skribby exige código (Fase 1a).
2. **TODO(piloto) em aberto no `SkribbyProvider.ts`** — a confirmar ao vivo:
   - Campo/suporte de **agendamento** (`scheduleBotAt`).
   - `transcription_model` para ter **diarização/speaker** (default groq/whisper
     não diariza → `speaker=null`).
   - Chaves de `stop_options` (evitar bot preso em sala vazia).
   - Nome exato dos campos do payload de `createBot`.
3. **Platform mapping:** Skribby usa `gmeet` (não `google_meet`).

---

## Fase 1a — Wire do provider no roteador (CÓDIGO, obrigatório)

Antes de qualquer rollout, implementar em `BotRouter`:

- [ ] Instanciar `SkribbyProvider` no construtor **apenas** se
      `SKRIBBY_ENABLED === 'true'` && creds presentes (espelhar o padrão do
      Attendee em `BotRouter.ts:55-65`).
- [ ] Ler `SKRIBBY_ROLLOUT_PERCENT` (0–100) e, em `chooseProvider`, rotear essa
      fração do tráfego para `'skribby'` **com fallback** para o caminho atual
      (attendee/meetingbaas) em caso de erro — reusar `reportFallback`.
- [ ] Persistir `skribby_bot_id` no caller (espelhar `extension.routes.ts:76`
      e `CalendarCronService`) quando `provider === 'skribby'`.
- [ ] `removeBot('skribby', id)` já existe no provider — garantir que o
      `botRouter.removeBot` roteia por `bot_provider`.
- [ ] Rodar `npm run build` (tsc) + `npm test` — verde antes de deploy.

> Enquanto essa fase não estiver mergeada, `SKRIBBY_ROLLOUT_PERCENT` é inócuo.

---

## Fase 1b — Provisionamento (uma vez)

- [ ] Criar conta em skribby.io, gerar **API key**.
- [ ] Confirmar modelo de billing (pós-pago × pré-pago) e cadastrar cartão.
- [ ] No dashboard do Skribby, configurar o **webhook** apontando para
      `https://<API_HOST>/api/skribby/webhook` e copiar o **signing secret**.
- [ ] Aplicar a migration **uma vez** no Supabase:
      `server/scripts/migration-skribby-provider.sql`
      (adiciona `meetings.skribby_bot_id` + índice — idempotente).
- [ ] Preencher no `.env` de produção:
  ```
  SKRIBBY_ENABLED=true
  SKRIBBY_API_URL=<base da REST API>
  SKRIBBY_API_KEY=<key>
  SKRIBBY_WEBHOOK_SECRET=<signing secret>
  SKRIBBY_LANGUAGE=pt-BR
  SKRIBBY_ROLLOUT_PERCENT=0        # começa em 0 mesmo com a flag on
  ```
- [ ] Deploy. Com `ROLLOUT_PERCENT=0`, nada muda ainda — só valida que o
      webhook responde `{ ok: true }` e o provider instancia sem erro.

---

## Fase 2 — Teste com 1 bot real (canário manual)

- [ ] Disparar **1** reunião real forçada para o Skribby (rollout mínimo ou
      dispatch manual). Validar ponta a ponta:
  - [ ] Bot **entra** na reunião (o teste que valida o fix dos 69%).
  - [ ] `status_update` chega no webhook e passa na validação HMAC.
  - [ ] Transcript é buscado (`getTranscript`) e gravado na reunião.
  - [ ] `bot_provider='skribby'` e `skribby_bot_id` persistidos.
  - [ ] Confirmar diarização/speaker (ajustar `transcription_model` se preciso).
  - [ ] `removeBot` funciona (bot sai ao encerrar).

---

## Fase 3 — Rollout gradual

Subir `SKRIBBY_ROLLOUT_PERCENT` em degraus, **estabilizando ~24h em cada** e
olhando as métricas antes de avançar:

`5 → 10 → 25 → 50 → 100`

Critério para avançar: taxa de **join success** do Skribby ≥ a do provider
atual **e** sem pico de `failure_reason` novos.

---

## Monitoramento (nativo por provider)

O `admin-metrics` já quebra sucesso/falha **por `bot_provider`** (`byProvider`
em `admin-metrics.routes.ts`). A cada degrau, comparar `skribby` vs
`meetingbaas`/`attendee`:

- **join/completion rate:** `completed / total` por provider.
- **failures:** mapa de `failure_reason` por provider (atenção a
  `skribby_transcript_fetch_failed:*`).
- **fellBack:** quantos caíram do Skribby pro fallback.

SQL rápido no Supabase (últimas 24h):
```sql
select bot_provider,
       count(*)                                                as total,
       count(*) filter (where status='completed' and failure_reason is null) as ok,
       count(*) filter (where failure_reason is not null)      as failed
from meetings
where created_at > now() - interval '24 hours'
group by bot_provider order by total desc;
```

---

## Rollback (imediato, sem deploy)

Qualquer sinal ruim → reverter **sem código**:

1. `SKRIBBY_ROLLOUT_PERCENT=0` (para novos dispatches) **ou**
   `SKRIBBY_ENABLED=false` (desliga tudo, webhook volta a ser inerte).
2. Restart do serviço para reler o env.
3. Reuniões já despachadas ao Skribby continuam pelo webhook próprio —
   `SKRIBBY_ENABLED=false` só torna o handler inerte para as **novas**; se
   houver bots Skribby ativos, baixar o rollout mas manter a flag `true` até
   drenarem, depois desligar.

Coluna `skribby_bot_id` e a migration são aditivas — não precisam reverter.

---

## Desligar o MeetingBaaS (só depois de 100% estável)

- [ ] Skribby em 100% e estável por ≥ alguns dias.
- [ ] Cancelar a **assinatura mensal** do MeetingBaaS (a economia real).
- [ ] Manter o `MeetingBaasProvider` no código como fallback de emergência
      até ter confiança plena; remover num commit posterior.

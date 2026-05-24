# Plano — Arquitetura Híbrida de Bots (MeetingBaas + Attendee)

> Status: **proposta para revisão** · Autor: sessão Claude Code · Data: 2026-05-24
>
> Objetivo: (1) destravar o Attendee na Railway para **3 bots simultâneos** (teto do
> plano Hobby — ver Parte A) e (2) criar uma camada de roteamento que divide a carga entre
> **MeetingBaas (maior carga / padrão / overflow)** e **Attendee (menor carga / percentual fixo)**.

---

## ✅ Status de implementação (2026-05-24)

Implementado no lemon.meet, **gated por `ATTENDEE_ENABLED` (default `false`)** — com o flag
desligado o comportamento é idêntico ao atual (100% MeetingBaas). `npx tsc --noEmit` limpo.

**Criados:** `server/scripts/migration-bot-provider.sql`, `server/src/services/bots/{IBotProvider,MeetingBaasProvider,AttendeeProvider,BotRouter,attendeeWebhook}.ts`, `server/src/services/TranscriptPipeline.ts`, `server/src/routes/attendee.routes.ts`.
**Alterados:** `server.ts` (webhook raw-body), `extension.routes.ts` (start/stop), `CalendarCronService.ts` (imediato roteado; agendado/reschedule = MeetingBaas), `admin-metrics.routes.ts` (bloco `providers`), `.env.example`.

- **Contrato validado ao vivo (Attendee 1.38.2, 2026-05-24):** endpoints, transcript, estados e `format:'none'` (transcreve via Deepgram em tempo real sem salvar gravação) confirmados. Deepgram em **`pt-BR`/nova-3**.
- **Correção crítica:** o `ATTENDEE_WEBHOOK_SECRET` é **base64** — a chave HMAC são os bytes **decodificados** (`Buffer.from(secret,'base64')`). Sem isso, todos os webhooks seriam rejeitados. Corrigido e re-validado cross-language (Node ↔ Python) com corpo desordenado e não-ASCII.
- **Visibilidade:** falhas do Attendee gravam `failure_reason` com prefixo `attendee_*` → aparecem no failureBreakdown do painel `/admin/metrics`. Adicionado bloco `providers` (success/failure/active por provider).
- **Testes:** `npm test` → 21 testes (assinatura HMAC, decisão de roteamento, normalização de transcript). Build `tsc --noEmit` limpo. Setup jest ESM criado (`jest.config.js`, `tsconfig.test.json`).

**Feito no lado do Attendee (handoff):** worker em `--concurrency=3`; API key criada; webhook secret obtido; créditos elevados.

**Falta para ligar (por você):** setar as envs `ATTENDEE_*` no backend lemon.meet (valores do handoff) → `ATTENDEE_ENABLED=true`, `ATTENDEE_TRAFFIC_PERCENT=10` → smoke test de 1 reunião real pelo Attendee.

---

## 0. Contexto atual (confirmado no código)

### Attendee (`/Users/pietro_medeiros/Downloads/Attendee`)
- Bot é lançado como **task longa do Celery** (`run_bot.delay`), rodando **inline no processo worker** — sobe Chrome + Xvfb + GStreamer + transcrição dentro do worker (`bots/bot_controller/bot_controller.py:813+`, `bots/web_bot_adapter/web_bot_adapter.py:680-696`).
- O worker sobe **sem `--concurrency`** (`dev.docker-compose.yaml:13`, `Procfile:2`) → pool prefork usa 1 processo por vCPU.
- `CELERY_WORKER_MAX_TASKS_PER_CHILD = 1` no modo celery (`attendee/settings/base.py:202-205`) — recicla o processo após cada bot (workaround do segfault do SDK do Zoom). Não é a trava de concorrência, só adiciona overhead de respawn.
- Não há lock global, display compartilhado ou porta fixa: cada bot cria o próprio Xvfb e o Chrome pega porta dinâmica. **É seguro rodar N bots na mesma máquina.**
- `LAUNCH_BOT_METHOD` (`bots/launch_bot_utils.py:13`): `celery` (default) | `kubernetes` | `docker-compose-multi-host`. Os dois últimos **não servem na Railway** (k8s não existe; multi-host precisa de socket Docker do host).
- ~**2 GB RAM + 1 vCPU por bot** é o orçamento que o próprio projeto assume (`bots/tasks/run_bot_in_ephemeral_container_task.py:69-72`).

**Conclusão:** na Railway o único caminho viável é o **modo `celery`**, e a trava de 1 bot é a concorrência do worker = nº de vCPUs.

### lemon.meet (`/Users/pietro_medeiros/Downloads/lemon.meet`)
- Provider único, cravado: `MeetingBaasService` (`server/src/services/MeetingBaasService.ts`).
- 3 pontos de dispatch:
  1. **Extensão (start manual):** `extension.routes.ts:57` → `sendBot()`. Stop em `:id/stop` lê `baas_bot_id` (`extension.routes.ts:97-99`).
  2. **Cron de calendário (Google tokens):** `CalendarCronService.ts:228-230` → `sendBot()`/`scheduleBotAt()`.
  3. **Calendar-nativo do MeetingBaas:** `meetingbaas.routes.ts:517` (`POST /v2/calendars/{id}/bots`) — **acoplado ao MeetingBaas**, fica como está.
- Webhook MeetingBaas em `meetingbaas.routes.ts` faz: localizar meeting → normalizar transcript → inserir `transcript_segments` → salvar `meetings.transcript` → `insightsService.generateInsights` → `fireWebhookForMeeting` → `gdriveService.saveInsightsToFolder` → `notificationService`. **Essa lógica está duplicada** em `handleComplete` (v1) e `handleBotCompleted` (v2).
- Tabela `meetings` rastreia o bot só por `baas_bot_id` e `baas_event_uuid`. Status usados: `requesting | recording | processing | completed | failed`. `source`: `extension | calendar | in_person`.
- Persistência via Supabase (Postgres). **Sem Redis** no lemon.meet → controle de capacidade do Attendee será via `COUNT` no Postgres (sem nova infra).

---

## 1. Parte A — Destravar 3 bots no Attendee (Railway)

> **Teto = plano Hobby.** O Hobby limita **8 GB RAM / 8 vCPU por serviço**. A ~2 GB/bot,
> isso comporta **3 bots** (3 × ~2 GB + ~1.5 GB de base ≈ 7,5 GB) — fica no limite, com
> pouca folga. Para ir além de 3 (ou ter margem confortável) seria preciso migrar para o Pro.

### Decisão de arquitetura/custo: worker único vertical com `--concurrency=3`

Como o Attendee é a **menor carga** (minoria do tráfego, teto de 3) e o Hobby só tem 8 GB/serviço,
réplicas horizontais nem cabem. Recomendação:

- **1 serviço worker**, comando:
  ```
  celery -A attendee worker -l INFO --concurrency=3 --max-tasks-per-child=1
  ```
- Dimensionar o serviço para usar a cota do Hobby (**até ~8 GB / 8 vCPU**).
- O prefork isola cada bot em um processo separado: um Chrome que trava derruba só o
  próprio filho, e o `--max-tasks-per-child=1` já recicla o processo a cada reunião.

> ⚠️ **Margem apertada:** 3 bots ocupam ~7,5 GB dos 8 GB do Hobby. Monitorar memória —
> se houver OOM/restart, baixar para `--concurrency=2` ou subir para o Pro. O teto vira
> um parâmetro: comece em 3 e ajuste pelo comportamento real.

### Isolamento de recursos: o Attendee compete com o lemon.meet?
- **CPU/RAM:** **Não.** Na Railway os recursos são por **serviço/container**, não por conta. O cap de 8 GB/8 vCPU do Hobby é por serviço. Os 3 Chromes do Attendee rodam no container dele e não disputam CPU/RAM com o backend do lemon. (Inversão útil: hoje os bots do MeetingBaas rodam na nuvem deles, nunca no backend do lemon; mover uma fatia pro Attendee isola esse custo no Attendee.)
- **Pós-processamento:** o backend do lemon baixa transcript + gera insights quando um bot termina — mas isso **já acontece hoje com o MeetingBaas**. O híbrido não adiciona carga; só muda onde o bot roda.
- **Billing da Railway (conta):** ⚠️ compartilhado. Hobby tem orçamento de uso **por conta**; os 3 bots consomem do mesmo saldo. Se houver spend cap e estourar em pico, a Railway pode pausar serviços — **inclusive o backend do lemon**. Monitorar uso/limite da conta.
- **Supabase (mesmo projeto — confirmado: `fzphfdvlsvxqrpwpmfuv`):** ⚠️ compartilhado. As gravações do Attendee consomem storage + egress + conexões do **mesmo** Supabase que serve o lemon.meet. Mitigar com: bucket dedicado, retenção/limpeza (ou não reter gravação — só o transcript via API basta), e a médio prazo projeto/bucket separado.

### Checklist de configuração no repo/serviço do Attendee
- [ ] Garantir `LAUNCH_BOT_METHOD` **vazio ou `celery`** (NÃO `kubernetes`/`docker-compose-multi-host`).
- [ ] Ajustar o start command do worker para `--concurrency=3` (Railway start command ou `Procfile`/compose).
- [ ] Garantir que o serviço worker usa a cota do Hobby (~8 GB / 8 vCPU).
- [ ] Confirmar que **Redis** (broker) e **Postgres** aguentam 3 tasks longas simultâneas.
- [x] **Storage de gravação:** confirmado — **Supabase Storage** via endpoint S3-compatível (`...storage.supabase.co/storage/v1/s3`, região `sa-east-1`). Garantir no serviço deployado que o endpoint custom S3 está setado (ex.: `AWS_S3_ENDPOINT_URL`) além das credenciais.
- [ ] Criar **webhook subscription** no projeto do Attendee apontando para `https://<lemon.meet>/api/attendee/webhook`, eventos `bot.state_change` e `transcript.update` (HMAC com `webhook_secret`).
- [ ] Gerar **API key** do projeto Attendee (header `Authorization: Token <key>`).

> ⚠️ O teto de 3 no Attendee (`--concurrency=3`) **deve bater** com `ATTENDEE_MAX_CONCURRENT=3` no lemon.meet (Parte B). Se um lado mudar, mudar o outro.

---

## 2. Parte B — Camada híbrida no lemon.meet

### 2.1 Abstração de provider
Novo diretório `server/src/services/bots/`:

```ts
// IBotProvider.ts
export type BotProviderName = 'meetingbaas' | 'attendee'

export interface SendBotResult { externalId: string }

export interface IBotProvider {
  readonly name: BotProviderName
  sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<SendBotResult>
  scheduleBotAt?(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<SendBotResult>
  removeBot(externalId: string): Promise<void>
}
```

- **`MeetingBaasProvider`** — adapter fino sobre o `MeetingBaasService` atual (reaproveita `sendBot`/`scheduleBotAt`/`removeBot`, só envelopa o retorno em `{ externalId }`).
- **`AttendeeProvider`** — novo. Chama a REST API do Attendee:
  - `sendBot` → `POST ${ATTENDEE_API_URL}/api/v1/bots`, header `Authorization: Token ${ATTENDEE_API_KEY}`, body `{ meeting_url, bot_name: 'Lemon Notetaker', transcription_settings: { ... } }`. Retorna `{ externalId: resp.id }`.
  - `removeBot` → `POST ${ATTENDEE_API_URL}/api/v1/bots/{id}/leave`.
  - **Sem `scheduleBotAt`** (ver 2.4): bot agendado fica sempre no MeetingBaas.

### 2.2 Router com percentual fixo + teto de capacidade
`server/src/services/bots/BotRouter.ts`:

```
pickProvider({ scheduled }):
  1. se !ATTENDEE_ENABLED  → MeetingBaas
  2. se scheduled          → MeetingBaas        (Attendee só faz join imediato)
  3. roll = random()*100;  se roll >= ATTENDEE_TRAFFIC_PERCENT → MeetingBaas
  4. count = SELECT count(*) FROM meetings
             WHERE bot_provider='attendee'
               AND status IN ('requesting','recording','processing')
     se count >= ATTENDEE_MAX_CONCURRENT → MeetingBaas   (overflow)
  5. senão → Attendee
```

- Split por **percentual fixo** (decisão do produto): `ATTENDEE_TRAFFIC_PERCENT` (ex.: 10).
- O teto (`ATTENDEE_MAX_CONCURRENT=3`) garante que nunca estouramos a capacidade física do Attendee, mesmo que o sorteio mande mais.
- **Fallback de confiabilidade:** se `AttendeeProvider.sendBot` lançar erro (Attendee fora do ar / capacidade), o chamador faz **retry automático no MeetingBaas** — uma reunião nunca falha por causa do Attendee.
- Contagem de capacidade via `COUNT` no Postgres (sem Redis). Sob rajada há uma pequena janela de corrida; aceitável no volume atual. Mitigação futura: advisory lock ou contador atômico.

### 2.3 Schema do banco
Migration `server/scripts/migration-bot-provider.sql`:
```sql
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS bot_provider text NOT NULL DEFAULT 'meetingbaas';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendee_bot_id text;
CREATE INDEX IF NOT EXISTS idx_meetings_provider_status ON meetings (bot_provider, status);
CREATE INDEX IF NOT EXISTS idx_meetings_attendee_bot_id ON meetings (attendee_bot_id);
```
- `baas_bot_id` continua para MeetingBaas; `attendee_bot_id` para Attendee.
- `bot_provider` diz qual API chamar no stop e qual webhook esperar.

### 2.4 Religar os pontos de dispatch
| Ponto | Hoje | Depois |
|---|---|---|
| `extension.routes.ts` `/start` | `meetingBaasService.sendBot` | `botRouter.pickProvider({scheduled:false})` → `provider.sendBot`; grava `bot_provider` + (`baas_bot_id`\|`attendee_bot_id`) |
| `extension.routes.ts` `/:id/stop` | lê `baas_bot_id` → `removeBot` | lê `bot_provider` + id correspondente → provider certo |
| `CalendarCronService.dispatchBotForEvent` (imediato) | `sendBot` | via router (elegível a Attendee) |
| `CalendarCronService` (agendado, `useScheduled`) + `rescheduleBot` | `scheduleBotAt` | **sempre MeetingBaas** |
| `meetingbaas.routes.ts` `handleCalendarSyncEvents` (calendar-nativo) | MeetingBaas | **inalterado — sempre MeetingBaas** |

Resultado: Attendee recebe só **joins imediatos** (extensão + cron imediato), num percentual fixo e capado — exatamente o perfil "menor carga". Agendado/calendar-nativo/overflow ficam no MeetingBaas.

### 2.5 Webhook do Attendee + normalização do transcript
- **Refactor primeiro:** extrair de `meetingbaas.routes.ts` uma função compartilhada
  `runTranscriptPipeline(meeting, segments)` que faz: insert `transcript_segments` →
  update `meetings.transcript`/status → `generateInsights` → `fireWebhookForMeeting` →
  `gdriveService.saveInsightsToFolder` → `notificationService`. Hoje isso está duplicado em
  `handleComplete` e `handleBotCompleted`; passa a ser uma só.
- Nova rota `server/src/routes/attendee.routes.ts` → `POST /api/attendee/webhook`:
  1. Verifica assinatura **HMAC** com `ATTENDEE_WEBHOOK_SECRET`.
  2. Responde `200` na hora; processa em `setImmediate` (mesmo padrão do MeetingBaas).
  3. `bot.state_change`: mapeia estados do Attendee → status do meeting
     (`JOINED_RECORDING`→`recording`; `ENDED`/pós-processamento concluído → busca transcript;
     `FATAL_ERROR`→`failed`). *Nomes exatos dos estados a confirmar na versão deployada.*
  4. Ao finalizar: `GET /api/v1/bots/{id}/transcript` → normaliza utterances
     (`{speaker, timestamp/offset, transcription/text}`) para o formato `ProcessedSegment`
     → chama `runTranscriptPipeline`. Mesmo tratamento downstream do MeetingBaas.

### 2.6 Variáveis de ambiente novas (lemon.meet)
```
ATTENDEE_ENABLED=true
ATTENDEE_API_URL=https://<attendee-na-railway>
ATTENDEE_API_KEY=<token do projeto Attendee>
ATTENDEE_WEBHOOK_SECRET=<secret do webhook>
ATTENDEE_TRAFFIC_PERCENT=10
ATTENDEE_MAX_CONCURRENT=3
ATTENDEE_TRANSCRIPTION_PROVIDER=deepgram   # confirmado no Attendee; labels de speaker podem diferir do Gladia (cosmético)
```

### 2.7 Observabilidade
- Logar provider escolhido por reunião.
- (Opcional) emitir evento PostHog `bot_dispatched` com prop `provider` para acompanhar o split real vs configurado e a taxa de overflow/fallback.

---

## 3. Arquivos a criar / alterar

**Criar**
- `server/src/services/bots/IBotProvider.ts`
- `server/src/services/bots/MeetingBaasProvider.ts`
- `server/src/services/bots/AttendeeProvider.ts`
- `server/src/services/bots/BotRouter.ts`
- `server/src/routes/attendee.routes.ts`
- `server/scripts/migration-bot-provider.sql`

**Alterar**
- `server/src/routes/extension.routes.ts` (`/start`, `/:id/stop`)
- `server/src/services/CalendarCronService.ts` (`dispatchBotForEvent`)
- `server/src/routes/meetingbaas.routes.ts` (extrair `runTranscriptPipeline`)
- registro de rotas (onde as rotas são montadas no Express) → adicionar `/api/attendee`
- `.env.example` / docs de env

---

## 4. Rollout faseado
- **Fase 0 — abstração sem mudar comportamento:** migration + IBotProvider + MeetingBaasProvider + BotRouter (`ATTENDEE_ENABLED=false`). 100% MeetingBaas. Refactor do `runTranscriptPipeline`. Deploy sem risco.
- **Fase 1 — Attendee pronto:** escalar Attendee p/ 5 (Parte A), configurar webhook/API key, `AttendeeProvider` + rota webhook. Testar com `ATTENDEE_TRAFFIC_PERCENT=0` forçando 1 reunião de teste pelo Attendee ponta a ponta (join → transcript → insights → integrações).
- **Fase 2 — ramp:** `ATTENDEE_TRAFFIC_PERCENT` 5 → 10 → 20, monitorando taxa de sucesso, overflow e fallback.
- **Fase 3 — tune:** ajustar percentual/teto conforme custo e estabilidade.

---

## 5. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Formato de transcript/diarização do Attendee difere do MeetingBaas | Normalizador dedicado; validar com payload real na Fase 1 |
| Attendee self-hosted cai / estoura capacidade | Fallback automático para MeetingBaas no dispatch; teto `ATTENDEE_MAX_CONCURRENT` |
| Labels de speaker diferentes entre providers no histórico | Alinhar provider de transcrição (`ATTENDEE_TRANSCRIPTION_PROVIDER`) |
| Corrida na contagem de capacidade sob rajada | Aceitável no volume atual; advisory lock como evolução |
| Bot "preso" em recording sem webhook (Attendee) | Watchdog/reconciliação (follow-up, fora deste plano) |
| Estados exatos do webhook do Attendee | Confirmar nomes na versão deployada antes da Fase 1 |
| Attendee divide a cota do mesmo Supabase do lemon.meet (storage/egress) | Bucket dedicado + retenção/limpeza das gravações; avaliar não reter gravação (só transcript) |
| Billing Hobby por conta — pico do Attendee pode estourar spend cap e pausar serviços | Monitorar uso da conta; alarme de spend; teto `--concurrency`/percentual como freio |

---

## 6. Pendências a confirmar antes de codar
1. ~~Plano da Railway~~ ✅ Confirmado: **Hobby** (8 GB/serviço). Teto definido em **3 bots**
   (`--concurrency=3` + `ATTENDEE_MAX_CONCURRENT=3`). Subir para mais bots exigiria o Pro.
2. ~~Storage de gravação~~ ✅ Confirmado: Supabase Storage (endpoint S3-compatível, `sa-east-1`).
3. ~~Provider de transcrição~~ ✅ Confirmado: **Deepgram**.
4. Percentual inicial de tráfego para o Attendee (sugestão: começar em 10%).

> 🔒 Higiene: o arquivo `.env-inicial` do repo Attendee guarda a secret key do Supabase Storage
> em texto puro e **não** é coberto pelo `.gitignore` (que só ignora `.env`). Adicionar
> `.env-inicial` ao `.gitignore` (ou renomear para `.env`) para evitar commit acidental.

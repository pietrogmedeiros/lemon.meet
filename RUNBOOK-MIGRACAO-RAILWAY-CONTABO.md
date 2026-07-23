# Runbook — Migração do backend Railway → Contabo (EasyPanel)

**Objetivo:** mover o backend (`server`, único serviço na Railway) para a VM
Contabo que roda EasyPanel, cortando o custo do Railway. Frontend e banco
**não** migram.

**Sizing (confirmado):** VM 6 cores / 11.7 GB RAM / 193 GB disco, ~8.5 GB RAM
livres. Pós-limpeza do Chromium (commit `64d6fe1`) o backend é Node API puro
(~512 MB–1 GB). Cabe com folga. Limitar em `1 GB` pra conviver com os outros
projetos da box.

---

## Escopo — o que migra e o que NÃO migra

| Componente | Onde está hoje | Ação |
|---|---|---|
| **Backend `server`** | Railway (Docker) | **MIGRA** → EasyPanel |
| **Banco / Auth / Storage** | Supabase (gerenciado) | **Fica.** Zero migração de dados |
| **Frontend `web`** | Firebase Hosting | **Fica.** Só aponta pra nova URL do backend |
| **Providers de bot** | MeetingBaaS/Attendee/Skribby (SaaS) | **Ficam.** Webhook segue `SERVER_URL` |

Não há volume persistente a transferir (disco só guarda scratch efêmero).

---

## ⚠️ O ponto que quebra tudo se esquecer: `SERVER_URL`

`SERVER_URL` é embutido em **7 URLs externas**. Trocar de domínio exige acertar
a env **e** re-apontar no provedor onde marcado 🔧:

| URL gerada | Fonte | Re-apontar no provedor? |
|---|---|---|
| `…/api/meetingbaas/webhook` | `SERVER_URL` no payload do bot | ❌ automático (segue a env) |
| `…/api/attendee/webhook` | idem | ❌ automático |
| `…/api/skribby/webhook` | idem | ❌ automático |
| `…/api/gdrive/oauth/callback` | `SERVER_URL` | 🔧 **Google Cloud Console** |
| `…/api/calendar/oauth/callback` | `SERVER_URL` | 🔧 **Google Cloud Console** |
| `…/api/pipedrive/callback` | `SERVER_URL` | 🔧 **App Pipedrive** |
| `…/api/hubspot/callback` | `SERVER_URL` | 🔧 **App HubSpot** |
| Webhook de pagamento | configurado no painel | 🔧 **AbacatePay** |

> **Gotcha Railway:** `gdrive.routes.ts` prioriza `RAILWAY_PUBLIC_DOMAIN` (auto
> na Railway) e só cai pra `SERVER_URL` se ela não existir. Na Contabo essa var
> não existe → **`SERVER_URL` PRECISA estar setada e correta**, senão cai no
> fallback hardcoded da URL antiga da Railway e o OAuth do Drive quebra.

---

## Fase 0 — Pré-flight

- [x] Domínio do backend definido: **`api.lemon-meet.com`**.
- [ ] Exportar **todas** as env vars atuais do painel Railway (Variables → copiar).
- [ ] Confirmar que a Contabo/EasyPanel tem RAM livre pro limite de 1 GB (tem).
- [ ] Ter à mão acessos: Google Cloud Console, Pipedrive app, HubSpot app,
      AbacatePay, DNS do domínio.

---

## Fase 1 — Criar o app no EasyPanel (server only)

1. No EasyPanel → **Create App** (no projeto que preferir, ex. `lemon`).
2. **Source = GitHub** apontando pro repo da Lemon (branch `main`).
3. **Build:**
   - Método: **Dockerfile**
   - Build context / root: **`/`** (a raiz do monorepo — o Dockerfile faz
     `COPY pnpm-workspace.yaml`, `web/package.json` etc.)
   - Dockerfile path: **`server/Dockerfile`**
4. **Deploy / recursos:**
   - Port interno: **3000**
   - Replicas: **1** ⚠️ (ver gotcha do cron — não escalar)
   - Memory limit: **1 GB** (CPU: pode limitar a 2–3 cores)
   - Health check path: **`/health`** (já existe, retorna 200)
5. **Ainda NÃO** ligue o domínio público — subir primeiro com env e validar
   o health interno.

---

## Fase 2 — Variáveis de ambiente

Colar no painel de Environment do EasyPanel. Lista completa (37 vars lidas no
código). **Não** setar `RAILWAY_PUBLIC_DOMAIN` nem `RAILWAY_ENVIRONMENT_NAME`
(eram auto da Railway).

**Core / infra**
```
NODE_ENV=production
PORT=3000
SERVER_URL=https://api.lemon-meet.com          # ← a NOVA URL pública (crítico)
FRONTEND_URL=https://lemon-meet.web.app
```
**Supabase** (⚠️ conferir nome: código lê `SUPABASE_SERVICE_ROLE_KEY` e
`SUPABASE_ANON_KEY`; o .env.example antigo cita `SUPABASE_SERVICE_KEY`.
Setar as três pra não quebrar):
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SERVICE_KEY=
```
**IA / transcrição**
```
GROQ_API_KEY=
DEEPSEEK_API_KEY=
```
**Bot providers** (manter o estado atual — Skribby ainda dark):
```
MEETINGBAAS_API_KEY=
ATTENDEE_ENABLED=false
ATTENDEE_API_URL=
ATTENDEE_API_KEY=
ATTENDEE_WEBHOOK_SECRET=
ATTENDEE_TRAFFIC_PERCENT=10
ATTENDEE_MAX_CONCURRENT=3
ATTENDEE_DEEPGRAM_LANGUAGE=pt-BR
SKRIBBY_ENABLED=false
SKRIBBY_API_URL=
SKRIBBY_API_KEY=
SKRIBBY_WEBHOOK_SECRET=
SKRIBBY_ROLLOUT_PERCENT=0
SKRIBBY_LANGUAGE=pt-BR
```
**Integrações OAuth**
```
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
PIPEDRIVE_CLIENT_ID=
PIPEDRIVE_CLIENT_SECRET=
LEMON_CRM_URL=
```
**Pagamentos (AbacatePay)**
```
ABACATEPAY_API_KEY=
ABACATEPAY_WEBHOOK_SECRET=
ABACATEPAY_PRODUCT_ID_STARTER=
ABACATEPAY_PRODUCT_ID_PROFESSIONAL=
```
**Ops**
```
ADMIN_METRICS_KEY=
ALERT_ADMIN_USER_ID=
CALENDAR_CRON_ENABLED=true      # (ou omitir DISABLE_CALENDAR_CRON)
```

- [ ] Deploy. Ver logs: deve subir, imprimir o banner e responder `/health`.

---

## Fase 3 — Domínio + TLS

1. **DNS:** criar `A` record `api.lemon-meet.com` → IP da Contabo.
2. No EasyPanel → app → **Domains** → adicionar `api.lemon-meet.com`.
   O EasyPanel provisiona **TLS (Let's Encrypt) e o proxy automaticamente**;
   WebSocket (Socket.IO) passa transparente. Sem Caddy/nginx manual.
3. Confirmar `https://api.lemon-meet.com/health` → 200 de fora.

---

## Fase 4 — Re-apontar integrações externas (o trabalho manual crítico)

Fazer **antes** do cutover de tráfego. Adicionar as **novas** URLs (sem
remover as antigas ainda, pra permitir rollback):

- [ ] **Google Cloud Console** (mesmo OAuth client do Calendar/Drive) →
      Credentials → Authorized redirect URIs, **adicionar**:
      - `https://api.lemon-meet.com/api/gdrive/oauth/callback`
      - `https://api.lemon-meet.com/api/calendar/oauth/callback`
- [ ] **Pipedrive app** → redirect URL: `https://api.lemon-meet.com/api/pipedrive/callback`
- [ ] **HubSpot app** → redirect URL: `https://api.lemon-meet.com/api/hubspot/callback`
- [ ] **AbacatePay** → webhook URL: `https://api.lemon-meet.com/api/subscription/webhook`
      (confirmar/rotacionar o `ABACATEPAY_WEBHOOK_SECRET` se o painel gerar novo).
- [ ] **MeetingBaaS / Skribby / Attendee:** nada a fazer — o `webhook_url` é
      enviado no payload de cada bot e já seguirá o novo `SERVER_URL`.

---

## Fase 5 — Cutover

Estratégia: rodar **em paralelo** (Railway ainda de pé) e virar o front por último.

1. [ ] Smoke test direto no novo backend (`api.lemon-meet.com`):
   - [ ] `/health` 200.
   - [ ] Login/sessão (Supabase) funciona.
   - [ ] Conectar **Google Drive** e **Calendar** (testa os 2 OAuth novos).
   - [ ] Conectar **HubSpot** e **Pipedrive**.
   - [ ] Disparar **1 reunião real** → bot entra, webhook do provider chega no
         novo host, transcript grava.
   - [ ] Um pagamento de teste no AbacatePay → webhook chega e processa.
   - [ ] `/admin/metrics` responde com o `ADMIN_METRICS_KEY`.
2. [ ] Apontar o frontend pro novo backend: `VITE_API_URL` do build do `web`
       (Firebase) para `https://api.lemon-meet.com` e **redeploy do Firebase**.
       (Conferir também `SOCKET_IO_CORS_ORIGIN`/CORS aceitando o domínio do front.)
3. [ ] Observar logs + `/admin/metrics` por algumas horas.

---

## Rollback (rápido)

- Front ainda aponta pra Railway? Basta **não** ter feito o redeploy do passo 5.2.
- Se já virou: reverter `VITE_API_URL` p/ a URL Railway e redeploy do Firebase.
- Railway permanece intacta até a Fase 6. As URLs OAuth antigas continuam
  registradas (não removidas), então o fluxo legado segue funcionando.

---

## Fase 6 — Desligar a Railway (só após dias estáveis)

- [ ] Backend Contabo estável por ≥ 2–3 dias, integrações OK.
- [ ] Remover o serviço/deploy na Railway.
- [ ] Limpar do Google/Pipedrive/HubSpot os redirect URIs **antigos** da Railway.
- [ ] Opcional no código: remover o fallback hardcoded da URL Railway em
      `gdrive.routes.ts`, `AttendeeProvider.ts`, `SkribbyProvider.ts`,
      `MeetingBaasService.ts` (trocar por erro se `SERVER_URL` ausente).

---

## Gotchas (resumo)

1. **`SERVER_URL` obrigatória e correta** — sem ela, `gdrive` cai no fallback
   Railway hardcoded e o OAuth do Drive quebra.
2. **Replicas = 1** — o `CalendarCronService` roda in-process; 2+ instâncias
   duplicam disparos de bot. Não escalar horizontalmente sem lock externo.
3. **Nome da service key do Supabase** — código usa `SUPABASE_SERVICE_ROLE_KEY`;
   setar essa (e a `SERVICE_KEY` por segurança) pra não subir sem credencial.
4. **ffmpeg no PATH** — mantido no Dockerfile (transcode Whisper). Não remover.
5. **Build context = raiz** do monorepo (Dockerfile depende de arquivos fora
   de `server/`).
6. **Deploy on push:** EasyPanel refaz build a cada push no branch — isso
   substitui o auto-deploy da Railway. Confirmar o branch certo.

# Plano — Round Robin não reflete as agendas reais

**Status:** Fases 1 e 3 IMPLEMENTADAS em 2026-08-09 (+ um 7º defeito descoberto
na hora, ver abaixo). Falta a Fase 2 (working_hours por membro) e o **deploy**.
**Levantado em:** 2026-08-09 · **Arquivo-alvo:** `server/src/routes/scheduling.routes.ts`

> ⚠️ **Ainda não está em produção.** O deploy do backend está travado desde
> 03/08 (o GitHub Actions parou de criar runs). Rodar a migration
> `scripts/migration-scheduling-timezone.sql` no Supabase e implantar no EasyPanel.

**Sintoma relatado:** a página pública de agendamento não reflete os horários/dias
realmente livres dos membros do time configurados no round-robin.

---

## Diagnóstico — 6 defeitos

### 1. Fuso horário (causa raiz)

Não existe nenhum conceito de timezone no arquivo. O container roda em **UTC**
(sem `TZ` no Dockerfile) e a geração de slot faz:

```js
new Date(`${date}T${slotStart}:00`)   // sem sufixo de fuso
```

Sem sufixo, o Node interpreta no fuso do processo. O `working_hours` "09:00–18:00",
configurado pensando em Brasília, é aplicado como **09:00–18:00 UTC = 06:00–15:00 BRT**.
Os eventos do Google, por outro lado, voltam com offset real (`-03:00`) e são
convertidos corretamente. Grade e compromissos ficam em referenciais diferentes,
deslocados em 3h.

### 2. Janela de busca no Google é UTC, não o dia local

`timeMin=${date}T00:00:00Z` / `timeMax=${date}T23:59:59Z`. Para UTC-3, isso pega
parte do dia anterior e perde o fim do dia pedido.

### 3. Membro sem calendário aparece como 100% livre (fail-open)

O comentário diz o oposto do que o código faz:

```js
// Membro sem calendário - considera todos os horários como ocupados
memberEvents[member.user_id] = []      // [] = nenhum evento = totalmente LIVRE
```

Mesmo efeito quando a API do Google falha (`catch` → `[]`) ou responde não-OK.
Na dúvida, o sistema oferece o horário.

### 4. A atribuição ignora quem estava livre

O slot aparece se **algum** membro está livre (`members.some(...)`), mas a reserva faz:

```js
const currentIndex = config.current_rotation_index % members.length
const assignedMember = members[currentIndex]
```

Rotação cega, sem reconferir agenda. Dá para reservar um horário que apareceu
porque a Ana estava livre e o convite cair para o Bruno, que está ocupado.

### 5. Eventos "Livre" e convites recusados bloqueiam

Sem filtro por `transparency: 'transparent'` nem por `responseStatus: 'declined'`.
Um bloco informativo marcado como *Livre* no Google derruba o horário.

### 7. `working_hours` era ZERADO a cada save — o sintoma real em produção

Descoberto ao conferir os dados reais: a única config existente
(`starbem-comercial`, ativa) estava com `working_hours = {}`, e a API pública
devolvia `{"slots":[]}` para **toda** data — a página não mostrava horário nenhum.

Cadeia: a tela de config (`web/src/pages/TeamSchedulingPage.tsx`) envia só
`slug/title/description/meeting_duration_minutes/is_active` — nunca
`working_hours`. O upsert fazia `working_hours: working_hours || {}`, então cada
save zerava o campo. Sem horário de funcionamento, zero slot.

**Corrigido:** o upsert preserva o valor salvo quando a request não manda o campo,
e semeia `DEFAULT_WORKING_HOURS` (seg–sex 09:00–18:00) quando o time nunca definiu.
Falta ainda a UI de edição (Fase 2).

### 6. `working_hours` é do time, não por pessoa

Está em `team_scheduling_config`; `team_scheduling_members` só tem
`user_id`, `rotation_order`, `is_active`, `total_bookings`. Não há como refletir
o horário/dia de cada usuário — que é exatamente o pedido.

---

## Plano

### Fase 1 — correção (resolve o sintoma)
1. Timezone explícito na config (default `America/Sao_Paulo`); montar slots e a
   janela do Google no fuso certo, comparando tudo em UTC
2. **Fail-closed**: sem calendário conectado ou erro na API → membro indisponível
3. Disponibilidade por membro: o endpoint devolve **quem** está livre em cada slot,
   e a reserva escolhe entre os elegíveis mantendo o rodízio justo
4. Respeitar `transparency`, convites recusados e eventos de dia inteiro

### Fase 2 — o pedido original
5. `working_hours` por membro (migration + UI), com o horário do time como padrão

### Fase 3 — prova
6. Testes de unidade nas funções puras (slots, overlap, conversão de fuso) e
   verificação contra agenda real: bloquear um horário no Google e confirmar que
   ele some da página pública

---

## ⚠️ Decisão pendente (do Pietro, antes de começar)

Corrigir o fuso **muda os horários exibidos hoje**. As configs existentes foram
salvas assumindo o comportamento errado. Duas saídas:

- **(a)** migrar os valores das configs existentes, preservando o que aparece hoje
- **(b)** assumir que "09:00" sempre quis dizer 09:00 local e deixar a correção
  mudar o que é exibido

Sem essa definição, a Fase 1 não deve começar.

---

## Contexto útil pra quem pegar

- Endpoint: `GET /api/scheduling/public/:slug/availability` (~linha 578)
- Criação da reserva: `POST` da mesma rota (~linha 770)
- Helpers: `generateTimeSlots` e `doTimesOverlap` (~linha 728) — são funções puras,
  ótimo ponto de entrada pros testes
- Backend roda em Lauterbourg/FR (Contabo) e os usuários estão no Brasil; qualquer
  raciocínio de horário tem que ser explícito, nunca depender do fuso do processo

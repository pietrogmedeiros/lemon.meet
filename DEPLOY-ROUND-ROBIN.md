# ⚠️ Deploy Round Robin Scheduling - CHECKLIST PRODUÇÃO

**Data:** 15 de maio de 2026  
**Feature:** Agendamento de Time com Round Robin  
**Risco:** 🟡 MÉDIO - Adiciona novas tabelas e rotas, não afeta código existente

---

## 📋 PRÉ-REQUISITOS

- ✅ Código revisado e testado localmente
- ✅ Migration preparada e validada
- ✅ Arquivos novos sem hardcoded URLs
- ✅ Zero erros TypeScript
- ⚠️ **NENHUM código de Customer Success incluído**

---

## 🔢 ORDEM DE EXECUÇÃO (IMPORTANTE!)

### **ETAPA 1: Executar Migration no Supabase Produção**
⏱️ **FAZER PRIMEIRO - ANTES DO DEPLOY DE CÓDIGO**

1. Acesse: https://supabase.com/dashboard/project/[SEU_PROJECT_ID]/editor
2. Abra o arquivo: `server/scripts/migration-team-scheduling-round-robin.sql`
3. Copie TODO o conteúdo (425 linhas)
4. Cole no SQL Editor do Supabase
5. **Revise visualmente** antes de executar
6. Execute a migration
7. **Verifique se criou as 3 tabelas:**
   - ✅ `team_scheduling_config` (com coluna `logo_url`)
   - ✅ `team_scheduling_members`
   - ✅ `team_bookings`

**⚠️ SE DER ERRO NA MIGRATION:**
- NÃO prossiga com o deploy
- Reverta qualquer mudança parcial
- Corrija o problema antes de continuar

---

### **ETAPA 2: Deploy do Backend (Railway)**

**Arquivos modificados:**
- ✅ `server/src/server.ts` - Adiciona rota `/api/scheduling`
- ✅ `server/src/routes/scheduling.routes.ts` - **NOVO ARQUIVO**

**Comandos:**
```bash
git add server/src/server.ts server/src/routes/scheduling.routes.ts
git commit -m "feat: add team scheduling round robin backend routes"
git push origin main
```

**Verificação:**
```bash
# Após deploy, testar:
curl https://[SEU_BACKEND].railway.app/health
# Deve retornar: {"status":"ok"}
```

---

### **ETAPA 3: Deploy do Frontend (Firebase Hosting)**

**Arquivos modificados:**
- ✅ `web/src/App.tsx` - Adiciona rotas `/teams/:teamId/scheduling` e `/agenda/:slug`
- ✅ `web/src/pages/TeamSchedulingPage.tsx` - **NOVO ARQUIVO**
- ✅ `web/src/pages/PublicSchedulingPage.tsx` - **NOVO ARQUIVO**

**Comandos:**
```bash
cd web
npm run build
firebase deploy --only hosting
```

**Verificação:**
```bash
# Acessar:
https://[SEU_APP].web.app/login
# Deve carregar normalmente (sem erros no console)
```

---

### **ETAPA 4: Configurar Storage Bucket (Supabase)**

**⚠️ IMPORTANTE:** Bucket `public-assets` precisa existir para upload de logos

1. Acesse: https://supabase.com/dashboard/project/[SEU_PROJECT_ID]/storage/buckets
2. Verifique se bucket `public-assets` existe
3. **SE NÃO EXISTIR:**
   - Crie novo bucket chamado `public-assets`
   - Marque como **Public bucket**
   - Policies: Permitir leitura pública

---

### **ETAPA 5: Teste End-to-End em Produção**

**Teste 1: Criar Configuração de Agendamento**
1. Login como owner de um time
2. Acessar: `/team` → "Agendamento Round Robin"
3. Preencher: Slug, título, descrição, horários
4. Fazer upload de logo (PNG/JPEG)
5. Ativar membros para rotação
6. Salvar configuração
7. **Verificar:** Status = "Ativo"

**Teste 2: Acessar Link Público**
1. Copiar link público: `/agenda/[seu-slug]`
2. Abrir em aba anônima
3. **Verificar:**
   - ✅ Logo aparece
   - ✅ Calendário carrega
   - ✅ Horários disponíveis aparecem
   - ✅ Formulário de agendamento funciona

**Teste 3: Fazer Agendamento**
1. Selecionar data e horário
2. Preencher dados do visitante
3. Confirmar agendamento
4. **Verificar:**
   - ✅ Confirmação aparece
   - ✅ Email de confirmação enviado (verificar logs)
   - ✅ Agendamento aparece na lista do membro atribuído

**Teste 4: Round Robin Funciona**
1. Fazer 3 agendamentos seguidos
2. **Verificar:** Membros diferentes são atribuídos em ordem
3. Fazer 4º agendamento
4. **Verificar:** Volta para o primeiro membro (rotação completa)

---

## 🚨 ROLLBACK (SE ALGO DER ERRADO)

### Rollback do Frontend:
```bash
cd web
firebase hosting:clone [SEU_APP]:live [SEU_APP]:rollback
```

### Rollback do Backend:
```bash
git revert HEAD
git push origin main
```

### Rollback da Migration:
```sql
-- Executar no Supabase SQL Editor:
DROP TABLE IF EXISTS team_bookings CASCADE;
DROP TABLE IF EXISTS team_scheduling_members CASCADE;
DROP TABLE IF EXISTS team_scheduling_config CASCADE;
```

---

## ✅ CHECKLIST FINAL

Antes de considerar o deploy concluído:

- [ ] Migration executada sem erros
- [ ] 3 tabelas criadas no banco
- [ ] Backend deployado e `/health` respondendo
- [ ] Frontend deployado e login funcionando
- [ ] Bucket `public-assets` configurado
- [ ] Teste end-to-end completo
- [ ] Round Robin funcionando (rotação de membros)
- [ ] Nenhum erro no console do browser
- [ ] Nenhum erro nos logs do backend

---

## 📝 NOTAS IMPORTANTES

1. **URLs Dinâmicas:** Código usa `import.meta.env.VITE_API_URL` e fallback para localhost (funciona em dev e prod)
2. **Storage:** Logo URL salva com domínio real do Supabase (não localhost)
3. **RLS:** Policies configuradas para acesso público às páginas de agendamento
4. **Sem Breaking Changes:** Feature totalmente nova, não afeta código existente
5. **Customer Success:** TODO código de CS foi excluído desta branch

---

## 🆘 CONTATOS DE EMERGÊNCIA

Se algo der errado durante o deploy:
- **Rollback imediatamente** usando os comandos acima
- **Não tente corrigir em produção**
- Reverta tudo e teste localmente antes de tentar novamente

---

**✅ BOA SORTE!** 🚀

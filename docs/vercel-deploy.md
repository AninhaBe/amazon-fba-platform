# Deploy do SellerCore na Vercel

O Render deve permanecer ligado durante toda a migração. A troca das URLs externas
só acontece depois que o deploy da Vercel estiver validado.

## 1. Criar e importar o projeto

1. Crie uma equipe no plano **Pro** da Vercel. O SellerCore é uma aplicação
   comercial e o cron a cada cinco minutos não é aceito no plano Hobby.
2. Em **Add New > Project**, importe o repositório GitHub do SellerCore.
3. Mantenha o preset **Next.js**, a raiz do repositório e os comandos detectados.
4. O arquivo `vercel.json` já configura as funções em São Paulo (`gru1`) e o
   cron do Mercado Livre.

## 2. Variáveis de ambiente

Copie para **Settings > Environment Variables** as variáveis do Render, para os
ambientes Production e Preview. Não configure `DATA_DIR`: a Vercel não possui disco
persistente e os dados de produção ficam no PostgreSQL.

Crie também `CRON_SECRET` com um valor aleatório longo. Não reutilize credenciais de
marketplace. Como credenciais foram expostas durante a configuração, gere novos
valores para a senha do banco, `INTEGRATION_TOKEN_KEY`, `MELI_CLIENT_SECRET` e os
segredos OAuth antes de concluir a migração.

Na Vercel, use em `DATABASE_URL` a URI **Transaction pooler** copiada em
**Supabase > Connect** (porta `6543`), indicada para funções serverless. Não altere
somente a porta manualmente; copie a URI completa oferecida pelo Supabase.

No primeiro deploy, `APP_BASE_URL` pode ficar temporariamente vazio. Depois que a
Vercel mostrar o domínio de produção, defina a variável como a origem HTTPS, sem barra
no final, e faça um novo deploy.

## 3. Validar antes da troca

1. Abra `/api/health` no domínio da Vercel e confirme `{"ok":true}`.
2. Entre na aplicação, abra o dashboard e confirme que os dados existentes aparecem.
3. Em **Settings > Cron Jobs**, confirme o job `/api/cron/mercado-livre-sync`.
4. Teste o endpoint do webhook com `GET /api/webhooks/mercado-livre`.

## 4. Atualizar URLs externas

Substitua `https://DOMINIO_VERCEL` pelo domínio final:

- Supabase Auth Redirect URLs: `https://DOMINIO_VERCEL/auth/confirm`
- Mercado Livre Redirect URI: `https://DOMINIO_VERCEL/api/integrations/mercado-livre/callback`
- Mercado Livre URL de notificações: `https://DOMINIO_VERCEL/api/webhooks/mercado-livre`
- Amazon SP-API OAuth callback: `https://DOMINIO_VERCEL/api/auth/callback`
- TikTok Shop Redirect URL: `https://DOMINIO_VERCEL/api/tiktok/callback`

Atualize somente as integrações que estiverem configuradas. Após cada alteração,
faça um teste real de conexão/retorno.

## 5. Corte e rollback

Quando login, dashboard, cron e webhooks estiverem validados, passe o tráfego para o
domínio final. Mantenha o Render ativo por alguns dias para rollback, mas não deixe os
dois crons processando a mesma carga. O Render pode ser desligado somente depois da
estabilização.

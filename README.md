# FBA Suite — Calculadora de lucro + Monitor da conta

Plataforma em Next.js que usa a **Amazon Selling Partner API (SP-API)** para:

- **Calculadora de lucro FBA** — estima as taxas reais da Amazon (Product Fees API v0) para um ASIN e calcula lucro líquido, margem e ROI.
- **Monitor da conta** — lista os pedidos recentes da sua conta (Orders API v0) com faturamento, pedidos FBA e itens a enviar.

## Como rodar

1. Preencha o arquivo `.env.local` com suas credenciais LWA (nunca comite esse arquivo):

   ```
   LWA_CLIENT_ID=...
   LWA_CLIENT_SECRET=...
   LWA_REFRESH_TOKEN=...
   SPAPI_REGION=NA                      # Brasil fica na região NA
   DEFAULT_MARKETPLACE_ID=A2Q3Y263D00KWC # Brasil
   SPAPI_USE_SANDBOX=false
   ```

2. Instale e rode:

   ```bash
   npm install
   npm run dev
   ```

3. Acesse http://localhost:3000

## Onde pegar as credenciais

No **Seller Central → Apps & Services → Develop Apps** você registra um app SP-API e obtém `client_id` e `client_secret`. O `refresh_token` vem do fluxo de autorização (self-authorization gera um token direto para sua própria conta).

## Estrutura

| Arquivo | Papel |
|---|---|
| `src/lib/spapi.ts` | Cliente base: renova o `access_token` via LWA e faz as chamadas autenticadas |
| `src/lib/fees.ts` | Product Fees API + cálculo de lucro/margem/ROI |
| `src/lib/orders.ts` | Orders API + resumo de métricas |
| `src/app/api/fees/route.ts` | Endpoint POST usado pela calculadora |
| `src/app/api/orders/route.ts` | Endpoint GET usado pelo monitor |
| `src/app/page.tsx` | UI da calculadora |
| `src/app/monitor/page.tsx` | UI do monitor de pedidos |

## Notas sobre a SP-API

- A Amazon **descontinuou** a exigência de assinatura AWS SigV4 / role IAM. Hoje basta o token LWA no header `x-amz-access-token`.
- O `access_token` expira em ~1h; o cliente renova automaticamente e mantém cache em memória.
- Para testar sem afetar produção, use `SPAPI_USE_SANDBOX=true` (respostas de exemplo fixas da Amazon).

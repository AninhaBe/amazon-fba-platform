# Arquitetura multicanal do SellerCore

## Objetivo

Amazon, Mercado Livre, TikTok Shop e Shopee são conectores. O domínio do SellerCore não deve usar nomes ou formatos específicos desses provedores fora de seus adaptadores.

```text
APIs externas
  Amazon | Mercado Livre | TikTok Shop | Shopee
                    ↓
        adaptadores por provedor
                    ↓
 catálogo | pedidos | estoque | financeiro | tráfego
                    ↓
       APIs e telas do SellerCore
```

## Identidade das entidades

Nunca usar somente SKU, ASIN, item ID ou order ID como chave global. Toda entidade sincronizada deve possuir:

- `provider`: `amazon`, `mercado_livre`, `tiktok_shop` ou `shopee`;
- `connection_id`: conta/loja que é dona do dado;
- `external_id`: identificador recebido do canal;
- `id`: chave composta estável, como `mercado_livre:123456:MLB987654`.

Custos podem ser associados a um produto canônico interno e compartilhados entre anúncios equivalentes em canais diferentes. O vínculo não deve assumir que SKU é globalmente único.

## Contratos comuns

Cada adaptador deve evoluir para implementar contratos equivalentes:

```ts
interface ChannelAdapter {
  getAccount(): Promise<ChannelAccount>;
  listProducts(cursor?: string): Promise<Page<ChannelProduct>>;
  listOrders(period: Period, cursor?: string): Promise<Page<ChannelOrder>>;
  getInventory(): Promise<ChannelInventory[]>;
  getFinancialEvents?(period: Period): Promise<ChannelFinancialEvent[]>;
  getTraffic?(period: Period): Promise<ChannelTraffic[]>;
}
```

Recursos opcionais devem ser declarados como capacidades. Uma tela consolidada não pode interpretar ausência de uma capacidade como valor zero.

## Workspaces e navegação

O produto possui contextos visuais e operacionais por canal:

- `/`: visão geral, com indicadores normalizados de todos os canais conectados;
- `/amazon/*`: menu, conta ativa e funcionalidades específicas da Amazon;
- `/mercado-livre/*`: menu, conta ativa e funcionalidades específicas do Mercado Livre.
- `/tiktok/*`: overview e módulos canônicos da TikTok Shop por loja conectada;
- `/shopee/*`: interface e conector implementados, ainda sem validação em loja
  real enquanto o Go Live depende da Shopee.

O SellerCore mantém tipografia, superfícies e componentes. Cada contexto altera
somente o acento de canal; TikTok e Shopee possuem seus próprios tokens visuais.

Rotas antigas da Amazon continuam disponíveis durante a migração. Novos links devem apontar para `/amazon/*`.

## Conexões e tokens

A tabela `integrations` é o registro comum das conexões. Tokens são criptografados em produção com `INTEGRATION_TOKEN_KEY`. O frontend recebe somente metadados públicos; tokens nunca são serializados pelas APIs do SellerCore.

O Mercado Livre rotaciona o refresh token: somente o último pode ser usado e ele é de uso único. O cliente implementa renovação serializada por conexão para evitar duas renovações concorrentes.

Variáveis necessárias para habilitar o primeiro conector:

```env
APP_BASE_URL=http://localhost:3000
INTEGRATION_TOKEN_KEY=<chave aleatória com pelo menos 32 caracteres>
OAUTH_REFRESH_FINGERPRINT_SECRET=<segredo aleatório independente, mínimo 32 bytes>
MELI_CLIENT_ID=<app-id do Mercado Livre>
MELI_CLIENT_SECRET=<secret-key do Mercado Livre>
```

`OAUTH_REFRESH_FINGERPRINT_SECRET` chaveia o HMAC-SHA-256 com separação de
domínio usado para identificar grants na tabela de leases. Nunca use o token,
seu ciphertext ou hash simples. Ele só é exigido quando uma operação de refresh
ou limpeza de lease realmente roda; build e testes comuns não dependem dele.

No cadastro do aplicativo, a Redirect URI deve ser exatamente
`<APP_BASE_URL>/api/integrations/mercado-livre/callback` e o PKCE deve estar habilitado.

## Mercado Livre Brasil e Global Selling

- Mercado Livre Brasil usa autorização em `auth.mercadolivre.com.br`, conta local e recursos como `/orders/search` e `/users/{id}/items/search`.
- Global Selling possui usuário global, contas de marketplace e recursos `/marketplace/*`.
- Ambos usam o provider `mercado_livre`, diferenciados pelo campo `mode`: `local` ou `global_selling`.

A primeira implementação é `local`/`MLB`. O modo Global Selling deve ganhar um adaptador próprio, sem condicionais espalhadas nas telas.

## Sincronização

1. Fazer carga inicial paginada após o OAuth.
2. Persistir cursor e horário da última sincronização por entidade.
3. Receber webhooks e responder HTTP 200 rapidamente.
4. Enfileirar o processamento e buscar o recurso indicado pelo webhook.
5. Executar reconciliação periódica para recuperar eventos perdidos.

Webhooks aceleram atualizações, mas não substituem reconciliação. A interface deve exibir `updated_at` e distinguir dado indisponível de valor zero.

## Sequência recomendada

1. Mercado Livre: OAuth, conta, anúncios e pedidos.
2. Normalizar o dashboard, Produtos e Monitor sobre `ChannelAdapter`.
3. ~~Migrar o conector TikTok existente para `integrations`.~~ Concluído:
   sync, scheduler/cron, leitura canônica e módulos estão implementados; a
   validação financeira real permanece parcial.
4. Adicionar webhooks e jobs incrementais.
5. ~~Implementar Shopee no mesmo contrato.~~ Concluído: OAuth, sync paginado,
   persistência canônica, scheduler/cron, overview e módulos estão
   implementados e testados em sandbox; a validação Live aguarda aprovação do
   Go Live, credenciais de produção e autorização de uma loja real.
6. Criar visão consolidada e filtro por canal/conta.

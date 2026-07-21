# Contexto de desenvolvimento — Central de Anúncios Amazon

Última atualização: 21/07/2026 (America/Sao_Paulo)

## Objetivo atual

Criar dentro do SellerCore uma Central de Anúncios da Amazon que permita montar, validar e publicar listings pela SP-API sem depender dos formulários fragmentados do Seller Central.

O fluxo está sendo construído para dois casos:

1. **Vender um produto já existente no catálogo**: localizar o produto por ASIN e publicar apenas a oferta do vendedor.
2. **Criar um produto novo**: escolher o tipo de produto, preencher conteúdo e identificação, configurar oferta/variações e publicar o listing completo.

## Estado do repositório

- Branch: `main`
- Commit-base local/remoto: `608995d` (`fix: acelerar sincronizacao do mercado livre`)
- As mudanças desta funcionalidade ainda **não foram commitadas**.
- Estado observado antes da criação deste documento:

```text
 M src/app/components/Nav.tsx
 M src/app/globals.css
?? src/app/amazon/anuncios/
?? src/app/api/amazon/
?? src/lib/amazonListingBuilder.ts
```

O fechamento do terminal não removeu nenhuma dessas alterações.

## Arquivos da funcionalidade

### `src/app/amazon/anuncios/page.tsx`

Página client-side e assistente visual. Mantém o rascunho apenas no estado React; ainda não existe persistência de rascunhos.

Fluxo de produto existente:

1. Recebe e valida o formato do ASIN.
2. Consulta catálogo, tipo de produto e restrições da conta.
3. Recebe SKU, preço, condição, logística e quantidade quando for FBM.
4. Exibe revisão.
5. Exige uma pré-validação aceita pela Amazon antes de habilitar a publicação.

Fluxo de produto novo:

1. Pesquisa tipos de produto por palavras-chave.
2. Busca a definição e o schema atual da categoria na Amazon.
3. Recebe SKU, marca, título, fabricante, origem, descrição, imagem principal e cinco bullet points.
4. Configura EAN/UPC/GTIN ou isenção de identificador.
5. Suporta estrutura avulsa, pai ou filho de variação.
6. Configura tema de variação, preço, condição e logística.
7. Exibe revisão, valida e só então permite publicar.

A proteção contra publicação de dados diferentes dos validados usa uma assinatura local via `JSON.stringify(listing)`. Qualquer alteração no rascunho invalida a autorização anterior para publicar.

### `src/app/api/amazon/listings/route.ts`

Endpoint autenticado pelo workspace e pela conta Amazon ativa através de `withAccountContext`.

Operações:

```text
GET  /api/amazon/listings?asin=...         Inspeciona ASIN e restrições
GET  /api/amazon/listings?keywords=...     Pesquisa tipos de produto
GET  /api/amazon/listings?productType=...  Carrega definição/schema da categoria
POST /api/amazon/listings                  Valida ou publica um listing
```

Corpo do `POST`:

```json
{
  "action": "validate | publish",
  "listing": {}
}
```

### `src/lib/amazonListingBuilder.ts`

Camada que traduz o formulário para os atributos da Listings Items API.

Responsabilidades atuais:

- Obter o `sellerId` da conta ativa.
- Consultar Catalog Items e Listings Restrictions para um ASIN.
- Pesquisar Product Types.
- Buscar a Product Type Definition com requisitos `LISTING`, `ENFORCED` e locale `pt_BR`.
- Baixar o schema retornado pela Amazon e extrair campos obrigatórios e temas de variação.
- Montar atributos de oferta existente com requisitos `LISTING_OFFER_ONLY`.
- Montar atributos de produto novo com requisitos `LISTING`.
- Enviar `PUT /listings/2021-08-01/items/{sellerId}/{sku}`.
- Usar `mode=VALIDATION_PREVIEW` na ação de validação.
- Normalizar os issues da Amazon e impedir publicação quando há erro.

Mapeamentos já implementados para produto novo:

- Nome, marca, fabricante, descrição e bullet points.
- País de origem e declaração de produto perigoso como `not_applicable`.
- Imagem principal por URL.
- Identificador externo ou declaração de isenção.
- Condição, preço e disponibilidade FBA/FBM.
- Relação avulso/pai/filho.
- Tema de variação e `number_of_items`.

### `src/app/components/Nav.tsx`

Foi incluído no workspace Amazon:

```text
Anúncios — Criar e publicar — /amazon/anuncios
```

### `src/app/globals.css`

Contém os estilos do assistente: seleção de modo, stepper, formulário, cards, prévia, prontidão, retorno da validação e layouts responsivos para 1024 px e 700 px.

## Integração Amazon usada

A implementação reutiliza a infraestrutura existente:

- `src/lib/spapi.ts`: token LWA, chamadas autenticadas, retry de rate limit e erros tipados.
- `src/lib/withAccount.ts`: seleciona a conta pelo cookie `active_seller` e executa dentro do workspace autenticado.
- `src/lib/accountContext.ts`: disponibiliza `sellerId` e refresh token por requisição com `AsyncLocalStorage`.
- `src/lib/catalog.ts`: fornece os dados resumidos do produto consultado por ASIN.

Configuração relevante, sem registrar valores secretos:

```text
OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET  Preferidos para contas conectadas via OAuth
LWA_CLIENT_ID / LWA_CLIENT_SECRET      Fallback de credenciais do app
LWA_REFRESH_TOKEN                      Fallback para conta configurada por ambiente
SPAPI_REGION                           NA por padrão
SPAPI_USE_SANDBOX                      true para usar o sandbox
DEFAULT_MARKETPLACE_ID                 A2Q3Y263D00KWC (Brasil) por padrão
```

## Decisões importantes

- Locale da Amazon: `pt_BR`.
- Moeda da oferta: `BRL`.
- Marketplace padrão: Brasil.
- FBA usa `fulfillment_channel_code: AMAZON_NA` e não envia quantidade disponível.
- FBM usa `fulfillment_channel_code: DEFAULT` e envia quantidade não negativa.
- Pais de variação não recebem preço nem disponibilidade.
- Produto existente envia `merchant_suggested_asin` e `LISTING_OFFER_ONLY`.
- Produto novo envia conteúdo completo e `LISTING`.
- Publicar só fica disponível após `VALIDATION_PREVIEW` sem issues de severidade `ERROR`.
- Aceite do PUT não significa que o SKU já está ativo, nem que já possui FNSKU/elegibilidade FBA.

## Estado funcional e lacunas conhecidas

O esqueleto completo de UI, API e tradução para SP-API está implementado, mas ainda não deve ser considerado pronto para produção.

Principais pontos a validar ou concluir:

1. **Lint, testes e build ainda não foram executados após estas alterações.**
2. Fazer teste real de ponta a ponta com uma conta Amazon conectada: ASIN existente, busca de categoria, preview e publicação.
3. A definição da categoria é dinâmica, mas o formulário só mapeia o conjunto de atributos listado em `knownAttributes`. A UI mostra campos obrigatórios específicos como `+`, porém ainda não cria inputs nem os envia. Categorias que exigirem esses campos falharão corretamente na pré-validação da Amazon.
4. Confirmar no schema real de cada categoria os formatos de variação; hoje o valor digitado é enviado em `number_of_items`, o que atende apenas temas compatíveis com quantidade de itens.
5. Confirmar os atributos e valores aceitos para isenção de identificador, imagem, declaração de produto perigoso e relações pai/filho nas categorias que serão usadas primeiro.
6. Melhorar a exibição de restrições: hoje a interface informa que existem restrições, mas não apresenta os motivos detalhados.
7. Não há salvamento de rascunho, histórico de submissões, acompanhamento do processamento nem consulta posterior do status do SKU.
8. Não há upload de imagem; o formulário recebe uma URL pública.
9. Avaliar testes unitários para `buildListingAttributes` cobrindo oferta existente, produto avulso, pai, filho, FBA, FBM e isenção de GTIN.

## Como retomar

Primeiro confirme que o estado continua intacto:

```powershell
git status -sb
git diff --stat
```

Depois execute as verificações locais:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
git diff --check
```

Se tudo compilar, inicie a aplicação:

```powershell
npm.cmd run dev
```

Abra `/amazon/anuncios` com uma conta Amazon selecionada. Ordem recomendada para os testes manuais:

1. Consultar um ASIN válido e verificar título, imagem, product type e restrições.
2. Montar uma oferta e executar apenas a validação.
3. Alterar um campo após validar e confirmar que o botão de publicação volta a ficar bloqueado.
4. Pesquisar uma categoria de produto novo e conferir os requisitos retornados.
5. Validar um produto novo, registrar os atributos ausentes retornados pela Amazon e implementar os campos específicos necessários.
6. Publicar somente um SKU de teste aprovado para essa finalidade.

## Cuidados ao continuar

- Este projeto usa Next.js `16.2.10`. Antes de alterar APIs ou convenções do Next, consultar a documentação correspondente em `node_modules/next/dist/docs/`, conforme `AGENTS.md`.
- Não expor refresh tokens, client secrets ou conteúdo de `.env.local` em logs, documentação ou commits.
- Não presumir que uma categoria aceita o mesmo payload de outra; usar sempre a Product Type Definition vigente.
- Não publicar durante testes exploratórios quando `VALIDATION_PREVIEW` for suficiente.
- Preservar alterações locais não relacionadas que possam existir no worktree.

## Próximo marco sugerido

Estabilizar o que já existe antes de ampliar o formulário:

1. Corrigir lint/types/build.
2. Adicionar testes para a montagem do payload.
3. Executar previews reais para os primeiros produtos/categorias prioritários.
4. Implementar os atributos adicionais exigidos por essas categorias.
5. Só então testar publicação e acompanhamento do SKU.

---
name: amazon-listing
description: Use ao criar ou otimizar um anúncio (listing) na Amazon — coletar as informações do produto, descobrir o product type e os atributos obrigatórios, redigir título/bullets/descrição/search terms com boas práticas, validar via SP-API em modo preview, publicar, e tratar as pegadinhas de FBA/FNSKU. Dispara em "criar anúncio Amazon", "novo listing", "publicar produto na Amazon", "otimizar título/bullet points".
---

# Criar anúncio na Amazon (SellerCore)

O SellerCore já tem toda a plumbing da SP-API para criar listing em
`src/lib/amazonListingBuilder.ts`. **Esta skill não escreve endpoint novo** — ela
orquestra o processo: juntar a informação certa, **redigir o conteúdo bem**,
validar antes de publicar e evitar as armadilhas que já custaram caro (FBA/FNSKU).

> Antes de mexer em qualquer chamada, leia `docs/api-amazon-sp-api.md` (seção
> Listings) — ele registra os endpoints e a semântica de PATCH com selectors.

## Peças que já existem (reusar, não reescrever)

Em `amazonListingBuilder.ts`:
- `searchProductTypes(keywords)` — encontra o **product type** por palavra-chave.
- `inspectAsin(asin)` — para vender num ASIN existente: retorna productType + restrições.
- `inspectProductType(productType)` — **campos obrigatórios** da categoria + temas de variação (cada categoria exige atributos diferentes; sempre consultar).
- `buildListingAttributes(input)` — monta o corpo de atributos (formato `pt_BR`/marketplace BR).
- `submitListing(input, preview)` — `PUT /listings/2021-08-01/items/...`. Com
  `preview=true` usa `mode=VALIDATION_PREVIEW` (não publica, só valida).

Tipos de entrada: `NewListingInput` (produto novo) e `ExistingOfferInput` (ofertar
num ASIN que já existe no catálogo). Marketplace BR = `A2Q3Y263D00KWC`.

## Fluxo ponta a ponta

1. **Colete as informações e fotos** (checklist abaixo). Não avance com campos-chave em branco.
2. **Descubra o product type.**
   - Vendendo num ASIN existente → `inspectAsin(asin)` (pega o productType e checa restrições de venda).
   - Produto novo → `searchProductTypes(keywords)` e confirme com o usuário qual categoria.
3. **Puxe os atributos obrigatórios** com `inspectProductType(productType)`. Cada
   categoria tem seus próprios campos required — nunca assuma; leia o que voltou.
4. **Redija o conteúdo** (título, bullets, descrição, search terms) seguindo as boas
   práticas abaixo. Este é o maior valor da skill — não copie o texto cru do usuário.
5. **Valide em preview**: `submitListing(input, preview=true)`. Corrija todos os
   `issues` com severity `ERROR` antes de publicar (a Amazon devolve o atributo culpado).
6. **Publique**: `submitListing(input, preview=false)`. Guarde o `submissionId`.
7. **Se for FBA**, trate o FNSKU (seção "Pegadinhas de FBA/FNSKU").

## O que coletar do usuário (checklist)

**Obrigatório sempre:**
- SKU (identificador interno único) e se é **produto novo** ou **oferta em ASIN existente**
- Marca (brand) e fabricante (manufacturer)
- Categoria/tipo do produto (ou palavras-chave para descobrir o product type)
- Preço de venda e condição (`new_new` para novo)
- **Fotos** (ver "Imagens") — pelo menos a principal, com URL pública acessível
- País de origem
- Identificador do produto: **EAN/UPC/GTIN**, ou pedido de isenção (`identifierExemption`)

**Para o conteúdo (redija a partir daqui):**
- Nome do produto e principais características (medidas, cor, material, quantidade, voltagem…)
- Diferenciais / benefícios (o "por que comprar")
- Uso pretendido / público
- Itens inclusos, compatibilidades, garantia

**Se FBA:** logística (`AMAZON_NA`) e se haverá envio; se variações (pai/filho, tema de variação).

## Conteúdo — boas práticas (Amazon BR)

**Título (`item_name`)**
- Estrutura: **Marca + Linha/Modelo + Tipo do produto + atributos-chave** (tamanho, cor, quantidade, material, voltagem).
- ~150–200 caracteres (o limite varia por categoria; não estoure).
- Primeira letra de cada palavra principal em maiúscula; **sem CAIXA ALTA**, sem `!!!`, sem "promoção/frete grátis/melhor", sem emoji.
- Números como algarismo ("5 Tomadas", não "cinco").

**Bullet points (`bullet_point`, até 5)**
- Um benefício por bullet, começando pelo ganho e depois a característica que o entrega.
- ~150–250 caracteres cada; escaneável. Cobrir: principal diferencial, material/qualidade, dimensões/compatibilidade, uso/instalação, garantia/segurança.
- Sem preço, sem promessa de prazo, sem dados de contato.

**Descrição (`product_description`, ~2000 caracteres)**
- Expande os bullets em texto corrido: contexto de uso, benefícios, o que acompanha.
- Frases curtas. Sem HTML além do permitido pela categoria. Sem afirmação enganosa.

**Search terms (backend, `generic_keyword`)** — *o builder atual não seta isso; é uma melhoria valiosa a propor.*
- Palavras que o comprador digitaria e que **não** estão no título. ~250 bytes.
- Sem repetir termos do título, sem marca de concorrente, sem pontuação, minúsculas, separados por espaço.

**Imagens**
- **⭐ Resolução ≥ 2500×2500 px (crítico).** A Amazon **guarda a resolução que você sobe** (não encolhe) mas **converte PNG→JPEG e recomprime**; se o teto for baixo (ex.: 1254×1254, o que os geradores de IA cospem por padrão — confirmado servindo 1254px no anúncio do clips), o **zoom** ("ver imagem completa") não tem versão maior pra mostrar e fica borrado, e a recompressão fica visível. Com 2500 px+ a Amazon serve uma versão grande (zoom nítido) e a compressão some.
- **⭐ TODO prompt de imagem deve terminar pedindo a resolução explicitamente**, ex.: `"...resolução mínima 2500×2500 px, altíssima nitidez, máximo detalhe, sem compressão."`. **Mas o prompt não garante** — o tamanho real é config de saída da ferramenta; sempre **conferir o arquivo gerado** e, se vier pequeno, usar "upscale"/HD do gerador ou Upscayl até 2500–3000 px. Dá pra **trocar as imagens depois** (editar anúncio → Imagens) sem recriar o listing.
- **Principal**: fundo branco puro, produto ocupando ~85% do quadro, ≥2000×2000 px, sem texto/marca-d'água/adereço.
- **Secundárias com legenda**: a usuária pediu — cada secundária deve ter uma **legenda curta** (3–4 palavras) com o benefício, senão o cliente não capta a mensagem. IA erra texto: se embaralhar, gerar limpo e legendar no Canva.
- **⭐ Capa: usar BRIEF DE OBJETIVO, não cena super-especificada (protetor 2026-07).** A melhor capa é um **composto multi-painel numa imagem só** (hero em uso + macro do detalhe + flexibilidade/escala na mão + grade com as N unidades do kit), e **a IA gera isso em prompt único** — desde que o prompt seja um **briefing de meta**, não uma cena travada. Meu erro foi especificar uma cena única e "pobre". O padrão que **ganhou** (feito pela usuária no ChatGPT):
  > *"Crie uma foto de capa criativa, nível top-1 da categoria, usando o produto, dentro das diretrizes da Amazon (fundo branco, sem texto, selo ou elemento gráfico), mas mostrando o uso real. Componha vários elementos numa imagem: o produto em uso ([ex.: encaixado no pé de móvel]), um close do diferencial ([ex.: feltro]), a flexibilidade/escala na mão, e a grade com as [N] unidades do kit. Composição agressiva pra competir na busca."*
- **⭐ SEMPRE gerar 2 versões da capa:** a **agressiva** (composto com mão/uso, pra ranquear) como principal + a **conservadora** (só o produto no branco) como **backup**. A regra oficial da Amazon diz "só o produto" na principal, mas os concorrentes forçam e **a aplicação é aleatória** — então usa a agressiva e guarda a conservadora pro caso de a Amazon derrubar. Não travar por causa da diretriz.
- Secundárias: ângulos, produto em uso, dimensões, o que vem na caixa.
- A API recebe **URL** (`main_product_image_locator.media_location`) — a imagem precisa estar hospedada e acessível publicamente. Confirme a URL antes de submeter.

## Pegadinhas de FBA/FNSKU (já custaram caro — não repetir)

- O Seller Central remove a oferta FBM ao ativar FBA; **a API não**. Um listing criado via API pode ficar com `fulfillment_availability = [{AMAZON_NA}, {DEFAULT, quantity:0}]`. Esse **offer duplo impede o FNSKU** e a variação não aparece em "Enviar para a Amazon".
- **Semântica de PATCH com selectors** (`fulfillment_availability` usa `fulfillment_channel_code`):
  - `replace` **não** remove a outra entrada — só atualiza a do mesmo selector (retorna ACCEPTED e "não muda nada").
  - Remover a entrada errada: `delete` com o selector no `value`:
    `{op:"delete", path:"/attributes/fulfillment_availability", value:[{fulfillment_channel_code:"DEFAULT"}]}`.
  - `delete` sem `value` → "Invalid empty value"; por índice (`/1`) → "Invalid path".
  - Fonte oficial: selling-partner-api-models issue **#2061**.
- **`merchant_suggested_asin` vazio também trava o FNSKU** em variações. Setar cada variação com o **próprio ASIN** (`[{value:"ASIN", marketplace_id:MK}]`) foi o gatilho final no caso real.
- Método que funcionou: **comparar uma variação que registrou o FNSKU vs a travada, atributo por atributo**, até baterem 100%. O FNSKU sai ~1h depois da config limpa (checar via `GET /fba/inventory/v1/summaries?details=true` → campo `fnSku`).

## Validar e publicar (regras)

- **Sempre `preview=true` primeiro.** Só publique quando não houver `issue` com severity `ERROR`. O `8560` (isenção de GTIN) **não** é falso-positivo: se aparecer, a conta precisa da isenção concedida antes de o anúncio ficar live (ver Aprendizados).
- Produto novo usa `requirements: "LISTING"`; oferta em ASIN existente usa `LISTING_OFFER_ONLY`.
- Ações irreversíveis/externas (publicar de fato, alterar preço/estoque) → confirmar com o usuário antes.
- Ao debugar erro da Amazon, logar `technicalDetail` + `amazonRequestId` do `SpApiError` (nunca tokens/segredos).

## Aprendizados de campo (clips, 2026-07)

- **⭐ Sem código de barras exige ISENÇÃO DE GTIN CONCEDIDA NA CONTA (pré-requisito).**
  O erro `8560` (no preview E no painel) não é falso-positivo: significa que a conta
  **não tem a isenção de GTIN** para aquela marca + categoria. O que confirmamos em
  campo (clips, 2026-07):
  - O submit real (`preview=false`) com `supplier_declared_has_product_identifier_exemption: true`
    retorna `status: ACCEPTED`, **mas isso só cria um RASCUNHO** — o anúncio **NÃO fica
    live**: sem ASIN, sem oferta ativa, `summaries: []`, e no painel aparece
    "Adicionar informações que estão faltando".
  - No painel, mesmo com os dois toggles marcados ("Este produto não tem uma marca" +
    "Este produto não tem uma ID do produto"), a Amazon ainda exibe em vermelho
    **"É necessária uma isenção do GTIN. Inscreva-se agora"**. O toggle **não** concede
    a isenção — só declara a intenção.
  - **Resolução (uma vez por marca+categoria):** o vendedor solicita a isenção em
    *Catálogo → Solicitar isenção de GTIN* (ou o link "Inscreva-se agora"). Grátis,
    geralmente na hora para Genérico. **Depois de concedida**, o 8560 some e o anúncio
    (via painel OU via API) completa e fica live sozinho.
  - Portanto o fluxo 100% automático via API para Genérico **só funciona se a conta já
    tiver a isenção concedida** naquela categoria. Sem isenção, o máximo que a API faz é
    deixar o rascunho pronto para o vendedor concluir. Sempre avisar o usuário disso.
  - **A isenção parece ser POR CATEGORIA, obtida uma vez por categoria nova.** Observado
    em 3 anúncios Genérico da mesma conta (todos `exemption: true`):
    `FURNITURE_FLOOR_PROTECTOR` (protetor) live desde 21/07; `PAPER_CLIP_CLAMP` (tentativa
    via API) travou no `8560`; `OFFICE_PRODUCTS` (clips manual) ficou live e, a partir daí,
    o preview de `PAPER_CLIP_CLAMP` **também** parou de dar 8560 (a classificação "material
    de escritório" cobre os dois). Ou seja: cada categoria nova pega a isenção uma vez, pelo
    fluxo "não tem ID / Inscreva-se agora" no painel; categorias já usadas não repetem.
  - **⚠️ Não dá pra provar a regra exata pela API** (não há endpoint que lista isenções
    concedidas). Então NÃO teorizar — **testar empiricamente**: o preview é o oráculo.
  - **Regra operacional (confiável, independe da teoria):** antes de criar, rodar um
    `VALIDATION_PREVIEW` do Genérico com `exemption: true`. **Sem `8560`** → a categoria já
    tem isenção, criar 100% via API na hora. **Com `8560`** → categoria nova; pedir ao
    usuário conceder a isenção uma vez no painel (Catálogo → Solicitar isenção de GTIN /
    "Inscreva-se agora"), depois a API cria sozinha.
  - **Erros do rascunho preso (aparecem só depois do processamento assíncrono):** `8560`
    (identificador insuficiente) e `13013` (oferta não adicionada porque o produto não
    está no catálogo). Ambos somem quando a isenção da categoria é concedida.
- **⭐ DEFAULT DESTA OPERAÇÃO: SEMPRE Genérico.** A usuária lista tudo como "Genérico"
  por padrão — não perguntar marca, assumir Genérico. Mesmo quando o produto tem EAN do
  distribuidor, ela prefere Genérico (buy box fechada) a usar o EAN (buy box aberta).
- **Genérico = buy box fechada (bom para nós).** Anúncio com marca "Genérico" não
  aceita outros vendedores na mesma oferta (verificado por `offerCount`: Genérico=1
  oferta; marcas reais como Tilibra/Leonora=7). Com marca própria (ou com o EAN de um
  produto de catálogo), a oferta fica **aberta** e concorrentes entram.
- **Campos obrigatórios além dos 6 "enforced"** que só aparecem no preview desta
  categoria (PAPER_CLIP_CLAMP): `part_number`, `manufacturer`, `item_package_weight`,
  `item_package_dimensions`, `batteries_required`, `warranty_description`,
  `external_testing_certification`, `list_price` (usar `value_with_tax`, **não**
  `value`). Sempre rodar o preview e ler os issues — não assumir os required.
- **Fiscais são por produto:** NCM (clip de metal = `83059000`; plástico = `39269090`),
  peso e dimensões da embalagem. Não reaproveitar de outro produto.
- **NCM não bloqueia a publicação (mas é relevante pro fiscal).** No fluxo manual do
  painel, dependendo da categoria, os campos fiscais nem aparecem e o anúncio fica live
  com `ncm_code` VAZIO (confirmado no `kit-clips-320`). A NCM é usada na **emissão de
  nota fiscal** e pode ser exigida no **envio FBA** / configurações fiscais da conta, não
  no anúncio. Vale preencher via PATCH depois (`ncm_code`) pra evitar dor de cabeça.
- **Ler um anúncio próprio já existente** (`GET /listings/.../items/{seller}/{sku}?
  includedData=attributes`) é a melhor referência de como preencher os campos no BR.
- **Sempre usar a conta do PRÓPRIO usuário.** Conferir `sellerId`/workspace antes de
  qualquer probe — nunca operar na conta de terceiros.
- **O submit ACCEPTED não é instantâneo:** logo após o PUT, `GET` com
  `includedData=summaries` vem vazio (sem ASIN/status) por alguns minutos enquanto a
  Amazon processa; os `attributes` já aparecem gravados. ASIN + status "live" saem
  depois. Em FBA, fica "sem estoque" até enviar o inventário.

## Referências

- Código: `src/lib/amazonListingBuilder.ts`, `src/lib/spapi.ts`, `src/lib/catalog.ts`
- Doc interna: `docs/api-amazon-sp-api.md` (Listings, selectors, FBA/FNSKU)
- UI existente: página `/amazon/anuncios` ("Criar anúncio")
- Probe scripts: `node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local <script>` com `runWithWorkspace`/`runWithAccount` + `spapiFetch`

# Diferencial do SellerCore no Mercado Livre

**Escrito e validado em 13/08/2026.** Escopo: só Mercado Livre. Levantamento, não
implementação. Substitui o estudo anterior de ranking por termo, que virou a §1.

**Pergunta de origem:** a Amazon tem pesquisa de mercado no SellerCore. O ML não tem
nada equivalente. O que dá para construir que seja **insight de verdade**, não raspagem?

> ⚠️ **Contas.** `648425194` / **NEXAHUBBRASIL** é a nossa (0 anúncios ativos).
> `1191100170` / **CRYSTALFANCY** é do colega — usada **somente para leitura**, com
> autorização, por ser a única com catálogo ativo para servir de amostra.

---

## 1. O caminho do Mercado Turbo está fechado — e não vale insistir

`/sites/MLB/search` responde **403** com nosso token real (3 variantes testadas; o
controle `/users/{me}/items/search` passa, provando que não é token nem escopo). O MT
tem **App Certified Platinum**; nós não.

Sobra raspar a página pública. **Funciona, mas não vira produto:**

- Legível: 60 cards, 60/60 IDs extraídos, 12 patrocinados + 48 orgânicos.
- Patrocinado **não** é detectável por texto — só por `click1.mercadolivre.com.br/mclics/`.
- Renderiza no cliente (~3,5 s): `fetch` de servidor pega casca vazia.
- `_Desde_61/481/961` → **0 cards**. A paginação clássica morreu.
- **Após ~6 navegações, spinner infinito** — sem erro, sem 429, persistindo por minutos.

O MT varre 1000 anúncios por termo porque usa API certificada. Nós não passamos da
página 1. **Conclusão: não replicar. Página 1 raspada não é insight.**

---

## 2. O que o ML tem que a Amazon não tem: catálogo estruturado

Na Amazon, descobrir concorrente é caro — uma chamada de pricing por ASIN. No ML, o
catálogo entrega **a lista inteira de concorrentes de um produto, com preço e logística,
numa chamada**. Isso é melhor que o equivalente da Amazon, e está aberto para nós.

**Validado hoje, 10 de 10 acertos**, em `catalog_product_id` de anúncios ativos:

```
GET /products/{id}/items?limit=50
```

Cada oferta traz: `price`, `original_price`, `seller_id`, `listing_type_id`,
`official_store_id`, `shipping.logistic_type`, `tags`, `deal_ids`.

O `logistic_type` é o achado: distingue **`fulfillment` (FULL)** de `xd_drop_off`,
`cross_docking` e `drop_off`. É o equivalente ao FBA×FBM da Amazon — e o ML privilegia
FULL na exposição. Saber quantos concorrentes de um catálogo estão em FULL é informação
estrutural sobre o nicho.

### Descoberta: por categoria, não por palavra-chave

`/products/search?q=` **não serve** — medido: 30 produtos em 3 termos, apenas 2 com
oferta ativa, e a relevância erra feio ("protetor sola do pé" devolveu protetor **solar**).
Ele lista catálogo morto.

O que funciona é `/highlights/MLB/category/{id}` → os mais vendidos da categoria, **com
`position`**. Ressalva medida: o retorno mistura três tipos —

| tipo | encadeia com `/products/{id}/items`? |
|---|---|
| `PRODUCT` (~40%) | ✅ sim |
| `ITEM` | ❌ é anúncio avulso |
| `USER_PRODUCT` (MLBU) | ❌ agrupamento do vendedor |

Só os `PRODUCT` seguem adiante — mas seguem **4/4** nas duas categorias testadas.
(O `api-mercado-livre.md` cita `PRODUCT`/`ITEM`; o `USER_PRODUCT` é observação nova.)

**Rendimento real medido:** 2 categorias → 8 catálogos → **67 concorrentes mapeados**,
todos com preço e logística. Sem raspar nada.

---

## 3. A proposta: "Raio X do catálogo"

Não é ranking de busca. É **posição na disputa do catálogo** — que no ML é onde a venda
se decide, porque o catálogo é a página que o comprador vê.

**Fluxo:** categoria → `/highlights` → catálogos do nicho → `/products/{id}/items` →
todos os concorrentes → cruza com o custo dela.

### Os números que saem disso

Medidos hoje, não hipotéticos:

| Métrica | Amostra real | O que diz |
|---|---|---|
| **Spread de preço** | 400%, 263%, 118%, 115%, 66%, 44%, 29% | 400% = nicho desorganizado, há espaço. 29% = commodity, briga de centavo. |
| **Nº de concorrentes** | de 1 a 33 no mesmo catálogo | 1 = catálogo dominado. 33 = guerra. |
| **% em FULL** | varia por catálogo | se ninguém está em FULL, entrar em FULL é vantagem estrutural |
| **Sua posição na lista** | o anúncio próprio aparece na lista | "você é o 3º mais barato de 11" |

### O diferencial de verdade

Todo mundo que tem a API mostra preço de concorrente. **Só o SellerCore tem o custo.**
A frase que ninguém mais monta:

> "Para ser o mais barato desse catálogo você precisa de R$ 22,35. Com seu custo, tarifa,
> frete e imposto, a margem em R$ 22,35 é **−4%**. Esse catálogo não vale a briga."

E, como snapshot no tempo (mesmo padrão do ADR-009/ADR-010), vira monitoramento:
"entrou concorrente novo", "o líder baixou 8%", "3 dos 4 migraram para FULL".

Isso não é pesquisa de mercado copiada da Amazon — é a versão que **só o ML permite**,
porque só o ML tem catálogo com lista de ofertas aberta.

---

## 4. E o anúncio tradicional? (o buraco da §3, medido)

A §3 só serve para anúncio de catálogo. **Isso deixa de fora uma fatia grande:** na
conta medida, **11 de 31 anúncios ativos (35%) são tradicionais**.

### Para eles, inteligência de concorrência é impossível — três portas, três 403

Testado hoje, não deduzido:

| Porta | Resultado |
|---|---|
| `GET /sites/MLB/search?q=` | ❌ 403 |
| `GET /items/{id}` de terceiro | ❌ 403 — **re-confirmado hoje** (apertou em 03/08) |
| `autosuggest` (`http2.mlstatic.com/…/autosuggest`) | ❌ 403 |

Sem catálogo não há lista de ofertas, e sem ler item de terceiro não há preço de
concorrente. **Não existe caminho.** Prometer "monitoramento de concorrência" para
anúncio tradicional seria vender o que não dá para entregar.

### Mas o funil próprio funciona — e funciona para os dois tipos

```
GET /items/{id}/visits/time_window?last=30&unit=day
```

Devolve **série diária de visitas dos últimos 30 dias**, por anúncio. Medido:
**12/12 responderam 200, incluindo 5/5 tradicionais**, a ~188 ms cada — 31 anúncios em
~6 s, cabe folgado num cron. Há também
`/users/{id}/items_visits/time_window` para o agregado do vendedor (200; 64.067 visitas
em 30 dias na conta medida).

⚠️ `/visits/items?ids=` (lote) responde **400 — "maximum amount of items to query is 1"**.
É uma chamada por anúncio, não lote.

Cruzando visitas com vendas e **custo**, um número separa três problemas que hoje se
confundem:

| Sintoma | Diagnóstico | O que adianta fazer |
|---|---|---|
| poucas visitas | **exposição** | mexer em preço não resolve; é título, categoria, catálogo, Ads |
| muitas visitas, poucas vendas | **conversão** | foto, preço, frete, reputação |
| vende bem, sobra pouco | **margem** | custo, tarifa, logística |

O MT tem "Relatório de Visitas" e "Taxa de Conversão" como relatórios separados. O que
ninguém monta é **lucro por visita**, porque exige o custo — que só nós temos.

### O achado que caiu no colo

As visitas em 30 dias da amostra, separadas por tipo:

- **catálogo:** 5.317 · 5.040 · 3.802 · 746 · 328 · 243 · 67
- **tradicional:** 209 · 103 · 6 · 5 · 4

⚠️ **n=12, um vendedor só — isto é indício, não conclusão.** Mas indica a pergunta certa
para o anúncio tradicional, e ela não é "quem é meu concorrente?": é **"este anúncio
deveria estar no catálogo?"**. Essa pergunta se responde **com o dado do próprio
vendedor**, sem depender de nenhuma porta fechada.

Ou seja: o anúncio tradicional não fica de fora do produto — ele entra por outro eixo,
e possivelmente por um mais acionável.

---

## 5. Limites — declarar antes de prometer

- **Não dá para saber quem ganha o buy box.** `buy_box_winner` veio **`null` em 20 de
  20** consultas. A lista de ofertas parece ordenada por preço crescente, mas ordem ≠
  vencedor. Não afirmar quem ganha; mostrar preço e logística e deixar a leitura explícita.
- **Não há `sold_quantity` de terceiro.** O ML fechou. Não existe "quanto o concorrente
  vende" nem BSR. O proxy possível é a **posição no `/highlights`**, que é ranking de
  categoria, não volume.
- **Cobertura parcial por desenho.** ~40% dos destaques encadeiam. Mostrar quantos foram
  mapeados e quantos ficaram de fora — `scanned_count` explícito, mesma disciplina de
  `null ≠ 0`.
- **Nenhum dos dois endpoints está no código hoje.** `grep` por `highlights` e `/trends/`
  em `src/` não retorna nada. São trabalho a fazer, não infraestrutura pronta.
- **`/trends/MLB`** funciona (50 termos) mas **sem volume** — serve para escolher
  categoria, não para dimensionar.

---

## 6. Decisões

**A trava de sempre:** nossa conta tem **0 anúncios ativos** no ML. Para a nossa
operação hoje isso roda "em branco"; para o **produto**, roda desde o primeiro cliente
com anúncio.

A proposta virou **duas features que se completam**, e a segunda cobre 100% dos anúncios:

| | Cobre | Depende de |
|---|---|---|
| **Raio X do catálogo** (§3) | só anúncio de catálogo (65% na amostra) | `/highlights` + `/products/{id}/items` |
| **Funil e lucro por visita** (§4) | **todos** (catálogo e tradicional) | `/items/{id}/visits/time_window` + custo |

1. **Construir as duas, ou começar pelo funil?** O funil cobre todo mundo, é uma chamada
   por anúncio e casa direto com o custo que já está no canônico. O Raio X é mais
   vistoso, mas atende só parte da base.
2. **Descoberta por categoria basta** para o Raio X (já que por palavra-chave não funciona)?
3. Confirmar que abandonamos a paridade com o MT em ranking de busca.

Introduz fonte de dado nova → pede **ADR** antes de implementar (`AGENTS.md`).

---

## Anexo — evidência de 13/08/2026

**Busca do ML:** `/sites/MLB/search` 403 nas 3 variantes com token real.
`/users/{me}/items/search` 200 (controle).

**Página pública** (`arranhador protetor sofa gatos`, 1.443 resultados): 60 cards, 12
patrocinados + 48 orgânicos, 60/60 IDs (8 item, 19 catálogo, 33 via query de anúncio).
`/Patrocinado/` no texto → false. `_Desde_61/481/961` → 0 cards. Throttle após ~6
navegações.

**Catálogo:** `/products/search` em 3 termos → 30 produtos, 2 com oferta, 0 com buy box.
`/products/{id}/items` em 10 `catalog_product_id` de anúncios ativos → **10/10 com
ofertas**, 0/10 com buy box. `/highlights` em `MLB388338` e `MLB271198` → 20 destaques
cada, mistura `PRODUCT`/`ITEM`/`USER_PRODUCT`, 4/4 dos `PRODUCT` encadearam, **67
concorrentes mapeados** com preço e `logistic_type`.

**Anúncio tradicional:** composição 20 catálogo / 11 tradicional em 31 ativos.
`/items/{terceiro}` → 403 (2 alvos). `autosuggest` → 403.
`/items/{id}/visits/time_window?last=30&unit=day` → **12/12 = 200** (5/5 tradicionais),
188 ms cada. `/users/{id}/items_visits/time_window` → 200, 64.067 visitas/30d.
`/visits/items?ids=` (lote) → 400, máximo 1 item por consulta.

**Sonda:** `scripts/ml-endpoints-probe.mjs` (presa em `648425194`; só GETs; não faz
refresh porque o token do ML rotaciona).

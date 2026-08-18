---
name: gerenciar-ads
description: Use para GERENCIAR as campanhas de Amazon Sponsored Products — decidir e executar mudanças de lance, orçamento, palavra-chave e negativa; criar campanha nova; rodar o ciclo de colheita do relatório de termos de busca; calcular lance máximo pela margem; e diagnosticar campanha que não entrega. Dispara em "criar campanha", "ajustar lance", "negativar termo", "colher os termos", "o orçamento está certo?", "quanto posso pagar por clique", "a campanha parou". Para só LER o desempenho do dia, use monitorar-ads.
---

# Gerenciar Amazon Ads (NEXO)

Esta skill **decide e executa**. A skill irmã `monitorar-ads` **lê e registra**.

| Pergunta | Skill |
|---|---|
| "Como estão as campanhas?" · "tem algo pra fazer?" | **`monitorar-ads`** |
| "Negativa esse termo" · "cria a manual do clips" · "quanto posso pagar por clique?" | **esta aqui** |

As duas compartilham o mesmo histórico: **toda leitura e toda mudança são registradas
com data e hora em `../monitorar-ads/SKILL.md`.** Não existe mudança sem registro — foi
esse log que permitiu, dias depois, provar que o preço era a causa e não a campanha.

---

## 🚦 Antes de qualquer coisa

Cinco regras que já custaram erro real nesta conta. Violar qualquer uma invalida o
trabalho:

1. **Não mexer em lance, orçamento, palavra-chave ou negativa sem confirmação dela.**
   Propor com o número e o motivo; esperar o "pode". Sem exceção.
2. **Ler antes de afirmar.** `get_page_text` lê o DOM, **não recarrega**. Sempre
   `navigate` na URL antes de ler, senão a "leitura de agora" é uma foto de horas atrás.
   Depois do `navigate` a primeira leitura volta `loading` — ler de novo.
3. **Volume mínimo antes de concluir:** ~500 impressões para CTR, ~10 cliques para
   conversão. Abaixo disso, dizer explicitamente que é ruído. Matar palavra com 4 cliques
   é decidir no cara ou coroa.
4. **O dia fechado não fecha venda.** Atribuição é pela **data do clique**, janela de
   7 dias — a linha de hoje continua ganhando compras por uma semana, e tudo dos últimos
   28 dias é provisório. Fecha impressão, clique, CTR e gasto; **não** fecha compra.
   → Decidir sobre janela fechada de 7/14 dias com **3 dias de folga do presente**.
5. **Nada de scraping.** O console de Ads **dela**, pelo Chrome, é autorizado. Raspar
   marketplace, concorrente ou automatizar navegação em conta de terceiro: nunca, nem
   propor.

⚠️ **Só existe Sponsored Products nesta conta.** Sponsored Brands, Display e Stores
exigem Brand Registry, e os anúncios são `Genérico` por decisão de negócio. Não gastar
tempo com eles.

---

## ⛔ Formato obrigatório de toda leitura

```
Período lido: <as datas EXATAS na tela>
Recarreguei: sim/não
Volume: <impressões> · <cliques> · atribuição <fechada/pendente>
```

Sem esse bloco, a leitura não vira conclusão. Detalhe e o porquê em
[`../monitorar-ads/SKILL.md`](../monitorar-ads/SKILL.md).

---

## 🔁 Analisar = campanha por campanha

**Regra dela (17/08/2026):** *"quando falo pra você analisar, é pra ver as campanhas uma a
uma"* e *"é esse tipo de análise que quero de você, todo dia"*.

Ler a tabela agregada e concluir **não conta como análise**. O roteiro completo (com os
snippets de extração e o checklist por campanha) está em
[`../monitorar-ads/SKILL.md`](../monitorar-ads/SKILL.md), seção "A ANÁLISE DIÁRIA".

Três defeitos reais que **só** apareceram abrindo uma a uma, todos invisíveis no agregado:

1. Lance de R$ 3,00 onde a documentação dizia R$ 0,84 — 4 dias, 9× a sugestão da Amazon.
2. Apenas 2 de 6 campanhas vendem (as colunas de venda ficam fora da tela na lista).
3. 75% do tráfego de uma campanha vinha de `Substitutos` — página de concorrente, que não
   aparece em nenhum relatório de termo de busca.

---

## O motor de decisão

Aplicar **nesta ordem** e parar na primeira que casar. Cada linha aponta para o que fazer.

| # | Sinal | Conclusão | Onde está o passo a passo |
|---|---|---|---|
| 1 | Campanha fora de veiculação, anúncio inativo, SKU sem estoque ou sem buy box | **Investigar** — veiculação parada, nada mais importa | [`referencias/diagnostico.md`](referencias/diagnostico.md) |
| 2 | Impressões ~zero há 2+ dias | **Agir** — lance abaixo do piso do leilão | [`referencias/lance-e-orcamento.md`](referencias/lance-e-orcamento.md) |
| 3 | Gasto ≥50% do teto diário, ou "Orçamento excedido" | **Agir** — o teto virou o limitador | [`referencias/lance-e-orcamento.md`](referencias/lance-e-orcamento.md) |
| 4 | 500+ impressões e ~0 clique | **Investigar a oferta** — preço, imagem principal, título | [`referencias/diagnostico.md`](referencias/diagnostico.md) |
| 5 | 10+ cliques e 0 venda | **Investigar a página**, não o anúncio | [`referencias/diagnostico.md`](referencias/diagnostico.md) |
| 6 | Termo com 3+ pedidos | **Agir** — promover a exata + negativar exato na automática | [`referencias/colheita.md`](referencias/colheita.md) |
| 7 | Termo com 10+ cliques e 0 pedido | **Agir** — negativa exata | [`referencias/colheita.md`](referencias/colheita.md) |
| 8 | Termo com gasto > 2× a margem unitária e 0 pedido | **Agir** — negativa exata, sem esperar mais | [`referencias/colheita.md`](referencias/colheita.md) |
| 9 | Termo irrelevante (outro produto/categoria) | **Agir** — negativa exata na hora, não precisa de volume | [`referencias/colheita.md`](referencias/colheita.md) |
| 10 | Nada acima | **Esperar** — e dizer em quantos dias vale reolhar | — |

📌 **O diagnóstico mais rápido que existe** é ler CTR e CVR juntos:

| CTR | CVR | Significa | Alavanca |
|---|---|---|---|
| baixo | alto | A oferta não chama, mas quem entra compra | imagem principal, título, **preço** |
| alto | baixo | Você atrai e decepciona | página: fotos, descrição, **avaliações**, prazo |
| baixo | baixo | O termo não é seu | **negativa** |
| alto | alto, mas ACOS ruim | É preço de leilão | lance, ou aceitar como custo de rankeamento |

---

## Os quatro trabalhos

### 1. Colher termos — **o motor da conta**

O único processo que faz a conta melhorar sozinha. Roda **semanalmente**.

```
AUTOMÁTICA (descobre)
   ├─→ termo com pedidos ──→ MANUAL EXATA ──→ e NEGATIVA EXATA na automática
   ├─→ termo com variações ─→ MANUAL FRASE
   └─→ termo que só gasta ──→ NEGATIVA EXATA
```

⚠️ **Promover sem negativar é o erro que se paga duas vezes:** a automática e a manual
passam a leiloar entre si pelo mesmo termo, e você encarece o próprio clique.

→ [`referencias/colheita.md`](referencias/colheita.md)

### 2. Calcular lance pela margem

Nunca aceitar o número que a tela sugere sem conferir contra a margem. Use o script:

```bash
node scripts/lance.mjs --preco 27.90 --custo 5.84 --cvr 10
```

Ele devolve o **ACOS de equilíbrio**, o **CPC máximo** e o lance sugerido para um ACOS
alvo. → [`referencias/lance-e-orcamento.md`](referencias/lance-e-orcamento.md)

### 3. Criar campanha

Estrutura padrão desta conta, **por produto**: 1 automática + 1 manual com **dois
grupos** (Exata e Frase, mesmas palavras).

⚠️ A tela de criação tem três defaults que trabalham contra você — lance padrão nascendo
em R$ 2,75, dinâmico "aumento e redução" em campanha nova, e o fluxo de "campanhas
prontas". → [`referencias/criar-campanha.md`](referencias/criar-campanha.md)

### 4. Diagnosticar campanha que não entrega

→ [`referencias/diagnostico.md`](referencias/diagnostico.md)

---

## Onde executar

**Hoje é pelo navegador.** A Ads API foi solicitada em 13/08/2026 e ainda não foi
aprovada. Caminho que funciona (**sempre pelo Seller Central**, nunca direto):

```
https://sellercentral.amazon.com.br/cm/ref=xx_cmpmgr_dnav_xx?source=ngs
```

Testar se a aprovação saiu, sem navegador — e o que fazer quando sair:
→ [`referencias/console-e-api.md`](referencias/console-e-api.md)

---

## A conta

Números, IDs, margens, preços correntes e o estado dos créditos:
→ [`referencias/conta-nexahub.md`](referencias/conta-nexahub.md)

**Contexto que muda toda leitura:**

- **Fase de ranqueamento.** O objetivo é velocidade de venda para o BSR, não lucro por
  clique. ACOS de 30–60% é aceitável **nesta fase**.
- **A tarifa da Amazon está zerada** por promoção temporária de vendedor novo. Toda
  margem calculada hoje **muda quando a promoção acabar** — reconferir antes de decidir
  lance com base em margem.
- **Cupom não aparece na Pricing API**, e só desconta se o comprador resgatar (taxa de
  resgate nesta conta: R$ 0,00). Para margem, usar o **valor do pedido**, nunca o do
  anúncio.

---

## Os erros que custam caro

Lista curta, todos já vistos nesta conta ou apontados como os mais comuns do mercado:

1. **Achar que o problema é o anúncio quando é a página.** Mais orçamento mandando gente
   para página que não converte é queimar dinheiro mais rápido.
2. **Não usar negativas.** Apontado como o erro nº 1. Automática sem negativa é sangria
   silenciosa. *(Aconteceu aqui: R$ 8,90 de R$ 10,94 foram para a palavra `martelo`.)*
3. **Orçamento espalhado demais.** Dez campanhas com R$ 5 nunca saem do aprendizado.
4. **Otimizar com dado insuficiente.**
5. **Ficar sem estoque depois de empurrar anúncio** — o mais caro da lista: paga-se para
   criar demanda e perde-se a venda e o rankeamento.
6. **Ligar ajuste de topo cedo demais.** Compra posição antes de saber se ela se paga.
7. **Usar ACOS como se fosse lucro.** ACOS ignora custo do produto, tarifa e frete. ACOS
   de 20% dá prejuízo se a margem bruta é 15%.
8. **Deixar automática e manual disputando o mesmo termo.**
9. **Aceitar os defaults da interface.** Todos favorecem gasto, não aprendizado.
10. **Comparar preço sem comparar o produto.** *(Aconteceu aqui: montei tabela de
    concorrentes do martelo sem checar tamanho de nenhum. Ela corrigiu: "são tamanhos
    diferentes, meu nobre".)* Antes de concluir "estamos caros", conferir `attributes` e
    `dimensions` — no mínimo pelo título.

---

## A rotina

| Cadência | O quê |
|---|---|
| **Diária** (5 min) | Alguma campanha saiu de veiculação? Algum SKU sem estoque ou sem buy box? Alguma estourou o orçamento antes do fim do dia? |
| **Semanal** (30–60 min) — *o trabalho de verdade* | Relatório de termos (7–14 dias) → ordenar por gasto (negativas) → ordenar por pedidos (promoções) → campanhas com zero impressão (lance) → ajustar lances → conferir tetos |
| **Mensal** | Participação de impressão · relatório de posicionamento · TACOS vs. mês anterior · produto comprado (alguma campanha vende outro SKU?) |

⚠️ **Lance se ajusta semanalmente**, não diariamente — diário decide em cima de ruído.
**Exceção:** campanha recém-lançada, aí sim 2 a 4 conferidas na primeira semana, porque o
objetivo é achar rápido o lance que destrava impressão.

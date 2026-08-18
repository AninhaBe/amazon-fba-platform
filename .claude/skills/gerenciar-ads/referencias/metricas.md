# Métricas, benchmarks e atribuição

## As definições que não podem ser confundidas

| Sigla | Fórmula | O que responde |
|---|---|---|
| **ACOS** | gasto ÷ vendas **do anúncio** | Quanto do faturamento gerado pelo anúncio foi consumido pelo anúncio |
| **TACOS** | gasto ÷ vendas **totais** (anúncio + orgânico) | O quanto o negócio inteiro depende de anúncio. **A métrica que realmente importa** |
| **ROAS** | vendas do anúncio ÷ gasto | O inverso do ACOS. ROAS 4 = ACOS 25% |
| **CTR** | cliques ÷ impressões | Se a **oferta** (imagem, título, preço, avaliação) atrai o clique |
| **CVR** | pedidos ÷ cliques | Se a **página** converte quem chegou |
| **CPC** | gasto ÷ cliques | O que o leilão está cobrando de você |
| **Impression share** | suas impressões ÷ total do termo | Quanto do mercado daquele termo você pega. Diz se **há espaço para crescer** |

⚠️ **ACOS não é lucro.** Ele ignora custo do produto, tarifa e frete. ACOS de 20% dá
prejuízo se a margem bruta é 15%. **O teto de ACOS aceitável é a margem**, não um número de
mercado.

📌 **TACOS caindo ao longo do tempo = o flywheel está girando** — o anúncio está comprando
rankeamento orgânico, que é o objetivo real na fase de lançamento.

---

## Benchmarks 2026

Números de mercado, majoritariamente EUA. **No Brasil o CPC tende a ser menor**, mas a
estrutura das relações se mantém.

| Métrica | Faixa saudável | Observação |
|---|---|---|
| ACOS geral | **30–32%** | Muito dependente da fase do produto |
| CPC geral | US$ 1,18–1,22 | Subiu 8–12% em relação a 2025 |
| **CTR (Sponsored Products)** | **0,35–0,70%** | **Abaixo de 0,3% = problema de oferta** |
| **CVR (Sponsored Products)** | **10–18%** | **Abaixo de 8% = problema de página** |
| TACOS | 10–15% | Caindo ao longo do tempo = flywheel girando |
| ROAS | ~3,1× | — |

⚠️ **Nesta conta, em fase de ranqueamento, ACOS de 30–60% é aceitável** — o objetivo é
velocidade de venda para o BSR, não lucro por clique. Isso **não** é permissão para ignorar
o número: é uma janela com prazo.

---

## Ler CTR e CVR juntos — o diagnóstico mais rápido

| CTR | CVR | Significa | Alavanca |
|---|---|---|---|
| baixo | alto | A oferta não chama, mas quem entra compra | imagem principal, título, **preço** |
| alto | baixo | Você atrai e decepciona | página: fotos secundárias, descrição, **avaliações**, prazo de entrega |
| baixo | baixo | O termo não é seu | **negativa** |
| alto | alto, ACOS ruim | É preço de leilão | lance, ou aceitar como custo de rankeamento |

---

## Volume mínimo para concluir

| Métrica | Volume mínimo | Abaixo disso |
|---|---|---|
| CTR | **~500 impressões** | é ruído — dizer explicitamente |
| CVR / conversão | **~10 cliques** | não há conversão medida |
| "não vende" como conclusão | **~45 cliques** | abaixo disso, zero venda ainda tem chance razoável de ser azar |

Probabilidade de zero venda ser **só azar**, com conversão saudável de 10%:

| Cliques | Chance |
|---|---|
| 10 | ~35% |
| 14 | ~23% |
| 21 | ~11% |
| **45** | **<1%** |

📌 **A pressa em otimizar dado insuficiente é o erro mais comum de quem está aprendendo:**
você mata palavra boa porque ela deu azar nos primeiros 4 cliques.

---

## Atribuição — por que o número de hoje muda amanhã

- **Janela de 7 dias** para Sponsored Products em conta de vendedor (3P). Quem clica na
  segunda e compra no sábado é creditado **na segunda** — a data do **clique**, não a da
  compra.
- **Sponsored Brands e Display usam 14 dias.** Comparar ACOS entre formatos sem lembrar
  disso gera conclusão errada.
- **Todo número dos últimos 28 dias é provisório.** A Amazon continua processando
  cancelamentos, devoluções e validação de tráfego. O relatório puxado há três semanas não
  vai bater se você puxar de novo hoje.

### O que fecha e o que não fecha com o dia

| Fecha com o dia | Não fecha com o dia |
|---|---|
| Impressão, clique, CTR, gasto | **Compras e vendas** |

O rodapé do próprio console diz: *"atribuição de conversão baseada na data do tráfego"*.

📌 **Consequência prática: não tome decisão de lance com dados de ontem.** A venda pode
ainda não ter sido atribuída, e você vai concluir que a palavra não converte quando ela
converteu. **Trabalhe com janela fechada de 7 ou 14 dias, com pelo menos 3 dias de folga do
presente.**

---

## As três fases de um produto

A fase muda o que é "bom". O mesmo ACOS pode ser vitória ou desastre.

| Fase | Objetivo | ACOS aceitável |
|---|---|---|
| **Lançamento** | Velocidade de venda, primeiras avaliações, BSR | alto — 30–60%, e às vezes acima |
| **Crescimento** | Ampliar termos que já convertem, ganhar impression share | convergindo para a margem |
| **Maturidade** | Lucro; orgânico carrega o volume | abaixo da margem; **TACOS** é o número que importa |

⚠️ **O período de lua de mel** (primeiras semanas de um ASIN novo) dá impulso extra de
ranqueamento. É o momento de mais investir — e o momento em que ficar sem estoque custa
mais caro.

---

## Relatórios: qual responde o quê

| Pergunta | Relatório |
|---|---|
| Que buscas acionaram meu anúncio, e quais converteram? | **Termo de busca** |
| Minhas palavras estão caras? convertem? | **Palavra-chave / Segmentação** |
| Vale ligar ajuste de topo de busca? | **Posicionamento** |
| Alguma campanha está vendendo outro SKU? | **Produto comprado** |
| Tenho espaço para crescer nesse termo? | **Participação de impressão** |

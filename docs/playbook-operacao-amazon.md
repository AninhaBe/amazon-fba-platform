# Playbook de operação — Amazon (precificação, recompra, reciclagem)

Regras operacionais **adotadas pela Ana em 14/09/2026**, absorvidas de um
workshop externo ("Máquina de Vendas Online", set/2026) e adaptadas à nossa
operação. Este doc registra o que foi adotado, com a conta de cada regra, e o
que foi **rejeitado de propósito** — para ninguém reabsorver a parte ruim do
material no futuro.

Relação com os outros docs: a mecânica de Ads (leilão, lances, colheita,
créditos) mora em [`amazon-ads.md`](./amazon-ads.md); este doc é a camada de
**decisão comercial** por cima — margem, recompra, ciclo de vida do produto.

## 1. Precificação: piso de 25% de margem líquida, antes do Ads

Todo produto novo nasce precificado com **no mínimo 25% de margem líquida**:

```
preço − comissão − tarifa FBA − imposto − custo do produto ≥ 25% do preço
```

O racional (da Ana, verbatim na decisão: "o ads inicial se paga"): é essa
margem que banca o tráfego pago da fase de lançamento sem o produto operar no
vermelho. Margem fina + Ads de lançamento = prejuízo garantido; margem de 25% +
Ads = investimento recuperável.

**Pré-requisito estrutural:** custo cadastrado no NEXO para todo produto. Sem
custo, a margem é chute e nenhuma régua abaixo existe. (Doutrina de 02/09/2026:
cadastrou o custo, a conta certa vira responsabilidade do sistema.)

### As réguas de ACOS que derivam do piso

Com margem de 25%, as réguas por produto ficam:

| régua | valor | significado |
|---|---|---|
| ACOS de cruzeiro | ~12,5% (metade da margem) | operação saudável em regime |
| ACOS máximo | 25% (a margem) | Ads comeu a margem inteira — só tolerável em fase de ranqueamento |
| Acima da margem | 33–40% (ROAS 2,5–3,0 do plano de set/2026) | **investimento declarado** de posicionamento, nunca estado permanente que ninguém percebeu |

A regra que amarra: ACOS acima da margem é aceitável **enquanto for decisão
escrita de ranquear** (fase do plano em `amazon-ads.md`). Quando a fase fechar,
a campanha volta para as réguas de cruzeiro.

### Posição não é objetivo — o lance vem da margem

Observação da Ana em 14/09/2026 (observação, não regra definitiva): **não
precisamos do melhor lance para aparecer primeiro; posições além da primeira
também vendem.** A pergunta operacional não é "quanto custa ficar em
primeiro?" e sim "quanto a margem me deixa pagar por clique?" — e aceita-se a
posição que esse lance comprar.

Contexto de estudo que apoia a observação (do `amazon-ads-especialista.pdf`,
não decidido por ninguém — se a prática mostrar outra coisa, atualize aqui):

1. o leilão funciona como **segundo preço ajustado** — lance alto demais não
   custa nada até entrar um concorrente agressivo, e aí o CPC sobe até o seu
   teto sozinho; mais um motivo para o teto vir da margem;
2. o **topo da busca tende a ser o clique mais caro**, não o mais eficiente —
   meio de página, restante da busca e páginas de produto costumam converter
   com CPC menor;
3. **posição paga não é ranqueamento** — o orgânico é construído por venda e
   conversão, e a venda vinda da posição 4 vale o mesmo que a da posição 1.

Corolário prático: começar com lance conservador, e **subir lance só quando a
campanha prova que converte** — clique mais caro deve comprar venda, não
vitrine.

⚠️ Nada aqui autoriza mexer em lance diariamente. Continuam valendo as regras
já combinadas: deixar o dado acumular (volume mínimo de cliques antes de agir,
atribuição demora até 72h), uma mudança por vez, análise campanha por campanha.

### Preço vs concorrência

O workshop tolera preço até 30% acima da concorrência, apostando em anúncio
forte (fotos, avaliações, posição paga). **Adotado como teto aspiracional, não
como ponto de partida:** no estágio atual (poucas avaliações, Ads acumulando
dado), quanto mais perto do menor preço FBA do nicho, melhor a conversão. O
teto de 30% só vale para anúncio maduro.

## 2. Recompra por curva ABC — a fórmula

A regra mais valiosa do material. Vira **feature do NEXO** (aprovada, ver
`TODO.md` → "Alerta de recompra por curva ABC"); até lá roda como rotina manual
com os dados do sync.

**Classificação (por faturamento acumulado, tipo Pareto):**

- **Curva A** — produtos que somam 80% do faturamento → alvo de **60 dias** de estoque
- **Curva B** — os próximos 15% → alvo de **30 dias**
- **Curva C** — os últimos 5% → alvo de **30 dias**

**Fórmula da recompra:**

```
média diária = vendas dos últimos 7 dias ÷ 7
alvo         = média diária × 60 (curva A)  ou  × 30 (curva B/C)
recomprar    = alvo − estoque atual (FBA + em trânsito)
```

**Gatilhos:**

- vendeu **metade do estoque inicial** do item → já pode recomprar;
- **nunca deixar zerar**: ruptura de estoque derruba o ranqueamento que o Ads
  pagou para construir. Mínimo de 60 dias de cobertura para curva A.

**Compra nova segue lateralidade:** mais SKUs com menos unidades (10–20
produtos, 10–30 unidades cada), aprofundando só quem provar curva A. Proteção
contra quebra de estoque e contra guerra de preço num SKU só.

## 3. Lançamento: cupom nos 30 primeiros dias

Todo ASIN novo nasce com **cupom de ≥5%** no primeiro mês de vida ("lua de
mel": a Amazon dá exposição extra a produto novo, e a tag verde de desconto
aumenta conversão). Custo real baixo — menos da metade dos compradores usa o
cupom — e casa com a campanha automática de lançamento do plano de Ads.

## 4. Ciclo mensal de reciclagem

Uma vez por mês, cada produto passa pela régua de **margem realizada**
(o workshop chama de "MPA") e ganha um veredito escrito:

| margem realizada | classe | ação |
|---|---|---|
| < 5% | ruim | candidato a queima |
| 5–10% | duvidoso | negociar com fornecedor, otimizar Ads |
| > 10% | bom | manter / recomprar |
| > 15% | ótimo | escalar |

**Antes de queimar, o produto precisa de teste justo:** ~90 dias de vida com
tráfego suficiente para julgar conversão. (O workshop sugere "10× o preço de
venda em Ads" como piso de investimento; usamos como ordem de grandeza, não
como regra — o critério real é cliques suficientes + o freio de compras/semana
do plano de Ads.)

**Protocolo de queima** (decidiu eliminar):

1. entra na lista de "não recomprar";
2. preço reduzido brutalmente (recuperar caixa, não margem — mas nunca margem
   negativa);
3. pausa **todas** as campanhas normais do produto;
4. entra numa **campanha automática só de liquidação**, com lance baixo.

## 5. O que foi REJEITADO do material — e por quê

Registrado para não ser reabsorvido:

- **"Avaliação negativa → retira 100% do estoque e recadastra o produto."**
  Rejeitado. Custo logístico absurdo (remoção FBA + reenvio), joga fora o
  histórico de ranqueamento, e recadastrar para escapar de avaliação é o tipo
  de padrão que a Amazon pode ler como manipulação — risco de conta. Resposta
  certa a avaliação negativa: melhorar o anúncio e diluir com avaliações novas
  (Solicitar Avaliação — feature já aprovada no TODO — e Vine quando houver
  marca).
- **Oferta "independente da margem" (estratégia 7/45).** Contradiz o próprio
  piso de 25%. Pico de vendas com margem zero só se paga se o ranqueamento
  sobreviver — com estoque raso, queima curva A para nada.
- **Estrutura de 5 campanhas por produto** (automática geral + automática
  individual + kw + produto + categoria). Prematura no volume atual: dilui
  orçamento e cada campanha demora semanas para acumular dado decisível. A
  nossa estrutura (automática + manual por produto, colhendo termos) é a versão
  enxuta; a do workshop vira meta para quando estoque e orçamento crescerem.
- **"ACOS acima do máximo → diminui o lance" como reflexo diário.** A regra só
  vale com volume mínimo de cliques; abaixo disso é ruído (ver §1).

## Changelog

- **14/09/2026** — doc criado; regras adotadas pela Ana (piso de 25%, recompra
  ABC como feature, cupom de lançamento, ciclo mensal, rejeições registradas).

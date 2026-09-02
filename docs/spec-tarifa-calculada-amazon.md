# Spec da dona (02/09/2026): tarifa CALCULADA por pedido, API vira conferência

Texto da Ana, verbatim, recebido em 02/09/2026. É a spec de referência da frente.
O mapa "já existe vs. delta" está no fim — atualizar conforme os deltas fecham.

---

## CONTEXTO (verbatim)

No Dashboard Amazon, o resumo financeiro considera toda venda pela DATA DO PEDIDO,
independente do status (pendente, confirmado, liquidado). Isso está correto e deve
continuar assim.

Faturamento está correto. Custo dos produtos está correto (vem do cadastro interno).
O problema está nas TAXAS.

Hoje o sistema depende do valor de tarifa que a Amazon publica. Só que a Amazon só
publica a tarifa real quando o pedido é confirmado/entra na liquidação (financial
events / settlement report), o que leva dias. Enquanto o pedido está pendente, a
Amazon NÃO devolve o valor das tarifas. Resultado: o lucro do dia sai errado (taxas
subestimadas, margem inflada) e só ficaria correto dias depois — o que inviabiliza a
tela, porque o objetivo dela é dar lucro do dia, hoje.

## O QUE PRECISA SER FEITO (verbatim)

Toda tarifa passa a ser CALCULADA por pedido a partir de uma tabela de tarifas da
Amazon cadastrada no sistema, e não mais apenas lida da API. O valor da API deixa de
ser a fonte primária e passa a ser o valor de CONFERÊNCIA, que substitui a estimativa
quando chega.

Regra central:
- Pedido sem tarifa oficial publicada  -> usa TARIFA CALCULADA (fonte = "estimada")
- Pedido com tarifa oficial publicada  -> usa TARIFA OFICIAL   (fonte = "oficial")
- Nunca somar as duas para o mesmo pedido. É uma ou outra, nunca as duas.

### 1. TABELA DE TARIFAS (cadastro, não hardcode)

Criar uma entidade de tarifas parametrizável, versionada por vigência
(vigencia_inicio, vigencia_fim), para que reajustes da Amazon não quebrem o histórico.
Um pedido antigo sempre recalcula com a tabela vigente NA DATA DO PEDIDO.

Componentes a modelar:

a) Comissão por categoria (referral fee)
   - percentual por categoria da Amazon
   - base de cálculo: preço do item + frete cobrado do comprador (conforme regra da
     categoria), ANTES de cupom quando for o caso
   - percentual pode variar por faixa de preço dentro da mesma categoria
   - comissão mínima por item, quando existir

b) Tarifa fixa / tarifa por item (quando aplicável à categoria ou faixa de preço)

c) Tarifa de logística
   - FBA: tabela por faixa de peso e dimensão (peso cubado x peso real, usar o maior)
   - FBM / gerenciamento de pedido: valor por pedido, quando aplicável
   - O seller opera majoritariamente FBA, então a tabela FBA é prioridade

d) Descontos/abatimentos que afetam a base: cupom, promoção, frete grátis

NÃO entram no cálculo por pedido (são custo de período, não de pedido):
armazenagem, tarifa de estoque antigo, custos de remoção, assinatura mensal do plano
profissional. Se forem exibidos, que seja em linha separada, nunca dentro de "taxas do
pedido", senão distorce a margem unitária.

### 2. DADOS QUE CADA PRODUTO PRECISA TER

Para o cálculo funcionar, o cadastro de produto precisa de:
- categoria de comissão da Amazon (mapeada para a tabela de tarifas)
- peso e dimensões da embalagem (para a faixa FBA)
- modalidade logística (FBA/FBM)

Criar um alerta na tela, no mesmo padrão do "Cadastrar custo de X produto(s)", para
"X produto(s) sem categoria/peso cadastrado" — sem isso a tarifa fica estimada por
fallback.

Fallback quando faltar dado: usar um percentual padrão configurável nas
configurações da conta e marcar o pedido com flag "tarifa por fallback", para o
usuário saber que aquele número é aproximado.

### 3. GRAVAÇÃO POR PEDIDO

Cada pedido deve armazenar:
- taxa_comissao_calculada, taxa_logistica_calculada, taxa_fixa_calculada, taxa_total_calculada
- taxa_total_oficial (null enquanto a Amazon não publicar)
- fonte_taxa: 'estimada' | 'oficial' | 'fallback'
- versao_tabela_tarifa usada
- diferenca_estimado_vs_oficial (calculada quando a oficial chega)

### 4. RECONCILIAÇÃO

Job que, ao sincronizar financial events / settlement, substitui a estimativa pela
tarifa oficial, muda fonte_taxa para 'oficial' e grava a diferença. Todos os cards
(Taxas, Lucro, Margem, ROI) recalculam a partir daí. O histórico não deve "pular":
a troca é de valor, não de regra.

Guardar a diferença permite depois medir a acurácia da estimativa e calibrar a tabela.

### 5. AJUSTES NA TELA (bugs atuais)

- O card "Taxas" hoje mostra R$ 58,99 enquanto o Lucro está descontando R$ 312,43
  (58,99 + 253,44 estimados). O card DEVE exibir exatamente o mesmo total usado no
  cálculo do lucro. Quebrar em duas linhas dentro do card: "oficial: R$ X" e
  "estimada: R$ Y", com o total em destaque.
- Trocar o texto "ainda não liquidado" por algo como "X de Y pedidos com tarifa
  estimada pela tabela — substituída pela oficial na liquidação".
- Os avisos de Lucro e Margem falam em "15 de 50 pedidos" enquanto o topo fala em 61
  vendas/61 pedidos. Unificar a base de contagem em todos os cards (definir claramente
  o que é pedido e o que é unidade) e usar a mesma query.
- Pedidos cancelados: definir e documentar a regra. Cancelado antes do envio não deve
  gerar comissão nem entrar no faturamento realizado; se o card "Canceladas"
  (R$ 22,90) está sendo abatido em algum lugar, deixar explícito.

### 6. CRITÉRIOS DE ACEITE

- Nenhum pedido no período pode aparecer com taxa = 0, exceto cancelado antes do envio.
- Faturamento − Custo dos produtos − Taxas totais − Ads = Lucro. A conta tem que
  fechar exatamente com os números exibidos nos cards, sem valor oculto.
- Um pedido pendente e o mesmo pedido depois de liquidado devem apresentar diferença
  de taxa dentro de uma tolerância pequena; se estourar, logar para revisão da tabela.
- Trocar a data de referência de um pedido para uma vigência anterior deve recalcular
  com a tabela daquela vigência.
- Testes unitários cobrindo: comissão com faixa de preço, comissão mínima, FBA por
  peso cubado maior que o real, cupom reduzindo a base, produto sem categoria
  (fallback), e substituição de estimada por oficial.

---

## Mapa: o que já existe (em produção, v232) vs. o que é delta

**Já existe e fica** (implementado 31/08–02/09, ver `tarifas-amazon-br.md` e ADR-027):
- Regra central inteira: estimada quando não há oficial, oficial substitui na
  liquidação (`superseded_at`), nunca as duas somadas (view
  `workspace_channel_order_fees_efetivas`).
- Comissão por categoria com faixa MARGINAL, mínimo por item (`max(pct×preço, mín)`),
  mapeamento explícito de categoria.
- FBA por preço/peso com peso cubado vs. real (maior) + 20 g de embalagem.
- Reconciliação via financial events (job existente) e view de acurácia.
- Preço do anúncio como base quando o pedido pendente vem sem preço (Listings Items).
- Procedência gravada por linha e exibida na tela.

### ⚠️ O grão da view `workspace_channel_order_fees_efetivas`, e onde ele para

A view agrega por **(pedido, fee_type)** e **soma** o valor. Isso é anterior à
data de lançamento e sempre foi assim: dois estornos do mesmo pedido já viravam
uma linha só, com os valores somados.

A migration 0030 acrescentou `posted_at` como `MAX(...)` — a data do lançamento
mais recente do grupo. **A data do outro lançamento não sobrevive.** O tamanho do
efeito está medido na 0029: mediana de 11 dias entre pedido e lançamento, e 5 dos
42 estornos mudam de mês. Se dois estornos do mesmo pedido caírem em meses
diferentes, a view põe os dois no mês do mais recente.

📌 **Leitor que precisar do grão por estorno lê `workspace_channel_order_fees`,
não esta view.** Hoje nenhum precisa — por isso a decisão de 02/09/2026 foi
aceitar o colapso sem ADR. No dia em que um leitor real precisar do grão, a
conversa reabre e o desenho muda; não contorne com um `DISTINCT` por cima.

⚠️ E o motivo de isto estar escrito em dois lugares (aqui e no `COMMENT ON VIEW`)
é que quem esbarra no problema costuma estar no `psql`, não no repositório.

**Delta a construir** (a spec muda/acrescenta):
1. Tabela de tarifas como **cadastro versionado por vigência** (hoje é constante
   versionada em código com URL+data) — recálculo pela vigência da data do pedido.
2. Base da comissão com **frete cobrado do comprador** e **cupom antes/depois
   conforme a regra da categoria** — conferir o que a base atual inclui.
3. **FBM/gerenciamento de pedido** (baixa prioridade — operação é FBA).
4. Cadastro de produto: **peso/dimensões/modalidade** editáveis + **alerta na tela**
   "X produto(s) sem categoria/peso" no padrão do alerta de custo.
5. **Fallback configurável** nas configurações da conta + `fonte_taxa='fallback'`
   (decisão dela 02/09 — substitui o "não-mapeado fica null" como comportamento de
   tela; o null continua internamente como "não calculável sem fallback").
6. Campos novos: `versao_tabela_tarifa`, `diferenca_estimado_vs_oficial` (+ alarme
   de tolerância estourada).
7. Tela: card Taxas = MESMO total que o lucro desconta, com linhas "oficial/estimada"
   (bug real hoje: card 58,99 vs lucro descontando 312,43); texto novo da marca;
   **unificar base de contagem** dos avisos (pedidos vs unidades, mesma query);
   regra de cancelados definida e documentada.

# Pesquisa de mercado com o NEXO — método e o caso de validação

Doc interno criado em 18/09/2026 a pedido da Ana. Registra **como** a pesquisa
de mercado com o NEXO funciona e **a prova de que funciona**: o caso da conta
do Lucas, primeira operação a usar o NEXO como ferramenta de pesquisa na
Amazon. Confirmação da Ana, 18/09/2026: *"todos os que entraram no FBA
recentemente são via pesquisas do NEXO"*.

## 1. O método

A pesquisa responde uma pergunta por produto: **"se eu entrar neste nicho pelo
FBA, sobra margem?"** — e responde medindo, não achando. O processo (hoje
encapsulado nas skills `pesquisa-produto-amazon` e
`pesquisa-catalogo-fornecedor`):

1. **Partir do custo real** — preço do fornecedor com as condições comerciais
   (pedido mínimo, frete, imposto de entrada), não o preço de tabela.
2. **Medir a concorrência DENTRO do FBA** — quem vende por FBA no nicho, e o
   **menor preço FBA** (via `competitiveSummary` da SP-API). Concorrente de
   envio próprio não disputa a mesma buy box de fato.
3. **Projetar a margem no menor preço FBA** — comissão + tarifa de logística +
   imposto + custo contra o pior cenário de preço. Se sobra margem no pior
   cenário, o produto entra na lista.
4. **Entrar com lateralidade** — muitos candidatos com pouca profundidade
   (regra do playbook: `playbook-operacao-amazon.md` §2), porque o passo
   seguinte é o mercado dizer quem fica.

**Característica do funil, não defeito:** parte dos candidatos morre rápido e
barato. No caso abaixo, SKUs novos que venderam 2–4 unidades e pararam
conviveram com SKUs que entraram direto para o top 10 da conta. É o desenho:
o custo de errar um candidato é pequeno; o valor de acertar é composto.

## 2. O caso — conta do Lucas (amazon:A15NQMF7A6J1Y0)

Conta com ~1 ano de operação e 71 SKUs de catálogo. A partir de **~25/08/2026**
o Lucas passou a escolher produtos novos pela pesquisa do NEXO; a primeira
estreia da safra nova vendeu em **31/08**. Corte usado nas medições:
primeira venda ≥ 25/08/2026 = safra "nova (NEXO)".

**Medido em 18/09/2026, no banco de produção (pedidos não cancelados):**

| | SKUs | Pedidos set (até 18/09) | Unidades set |
|---|---|---|---|
| Catálogo antigo | 71 | 775 | 889 |
| **Safra nova (NEXO)** | **26** | **298** | **348** |

- **Setembro (18 dias): a safra nova já é ~28% dos pedidos e unidades.**
- **Últimos 7 dias: ~31%** (169 de 549 pedidos) — participação **subindo**
  semana a semana.
- **12 dos 25 mais vendidos da semana** são da safra nova.
- Velocidade de estreia: `SILV-GEL-10000` estreou em 13/09 e em 5 dias era o
  **6º mais vendido da conta inteira** (26 unid/semana); `CK7896` e `TOP2909`
  chegaram ao top 10 em ~2 semanas.
- O contexto que dá peso ao número: o catálogo antigo vinha **encolhendo há 3
  meses** (unidades/mês: 3.498 em jun → 2.129 em jul → 2.100 em ago → ritmo
  projetado de ~1.480 em set). A safra nova entrou adicionando ~580
  unidades/mês de ritmo — segurou o volume total da conta estável em plena
  queda do catálogo antigo.
- Contraexemplo saudável: `TOP0911` e `CK7895` venderam 2–4 unidades e
  pararam — o funil descartando candidato barato.

### Pendência datada — % de crescimento do faturamento em R$

**Ainda não medível com honestidade (18/09):** a Amazon publica o valor dos
pedidos com atraso, e 881 das 889 unidades de setembro do catálogo antigo (e
quase toda a safra nova) estavam **sem preço publicado** no banco. `null` ≠ 0:
o dado não chegou, não é zero — somar o publicado e chamar de faturamento
subestimaria os dois grupos e distorceria a comparação. **Refazer no
fechamento de setembro** (início de out/2026), quando os preços tiverem
postado, e registrar aqui o % por safra.

## 3. O que medir a cada mês (para este doc continuar verdadeiro)

1. **Faturamento por safra** (quando os preços do mês postarem) — % da safra
   nova sobre o total, e crescimento do total vs média pré-NEXO.
2. **Sobrevivência da safra** — dos SKUs novos, quantos viraram curva A/B
   (régua do `playbook-operacao-amazon.md` §2) e quantos morreram; a taxa de
   acerto do funil é o número que valida o método, não um hit isolado.
3. **Ritmo do catálogo antigo** — para não atribuir à pesquisa um crescimento
   que seja da sazonalidade da conta inteira (se o antigo voltar a crescer
   junto, o mérito é do mercado, não do método).

### Como re-medir (consulta base)

Cohort por primeira venda, na tabela canônica, sempre excluindo cancelados:

```sql
WITH safra AS (
  SELECT i.sku, CASE WHEN min(o.occurred_at) >= '2026-08-25'
                     THEN 'nova (NEXO)' ELSE 'antiga' END grupo
  FROM workspace_channel_order_items i
  JOIN workspace_channel_orders o
    USING (workspace_id, provider, connection_id, external_order_id)
  WHERE i.connection_id = 'amazon:A15NQMF7A6J1Y0' AND o.status <> 'cancelled'
  GROUP BY i.sku)
SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') mes,
       s.grupo,
       count(DISTINCT i.external_order_id) pedidos,
       sum(i.qty) unidades,
       round(sum(i.qty * i.unit_price)::numeric, 2) fat_publicado,
       sum(CASE WHEN i.unit_price IS NULL THEN i.qty ELSE 0 END) unid_sem_preco
FROM workspace_channel_order_items i
JOIN workspace_channel_orders o
  USING (workspace_id, provider, connection_id, external_order_id)
JOIN safra s ON s.sku = i.sku
WHERE i.connection_id = 'amazon:A15NQMF7A6J1Y0' AND o.status <> 'cancelled'
GROUP BY 1, 2 ORDER BY 1, 2;
```

⚠️ Ao ler `fat_publicado`, conferir `unid_sem_preco` do mesmo período: se for
relevante, o faturamento daquele mês **ainda não fechou** — não compare.

## 4. Uso futuro

- Quando o % de faturamento fechar, este caso vira a base de um **material de
  divulgação** do NEXO ("cliente real, X% do volume vindo de produtos achados
  pela pesquisa em N semanas") — a Ana decide o formato.
- O mesmo comparativo, generalizado (safra por data de estreia × faturamento),
  é candidato natural a **feature do produto**: mostrar ao vendedor o quanto
  cada leva de produtos novos contribui — hoje a conta é manual por SQL.

## Changelog

- **18/09/2026** — doc criado; números de set/2026 medidos; % de faturamento
  pendente até os preços postarem.

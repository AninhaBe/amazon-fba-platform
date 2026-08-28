# ADR-026: Camadas por ciclo de vida — bronze é retenção, não schema

- **Status:** Aceito (28/08/2026 — aprovado pelo cérebro na frente L)
- **Data:** 2026-08-28
- **Decide sobre:** a pergunta "adotar arquitetura medalhão (bronze/silver/gold) ou aprofundar a modelagem relacional?"
- **Não altera:** ADR-001 (modelo canônico), ADR-020 (faturamento). **Executa** o que ADR-016 (ciclo de vida) e ADR-022 Frente 2 (bruto fora do Postgres) já decidiram, dando-lhes o vocabulário de camadas.
- **Base factual:** inventário L1/L2 e parecer L3 da frente L (28/08/2026): banco 468 MB; bronze de fato = 152 MB de `payload`/`raw` dentro do OLTP; silver = canônico com 0 órfãos, 0 divergência gross×itens; gold = overviews JS + cache SWR (9 MB, recomputável).

## Contexto

O NEXO já opera em três camadas implícitas dentro de um único Postgres. A auditoria da frente L mostrou que os defeitos reais são físicos (write amplification, bloat, índices), de cobertura de ingestão (fees) e de higiene relacional — **nenhum** se resolve com infraestrutura de lakehouse, e a ADR-016 já havia rejeitado essa via por desproporção. O único defeito genuíno de *camada* encontrado: estado operacional do produto (`_sellercore`: escrow/statement liquidado, evidência financeira) vivendo dentro da coluna bruta `raw` — o que torna o bronze de Shopee/TikTok inapagável e mistura "o que o canal disse" com "o que o produto concluiu".

## Decisão

**O modelo relacional canônico é e continua sendo o núcleo (a "silver"). Medalhão é adotado como vocabulário de ciclo de vida, não como infraestrutura.**

Três regras:

1. **Bronze é política de retenção, não schema.** `payload`/`raw` são categoria "Bruto" da ADR-016: quentes por N dias no Postgres, depois expurgados ou movidos para object storage. Payload expurgado vira `NULL` (nunca `'{}'` fingindo payload vazio — `null` = "não temos", coerente com a regra null≠0).
2. **Estado do produto nunca vive em payload/raw.** `raw` é imutável após a escrita e descartável por retenção. Toda conclusão do produto sobre um pedido (liquidação, evidência, tentativas) vive em **coluna própria**. O namespace `_sellercore` fica proibido para chaves novas e é extinto quando a migração de colunas (frente L, recomendação R2) concluir.
3. **Gold é derivado e recomputável.** Agregação materializada só nasce com consumidor real que a exija, medição que a justifique e ADR próprio — nunca "por arquitetura". (É a mesma regra que adiou o ledger em `canonical-schema.md`; o materializer legado com 3,0 M de updates em 12 linhas é o contraexemplo que esta regra impede de repetir.)

## Gatilhos objetivos para reabrir esta decisão

- Silver (dado operacional canônico) acima de ~50 GB; ou
- carga analítica real cruzando inquilinos (benchmarks, ML sobre histórico) competindo com o orçamento de 1 s do OLTP (ADR-017); ou
- mais de um pipeline analítico por canal mantido à mão em JS.

Nenhum está no horizonte medido (crescimento atual: ~4,9 MB/dia, 85% de um único workspace).

## Alternativas consideradas

- **Medalhão formal (lakehouse/warehouse externo):** rejeitado por desproporção — reafirma ADR-016 com os números de 28/08. Não resolve nenhum defeito medido e duplica bytes num banco cujo problema é excesso deles.
- **Schemas bronze/silver/gold no próprio Postgres:** rejeitado — renomeia o que existe, custa migração de tudo e tende a criar mais escrita (MVs) no banco cujo defeito nº 1 é escrever demais.

## Consequências

- ➕ Destrava a retenção do bronze de Shopee/TikTok (hoje bloqueada pelo `_sellercore`).
- ➕ A direção fica gravada: próxima pessoa não guarda estado em `raw` nem propõe warehouse por reflexo.
- ➖ Disciplina sem enforcement de ferramenta; mitigado pela regra 2 ser verificável em review (grep por `_sellercore`/jsonb_set em raw) e pelo strip de `stripReservedCanonicalMetadata` (`src/lib/integrations/canonicalMetadata.ts`) passar a rejeitar em vez de preservar, ao fim da R2.
- ➖ Reprocessar pedido com bronze expurgado exige rebuscar na API do canal (aceito na ADR-016; janela de N dias cobre o uso real).

## Condições registradas para o desenho do expurgo (R2-b/retenção)

- **NF-e da Shopee lê `raw` (28/08/2026, condição do cérebro):** a faixa "pedido
  aguardando NF-e" lê `raw->invoice_data` (`status`/`pending_reason`, mantidos
  pelo sub-allowlist de `sanitizeShopeeOrder`). Quando o expurgo do bronze for
  desenhado, esses campos precisam **(a)** ficar fora do expurgo enquanto o
  pedido estiver com nota pendente, ou **(b)** migrar para coluna nesse dia —
  senão o expurgo apaga uma pendência operacional viva da tela.

  ⚠️ **O modo de falha é silencioso e parece boa notícia** (medido pelo Delta em
  28/08/2026, ao conferir o índice parcial da migration 0017): com o `raw`
  expurgado, a consulta não falha — ela devolve **zero notas pendentes**, e a
  tela lê isso como "está tudo em dia". É o mesmo padrão do `acos = 0` que o ML
  devolve quando não houve venda: **ausência virando boa notícia**. Não há
  violação da regra 2 aqui (`invoice_data` é dado que a Shopee entrega, não
  conclusão nossa), mas a dependência precisa ser resolvida *antes* do expurgo,
  não depois.

# Estado do turno — 29/08/2026, 15:00Z (backend)

Foto do que está no ar, do que ficou pendente **com nome**, e do que precisa da
Ana. Escrito para sobreviver a um reinício de contexto.

## No ar agora

- **v191** na máquina (`fly status`, nunca a lista de releases).
- **Quatro canais sincronizando**: shopee 3 min, ML 5 min, amazon 10 min,
  tiktok 10 min. A Shopee voltou às **14:26:05Z** com o contador zerado para ela.
- **Coletor de métricas antigo desligado** (`METRICS_PORT=-1`) desde ~02:59Z.

## O que mudou hoje, por frente

| Frente | O quê |
|---|---|
| **Auth** | Uma renovação de sessão em voo por vez entre requisições — conserto do 409 que trancou a dona para fora |
| **Erro honesto** | Login, TikTok (2 telas) e isolamento de provider param de culpar a usuária quando a falha é nossa (`INFRA_INDISPONIVEL`) |
| **Liveness** | `/api/vivo` (não toca o banco) é o check do Fly; `/api/health` segue com 503 honesto |
| **Pools** | Usuário 8 / fundo 5; os oito `after()` passaram a rodar como fundo, por porta única |
| **Briefing** | Os três sinais de causa voltaram a existir; falha deixa rastro no log |
| **Tela de produtos** | Venda se prende ao SKU e não ao id do anúncio — a ordenação por volume estava invertida |
| **Escrow Shopee** | Não repete, não pula, carimba toda tentativa, não busca o que já tem; e não morre mais quando a ingestão termina |
| **Contador** | `marketplace_api_calls` nos quatro canais, por endpoint e por hora (ADR-032) |

## Números que valem como referência

- **Cobertura financeira**: ML 100% (37.775 pedidos), TikTok 96%, Amazon 27%
  (mas é **horizonte**: 96% nos últimos 30 dias), Shopee 15% (**0,2%** nos
  últimos 30 dias).
- **Escrow desde as 14:26**: 60 tentativas, **60 liquidadas**, zero erro, zero
  429. Pedidos com tarifa 3.012 → 3.072.
- **Custo do contador**: 1.700 chamadas viram 34 linhas; descarga de 921ms no
  pior caso; 48 kB.
- **Carga da tela**: rota de overview do ML = 14 idas ao pool em 4 ondas.

## ⚠️ Pendências abertas, com nome

1. **Amazon não tem carimbo de tentativa.** `settlement_attempt_at` nulo em
   20.156 pedidos — a mesma armadilha da Shopee, esperando.
2. **Transactions API antes de junho/2026**: apurar se dá para buscar. Se der, é
   backfill; se não der, a tela precisa dizer que esse histórico não existe para
   nós, em vez de mostrar vazio.
3. **62 erros em 1.545 chamadas da SP-API** (`/finances/2024-06-19/transactions`).
   Provável 429 retentado com sucesso; agora toda recusa vira log, então a
   próxima leitura é fato e não inferência.
4. **A conciliação como passo próprio** (ADR-032, item 5). O que está no ar é o
   remendo: um claim dentro de `runShopeeSyncStep`.
5. **Tela de produtos em "todos"**: o total do SKU aparece repetido nas linhas
   irmãs fechadas.
6. **Desvio entre a nossa base e a fonte (Shopee)** nunca foi medido — decisão do
   cérebro enquanto o alerta estiver aberto.
7. **Backfill da ADR-029**: antes de prometer, verificar se o payload cru antigo
   traz o `model_id`. Sem ele o backfill não recupera a variação da venda antiga.
8. **ADR do zero fabricado** (`available_qty NOT NULL`, 435 de 739 anúncios da
   Shopee). Escopo pedido: quantas telas leem `available_qty`, os três estados
   que hoje viram zero, e o que a tela mostra em cada caso.
9. **As 14 idas em 4 ondas**: `getCosts()` roda três vezes na mesma carga, e duas
   ondas existem só por conveniência (early-return e cruzamento em JS).
10. **`/api/central/briefing` é chamado duas vezes** por carga.

## Precisa da Ana

- **Segunda máquina no Fly.** Não maior — a mais. Com uma só, qualquer 503 vira
  apagão no proxy e todo deploy nosso é uma queda para ela. Medido: 2% de CPU e
  143 MB de 985 não pedem máquina maior.
- **Console da Shopee**: qual endpoint e qual hora foram sinalizados no alerta.
  Até saber, o escrow é **candidato forte**, não causa identificada.
- **Ritmo do escrow**: a fila de 17 mil leva ~2,5 dias com o lote em 50. Se ela
  precisar antes, dá para acelerar — mas concentrar chamada com a Shopee olhando
  é o risco que a gente escolheu não correr sem ela saber.

## Não faça sem entender

- **Não apague o claim de conciliação** de `runShopeeSyncStep` por cobertura de
  teste baixa. Ele pode passar semanas sem disparar: é cinto de segurança, não
  motor. O comentário no código explica.
- **Não mexa na guarda de isolamento.** Fechar quando não consegue verificar é o
  comportamento certo; o defeito era a mensagem, e já foi corrigido.
- **Não afrouxe o `statement_timeout`** por reflexo: escrita que precisa de mais
  de 2 minutos é problema por si só.
- **Nenhum número de relógio vale como custo de consulta sem `EXPLAIN ANALYZE`
  ao lado.** Tempo de parede mede o sistema; `Execution Time` mede a consulta.
  A gente reordenou prioridade duas vezes hoje por confundir os dois.
- **Sonda somente-leitura contra produção não é inofensiva.** Leitura que segura
  slot compete igual, e uma consulta que queima os 120s do teto é um bloqueio.
  Avise antes.

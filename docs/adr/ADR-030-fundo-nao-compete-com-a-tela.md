# ADR-030: Trabalho de fundo não compete com requisição de usuário

- **Status:** Aceito e implementado em 29/08/2026 (v172)
- **Origem:** incidente de 29/08/2026 — ver
  [`postmortem`](../postmortem-2026-08-29-pool-esgotado.md)

## Contexto

Havia **um** pool de 10 conexões compartilhado entre tudo: as requisições da
dona olhando a tela e os quatro canais de sync batendo a cada 2 minutos.

Duas medições, feitas na madrugada do incidente, mostram por que esse desenho
não podia funcionar:

| Medida | Valor |
|---|---:|
| Transações no banco por **uma** carga do dashboard | **28** |
| Pool compartilhado | 10 |
| Canais de sync no mesmo pool | 4, a cada 2 min |

**Uma aba do dashboard pede quase três vezes o pool inteiro.** Duas abas, ou uma
aba mais um ciclo de sync, e alguém fica sem slot.

Foi o que aconteceu: requisições de usuário morrendo com `ECHECKOUTTIMEOUT` após
15s, e o dashboard levando **54 segundos** — com as consultas do canônico
executando em **0,030ms**, medidas com `EXPLAIN (ANALYZE, BUFFERS)`.

📌 **Não era consulta lenta. Era fila.** O trabalho é microscópico; o que custava
era conseguir entrar.

## Decisão

### 1. Dois pools, e a assimetria é o ponto

| Pool | `max` | Quem usa |
|---|---:|---|
| Usuário | **8** | requisições de tela (o padrão) |
| Fundo | **3** | sync, cron, retenção |

O fundo **não enxerga** o pool do usuário. A fome deixa de depender de
escalonamento feliz e passa a ser **impossível por construção** — que é a única
forma de garantia que sobrevive a uma madrugada movimentada.

A marcação é por `AsyncLocalStorage` (`runComoFundo`), aplicada nas **cinco**
rotas de cron. Um teste percorre o diretório de cron e falha se uma rota nova
esquecer de se marcar: **uma que esqueça anula a separação inteira.**

⚠️ **Total 11 contra os 10 de antes — conservador de propósito.** O teto de
conexões do tenant no pooler **não é conhecido** (só o painel da Supabase
mostra). Subir para 12+4 poderia trocar fome interna por rejeição no pooler, ou
seja, consertar um problema criando outro. Os dois valores vêm de variável
(`DB_POOL_MAX`, `DB_POOL_MAX_FUNDO`) para subirem **sem deploy** quando o número
for confirmado.

### 2. Intervalo por canal, medido e não arbitrado

O intervalo era 2 minutos para os quatro. O ritmo real de chegada de pedido, em
7 dias de contas reais:

| Canal | pedidos/hora | mediana entre pedidos | intervalo novo |
|---|---:|---:|---:|
| Shopee | 14,1 | 2,3 min | **3 min** |
| Mercado Livre | 6,5 | 4,9 min | **5 min** (tem webhook) |
| TikTok | 2,8 | 11,3 min | **10 min** |
| Amazon | 1,8 | **18,3 min** | **10 min** |

Sincronizar a Amazon a cada 2 minutos com mediana de 18 significa que **9 de
cada 10 ciclos batiam no banco para não achar nada**: pagávamos carga para
descobrir que não havia novidade — e essa carga competia com a tela.

Cada intervalo tem variável própria, pelo mesmo motivo dos pools.

## Resultado medido (29/08/2026, religamento degrau a degrau)

| Estado | Canônico do dashboard (30 dias) |
|---|---:|
| Tudo desligado (linha de base, pool antigo) | 1.457ms |
| Só Shopee | 285ms |
| + Mercado Livre | 313ms |
| + TikTok e Amazon (os quatro de pé) | **281ms** |

Critério de aceitação, definido pela dona e não por nós — *o dashboard carrega
abaixo de 1 segundo com todos os canais de pé* — **cumprido com folga de 3,5×**,
e zero `ECHECKOUTTIMEOUT` desde o religamento.

## Consequências

- ➕ Trabalho de fundo não pode mais matar de fome quem está olhando a tela.
- ➕ ~70% menos batidas de sync, sem perda perceptível de frescor.
- ➖ Atraso máximo do polling sobe (2 → 3/5/10 min por canal). Mitigado pelo
  webhook do ML e endereçado de vez pelo [ADR-031](./ADR-031-tempo-real-e-push.md).
- ➖ Mais um conceito no código (`ehFundo`), que precisa ser lembrado por quem
  escrever rota de cron nova — por isso o teste que varre o diretório.

## Pendências

- **As 28 transações por carga** não foram tocadas. Frente própria e prioritária:
  quantas são sequenciais **por necessidade** e quantas só estão separadas por
  conveniência de código?
- O log ainda imprime `armado: syncs a cada 2 min` na linha final, usando a
  variável antiga. Cosmético, mas **enganoso** — corrigir.

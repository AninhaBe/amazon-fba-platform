# Roteiro da medição — quanto custa o transporte da barreira de inquilino

**Desenhado pelo Delta, executado pelo backend.** Etapa 1 da
[ADR-036](../adr/ADR-036-barreira-de-inquilino-no-banco.md). Produção, v214.

## O que se quer saber, em uma frase

**A rota da Amazon continua dentro do orçamento de 1s da
[ADR-017](../adr/ADR-017-orcamento-de-1s-e-leitura-agregada.md) quando cada
consulta passa a rodar em transação explícita com `SET LOCAL`?**

Não é "quanto custa uma consulta" — isso já foi medido isoladamente em
01/09/2026: **16,1 ms → 64,2 ms de p50, +48 ms**, que são três idas de rede a
mais pelo pooler. O que falta é o efeito na **rota**, que faz **13 `dbQuery` em
4 `Promise.all`** — quatro barreiras em série, e o número real depende do tamanho
de cada grupo.

## O que medir — os quatro números, não um

1. **p50 e p95** da rota, os dois. p50 esconde exatamente o que um pooler no meio
   produz.
2. **Número de idas ao banco** na requisição (`ab4bd9c` já registra isso por
   requisição).
3. **A rota INTEIRA** — auth, proxy e Sales API inclusos —, não só a leitura
   canônica. É a rota inteira que a vendedora espera.
4. A comparação contra o **orçamento de 1s**, e contra os **200 ms** que a
   ADR-017 dá à camada de dados.

## Como ligar e desligar — sem reiniciar nada

A v214 subiu com `DB_CARIMBO_DE_INQUILINO="arquivo"`, que **não liga nada
sozinho**: apenas autoriza a alternância pela presença de um arquivo.

```bash
# LIGAR
fly ssh console --app nexo -C "touch /data/carimbo-de-inquilino.ligado"

# DESLIGAR
fly ssh console --app nexo -C "rm -f /data/carimbo-de-inquilino.ligado"

# CONFERIR
fly ssh console --app nexo -C "ls -la /data/carimbo-de-inquilino.ligado"
```

⚠️ **Espere 5 segundos depois de alternar.** O TTL do cache é 5s por processo
(`TTL_DA_FLAG_MS` em `src/lib/db.ts`) — medir antes disso mede o estado anterior.
Foi para isso que o TTL virou número escrito e travado por teste.

## O desenho: INTERCALAR, não dois blocos

⚠️ **Esta é a parte que decide se o resultado vale.** Medir ligado agora e
desligado depois mistura a variação do momento com o efeito da flag. O desenho é
alternar **várias vezes**:

```
OFF → ON → OFF → ON → OFF → ON   (mínimo 3 pares, 20+ requisições por bloco)
```

Se a diferença sobreviver à intercalação, ela é da flag. Se sumir, era ruído — e
descobrir isso também é resultado.

Entre alternar e medir: os 5s do TTL, sempre.

## Como gerar o tráfego

Sessão da **conta de avaliação**, nunca a da Ana.

⚠️ **A credencial entra por variável de ambiente e não aparece em log, em comando
visível nem em mensagem.** Se em algum momento ela precisar ser lida em texto, o
caminho está errado — refaça.

## A ressalva que vai no corpo do resultado, não no rodapé

**Às 3h40 não há tráfego real.** Então:

> Os p50 e p95 abaixo são de **requisição sintética**, gerada pela medição. Não
> são p50 e p95 de uso real: falta concorrência de verdade, falta cache frio de
> quem chega pela primeira vez, e falta o trabalho de fundo disputando o pool no
> horário em que ele roda.

Essa frase, ou equivalente, faz parte da conclusão. Um número de bancada
apresentado como número de produção é a família de erro que este projeto vem
corrigindo a semana toda.

## Critério de parada — decidido antes de medir

🛑 **Se qualquer requisição passar do orçamento de 1s, DESLIGUE na hora**, sem
perguntar. Depois se discute o número; primeiro sai da frente da vendedora.

O desligamento é `rm -f` no arquivo e vale em 5s — foi para isso que a
alternância barata existe.

## O que fazer com o resultado

| resultado | consequência |
|---|---|
| Rota cabe folgada no orçamento | a etapa 3 pode seguir com transação por consulta |
| Rota cabe apertada | vale a redução de uma ida: emitir `BEGIN` e `set_config` numa chamada só, pelo protocolo simples |
| Rota estoura | o transporte precisa de outro desenho antes de qualquer policy — e é melhor descobrir agora, com a flag desligável em 5s, do que depois |

📌 **Quando a medição terminar, remover `DB_CARIMBO_DE_INQUILINO` do `fly.toml`.**
Sem essa linha não há nem o `stat` — o caminho volta a ser bit a bit o de antes.

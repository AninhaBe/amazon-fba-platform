# Achado — quebrar no lugar errado prova o CONTRÁRIO do verdadeiro

**02/09/2026.** Dois quase-erros do mesmo dia, os dois pegos antes de virarem
relatório. Ficam registrados porque **quase-erro documentado vale tanto quanto
erro** — e porque o primeiro tem forma nova, que a disciplina de "ver vermelho"
do AGENTS.md **não cobre sozinha**.

## O quase-erro que importa

A regra da casa é: teste novo só conta depois de ter falhado. Quebre o código,
veja vermelho, desfaça. Eu fiz isso com `universoPagoDaShopee` — o teste que
nunca tinha rodado.

Tirei o filtro de status desta linha:

```sql
SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS paid_revenue,
```

**O teste ficou VERDE.** Pela regra, a conclusão é imediata e devastadora: o teste
é decorativo, não alcança o que promete guardar. Era o que eu ia reportar.

**E estava errado.** `revenue30d` não vem de `paid_revenue`. Vem de
`faturamento`, dezessete linhas abaixo:

```sql
SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS faturamento,
```

As duas linhas são **textualmente idênticas menos o alias**. O par `paid_*` é
legado, sobrevive só na cobertura (`shopeeOverviewCanonical.ts:803` e `:1071`).
Refeita a quebra no alias certo, o teste ficou vermelho nas três asserções —
esperava 200 e veio 350; 300 e veio 350; 300 e veio 420. **O teste é real, e foi
visto vermelho pela primeira vez em 02/09/2026.**

## 🔴 A regra que isto acrescenta

> **Verde depois de uma quebra tem DUAS leituras: o teste não alcança o código,
> ou a QUEBRA não alcançou o código. Antes de acusar o teste, prove que a linha
> que você quebrou é a que alimenta a asserção.**

A disciplina de ver vermelho protege contra teste decorativo. Ela **não** protege
contra quebra decorativa — e a quebra decorativa é mais fácil de cometer, porque
quem quebra escolhe a linha por leitura, não por medição.

O sintoma que deveria ter me parado antes: o teste ficou verde com `paid_orders`
contando 3 pedidos em vez de 1, e havia uma asserção `paidOrders === 1`. Se a
quebra tivesse alcançado o que eu achava, **essa asserção teria caído**. Verde
onde uma asserção específica deveria cair é sinal de quebra que não pegou, não de
teste frouxo.

**Na prática:** ao quebrar de propósito, confirme o caminho — do campo afirmado na
asserção até a expressão SQL — antes de concluir qualquer coisa do verde. Uma
linha de `grep` pelo nome do campo (`revenue30d`) responde.

## ⚠️ E a causa material, que continua no código

`shopeeOverviewCanonical.ts` tem **dois pares de colunas que contam a mesma
coisa**: `paid_revenue`/`paid_orders` (legado) e `faturamento`/`pedidos_faturados`
(o que a tela usa). O próprio arquivo admite, na linha 996: *"`paid_orders`
passaram a contar o mesmo, e os dois nomes ficam de..."*.

Enquanto os dois existirem, a próxima auditoria tem chance real de repetir o meu
erro e concluir o oposto do verdadeiro. **Não removi** — é código do canal e não
é minha frente. Fica apontado.

## O segundo quase-erro, menor e da mesma família

Rodei `node scripts/ci-preparar-banco.mjs` direto, quebrou com
`ERR_UNKNOWN_FILE_EXTENSION` (ele importa `db.ts`), e eu propus criar um script no
`package.json` com os flags certos.

**Ele já existia desde 30/08/2026** — `npm run ci:preparar-banco`, commit
`315a4e4`, com exatamente os flags que eu ia "acrescentar". Eu chamei o caminho
cru e deduzi a ausência da ferramenta a partir do meu próprio erro de invocação.

Mesma forma do primeiro: **conclusão tirada de um experimento que não testava o
que eu achava que testava.** Um `grep` no `package.json` custava nada.

📌 O que os dois têm em comum, e é o que vale guardar: **sintoma compatível com a
hipótese não é prova dela.** É a mesma frase que o AGENTS.md já usa para o probe
HTTP que devolve 401. Ela vale para quebra de código e para ferramenta ausente
também.

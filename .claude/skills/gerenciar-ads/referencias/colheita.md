# O ciclo de colheita e as negativas

Se houver **um único processo para dominar**, é este. Tudo o mais é ajuste fino; a colheita
é o que faz a conta melhorar sozinha ao longo dos meses.

```
AUTOMÁTICA (descobre)
   │
   ├─→ termo com pedidos ────→ MANUAL EXATA (lance controlado)
   │                              │
   │                              └─→ NEGATIVA EXATA na automática
   │
   ├─→ termo com variações ──→ MANUAL FRASE
   │
   └─→ termo que só gasta ───→ NEGATIVA EXATA
```

## Os gatilhos numéricos

| Sinal no relatório de termos de busca | Ação |
|---|---|
| Termo com **3+ pedidos** | Promover a exata na manual **+ negativar exato na automática** |
| Termo com **10+ cliques e 0 pedido** | Negativa exata |
| Termo com **gasto > 2× a margem unitária** e 0 pedido | Negativa exata, sem esperar mais |
| Termo **irrelevante** (outro produto, outra categoria) | Negativa exata **na hora** — não precisa de volume para decidir |
| Termo com impressão alta e CTR muito abaixo do resto | Não é problema de anúncio: a **listagem não casa** com aquela intenção |

⚠️ **Volume mínimo antes de concluir:** ~500 impressões para CTR, ~10 cliques para
conversão. A pressa em otimizar dado insuficiente é o erro mais comum de quem está
aprendendo — você mata palavra boa porque ela deu azar nos primeiros 4 cliques.

## Como puxar o relatório

Console → **Medição e relatórios** → **Relatórios de publicidade** → tipo **Termo de
busca**, Sponsored Products.

⚠️ **O relatório só mostra termos COM clique** nos últimos 65 dias. Termo que só gerou
impressão não aparece — então "uma linha só" não quer dizer "um termo só foi acionado".

⚠️ **Gasto que não aparece em nenhum termo** normalmente veio de **segmentação por
produto** (a automática também casa por ASIN, não só por busca), que não conta como termo
de busca.

📌 **Trabalhe com janela fechada de 7 ou 14 dias, com pelo menos 3 dias de folga do
presente.** Atribuição tem janela de 7 dias e tudo dos últimos 28 dias é provisório — puxar
"ontem" mostra palavra que converteu como se não tivesse convertido.

---

## Negativas: a faca de dois gumes

É a **única alavanca que reduz gasto sem reduzir alcance útil**. Também é a única que, mal
usada, mata tráfego bom de forma **invisível** — você nunca vê o que deixou de aparecer.

| Tipo | Bloqueia | Use quando |
|---|---|---|
| **Negativa exata** | Só aquela busca exata (e plurais) | **Padrão.** Um termo específico gasta sem converter. |
| **Negativa de frase** | Qualquer busca que contenha a expressão | Uma **ideia inteira** é irrelevante. Ex.: vende protetor de silicone e "de feltro" nunca serve. |
| **Produto negativo** | Um ASIN ou marca específica | Você aparece na página de um produto onde nunca vai ganhar. |

### A regra de escalada

**Comece sempre em exata.** Só suba para frase depois de confirmar em **dois ou três
ciclos de relatório** que a irrelevância é consistente.

🔥 Uma negativa de frase mal colocada pode derrubar **40% do tráfego** de uma campanha, e
você só descobre semanas depois olhando uma queda de impressão sem causa aparente.

### Onde a negativa mora

- **Nível de campanha** — vale para todos os grupos. É onde vai a negativa do termo
  promovido (par automática+manual) e o bloqueio de lixo geral.
- **Nível de grupo** — quando há grupos com intenções diferentes e você quer separar.

**Nesta conta a negativa é só exata**, de propósito: negativar em frase mataria também as
variações que o grupo Frase existe para capturar.

### Caminho no console

Campanha → **Segmentação negativa** → **Adicione palavras-chave negativas**. O tipo
"Exata negativa" já vem selecionado por padrão.

---

## O que já foi colhido nesta conta

| Data | Campanha | Termo | Ação | Motivo |
|---|---|---|---|---|
| 16/08 12h05 | `Auto - Martelo` (`A09902661J0ZF8TYDHJC8`) | `martelo` | Exata negativa | R$ 8,90 de R$ 10,94 da campanha iam para a palavra mais genérica da categoria |

Antes disso a lista de negativas da automática do martelo estava **vazia** — enquanto a
manual do mesmo produto carregava as mesmas 8 palavras. As duas leiloavam entre si.

📌 **Ao migrar termo novo para a manual, negativar na automática NA MESMA HORA.** Não
deixar para depois: o intervalo entre as duas ações é exatamente o período em que você
paga mais caro pelo próprio clique.

## Pendência de colheita aberta

- **`Manual - Clips 320`** — em 16/08 fez **804 impressões para 1 clique (0,12%)**, contra
  0,83% nos dias anteriores. Volume acima do limiar, então é conclusão, não ruído. Puxar o
  relatório de termos e achar o que absorveu as impressões. Suspeita: o **grupo Frase**
  abrindo demais (Exata não alarga sozinha).
- ⚠️ **`clip`/`clipe` puxam `nail clippers` e `hair clippers`** no autocomplete da Amazon.
  Em exata e frase isso fica contido; **se algum dia virar ampla, negativar antes**.

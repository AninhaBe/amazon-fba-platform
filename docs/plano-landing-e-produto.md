# Plano — a landing É o produto

**23 de agosto de 2026** · revisão 2 · plano para discussão, **antes** de implementar

---

## O que mudou desde a revisão 1

Duas ideias caíram. As duas por motivo de produto, não de gosto.

### ❌ "Cole seu relatório" — descartado

A revisão 1 propunha a pessoa soltar o relatório da Amazon na landing e ver o próprio
lucro em um segundo. Morreu por dois motivos:

**O relatório não é um download — é um pedido.** Nosso próprio código prova
(`src/lib/reports.ts:35`): esperamos até 2 minutos, com o comentário *"relatórios
analíticos costumam levar mais tempo"*. Não é "dois cliques"; é sair da landing, pedir,
esperar e voltar.

**E o NEXO é multicanal.** Resolver a Amazon abre quatro perguntas na hora: qual relatório
do ML, da Shopee, do TikTok? Mesmo período? Mesmos campos? Tem custo? O vendedor sabe onde
achar? A porta de entrada viraria **"importador de planilha da Amazon"** — menor que a
tese.

### ❌ Caixa de pergunta como herói — descartado

A ideia seguinte foi abrir a home com *"o que você quer entender da sua operação?"*, a
pessoa pergunta e o NEXO responde sobre uma operação demonstrativa.

**O NEXO não tem essa caixa.** O lead pergunta na landing, gosta, cria conta, conecta os
marketplaces — e não existe lugar nenhum para perguntar. A landing teria vendido uma
feature que o produto não entrega, e a quebra acontece **no minuto seguinte à conversão**,
que é o pior momento possível.

📌 Havia ainda um bloqueio técnico: a narração leva **~18 segundos** em produção
(`src/lib/centralBriefing.ts:213`, medido em 23/08). Aceitável para um briefing diário,
fatal num herói. Mas o motivo de descartar é o primeiro, não este.

---

## A tese, corrigida

O NEXO de hoje não é *"pergunte e ele responde"*. Ele é melhor que isso, e mais simples:

> **Ele olha a operação e vem dizer o que importa.**

Um funcionário bom não fica esperando *"será que temos algum problema?"*. Ele chega com
*"olhei a operação, tem três coisas que você precisa saber hoje"*.

A landing tem que demonstrar **isso** — que é o produto que existe — e não a conversa, que
é o produto da Fase 2.

---

## O desenho

A home **é o produto rodando**, numa operação demonstrativa. Sem herói clássico, sem
mockup, sem print.

```
┌──────────────────────────────────────────────────────────┐
│  ◤ NEXO          Operação demonstrativa · 4 canais       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ◆ NEXO                                                  │
│                                                          │
│  Tem três coisas que eu olharia hoje.                    │
│                                                          │
│  O Mercado Livre perdeu 62% do faturamento nesta         │
│  semana. A causa está nos anúncios: 11 dos 14 estão      │
│  inativos.                                               │
│                                                          │
│  Na Amazon as vendas cresceram 9%, mas o produto que     │
│  responde por 37% da receita fica sem estoque em 6 dias. │
│                                                          │
│  A Shopee vendeu mais, e mesmo assim a margem caiu.      │
│                                                          │
│                                    Ver prioridades ↓     │
└──────────────────────────────────────────────────────────┘
```

Abaixo, **os cards de prioridade do Briefing** — os de verdade, com evidência, impacto e
próximo passo. A pessoa expande, troca de canal, mexe no período. Exatamente como faria
dentro do produto, porque **é** o produto.

A fronteira aparece quando ela tenta atravessar do observar para o usar:

> **Quer ver isso na sua operação?** → Conectar meus marketplaces

### A ordem que isso inverte

| Hoje | Proposto |
|---|---|
| headline → copy → mockup → CTA → cadastro → **produto** | **produto funcionando** → explora → entende → conecta |

É o que o Lovable faz de especial, e não tem nada a ver com caixa de texto: ele **elimina
a distância entre a promessa e a experiência.** Dá para fazer o mesmo sem chat.

---

## A operação demonstrativa

**Neutra, não a real.** Três motivos:

1. Expõe informação comercial numa página pública.
2. A demonstração ficaria refém das peculiaridades de uma conta específica.
3. É **alvo móvel** — quebraria a cada venda, e alguém teria que consertar a landing por
   causa de um pedido.

**Mas construída sobre padrões que o NEXO detecta de verdade**, senão a história não é
crível:

| Canal | O caso | Por que é crível |
|---|---|---|
| **Mercado Livre** | queda de 62%; 11 de 14 anúncios inativos | é o sinal que `coletarSinaisDeCausa` já busca |
| **Amazon** | cresce 9%, mas o SKU de 37% da receita rompe em 6 dias | cobertura de estoque já existe no radar |
| **Shopee** | vende mais e a margem cai por aumento de desconto | a distinção receita × margem é a tese do produto |
| **TikTok** | cresce rápido, base ainda pequena | mostra o quarto canal sem inventar drama |

O rótulo diz o que é **e por que vale olhar**:

```
Operação demonstrativa · 4 canais · 38 SKUs · dados de exemplo
```

⚠️ O número faz o rótulo trabalhar a favor. `Operação demonstrativa` sozinho lê como
*"isto é fake, ignore"*.

---

## O que o código já entrega

Verificado antes de propor, não deduzido:

| Peça | Estado |
|---|---|
| **Workspace de demonstração** | `scripts/_demo-seed.mjs` — **já existe**, e foi feito para ser mostrado a estranho (a análise da Shopee). Workspace isolado, 3 canais, pedidos, custos, registros de sync |
| **Leitura sem token** | `overview/route.ts:74` — havendo banco, a rota lê das **tabelas canônicas**. A chamada ao marketplace (linha 118) é só o caminho de quando não há banco |
| **Escopo de workspace** | `withAuthenticatedWorkspace` tira o id do `sub` do JWT e passa para `runWithWorkspace`. **Uma porta, não trinta** |
| **Narração** | os ~18s deixam de importar: é **um** workspace com dados que não mudam. O texto é gerado uma vez e servido pronto. Não é cache, é conteúdo |

---

## O que falta construir

| # | O quê | Por quê |
|---|---|---|
| 1 | **Invólucro de leitura pública** | um wrapper que só sabe fixar o id da demonstração, escrita impossível por construção |
| 2 | **Pular o sync no workspace demo** | as conexões do seed têm `metadata: {"demo": true}` e **não têm token**; `requestMercadoLivreSync` falharia |
| 3 | **Narração pré-gerada** | gerar uma vez, versionar junto com o seed |
| 4 | **Enriquecer o seed** | o TikTok não está lá, e os quatro casos acima precisam existir nos dados |
| 5 | **A página** | reaproveitando os componentes reais do Briefing e da Visão geral |

⚠️ **Não dou prazo antes do item 5 estar mapeado tela por tela.** O que decide o tamanho é
quantos componentes assumem sessão autenticada nas próprias chamadas — e isso se descobre
lendo, não estimando.

---

## Segurança — o ponto inegociável

> **A demonstração NÃO pode ser uma flag dentro do guard que já existe.**

Escrever `if (demo) pula a autenticação` dentro de `withAuthenticatedWorkspace` cria o
caminho pelo qual, algum dia, **a requisição escolhe o workspace**. Isso é vazamento de
todos os clientes, e é a classe de brecha que só aparece depois de ter cliente.

Tem que ser um invólucro **separado**, que:

- só sabe fixar o id da demonstração, **nunca** recebe id da requisição;
- não abre caminho de escrita;
- é coberto por teste de arquitetura, como o `providerIsolation.test.mjs`.

É a mesma lógica do ADR-024: privilégio que atravessa clientes não se concede por
parâmetro.

---

## O que NÃO fazer

**Não pedir OAuth antes de mostrar valor.** Conectar marketplace é o maior pedido de
confiança que existe. Vem depois de a pessoa ver o produto funcionando.

**Não colocar caixa de pergunta enquanto ela não existir no produto.** Quando a Fase 2 do
harness existir, a caixa entra na landing e no produto **no mesmo dia** — a promessa e a
entrega nascem juntas.

**Não usar o benchmark como argumento de venda.** A base instalada é de duas contas.
Landing não é lugar de comparar com concorrente até existir cliente.

**Não deixar a demonstração virar dashboard infinito.** Navegação limitada de propósito:
Visão geral, Briefing e um canal. O resto é a fronteira de conversão.

---

## Fases

| Fase | O quê | Por que nesta ordem |
|---|---|---|
| **1** | Briefing + Visão geral na operação demonstrativa | é a ideia inteira. Sem isso, o resto não muda nada |
| **2** | Navegação por canal dentro da demonstração | aprofunda quem se interessou |
| **3** | Calculadora aberta e "analisar relatório da Amazon" | aquisição por busca, **fora** do funil principal |
| **4** | A caixa de pergunta | só quando existir no produto |

📌 A fase 3 é onde o relatório sobrevive: como ferramenta gratuita com URL própria, boa
para busca no Google. Só não pode ser a porta de entrada.

---

## Riscos

| Risco | Leitura |
|---|---|
| **Rota pública consultando o banco** | tráfego anônimo bate no Postgres. Mitigação: a demonstração é um workspace só, com dados que não mudam — dá para servir do cache de borda |
| **A demonstração envelhecer** | datas gravadas ficam estranhas com o tempo. Precisa de datas calculadas a partir de hoje, não fixas |
| **Parecer "conta de exemplo"** | o rótulo com número ajuda; o texto do NEXO precisa soar como operação real, não como tutorial |
| **Peso da página** | é o produto inteiro carregando na home. Medir antes e depois; se pesar, servir a primeira dobra estática e hidratar o resto |

---

## O que eu preciso de vocês antes de codar

1. **A fase 1 sozinha primeiro?** Recomendo sim, com medição de quanta gente clica em
   "conectar" depois de explorar.
2. **A landing atual continua abaixo?** A proposta é a demonstração ocupar a primeira
   dobra e a página atual virar apoio — não sumir.
3. **Quantos canais na demonstração de largada?** O seed tem 3; o TikTok precisa entrar.
   Dá para lançar com 3 e somar o quarto depois.

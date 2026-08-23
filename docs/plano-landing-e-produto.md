# Plano — a landing É o produto

**23 de agosto de 2026** · Plano para discussão, **antes** de implementar

---

## O problema com a analogia do Lovable

No Lovable você digita um prompt e ele **cria** o artefato. O valor aparece do nada, em
segundos, sem você trazer nada.

O NEXO é o oposto: **todo o valor vem do dado da pessoa.** Sem loja conectada não existe
faturamento, não existe margem, não existe nada para mostrar. Uma landing que tenta imitar
o Lovando literalmente esbarra nisso no primeiro segundo.

Então a pergunta certa não é *"como imitar o Lovable"*, e sim:

> **O que o NEXO consegue mostrar de valioso ANTES de a pessoa conectar uma loja?**

Existem três respostas, e uma delas é muito melhor que as outras.

---

## A descoberta que decide o plano

Fui verificar antes de propor:

```
src/lib/integrations/amazonOrdersReportParse.ts   →  ZERO imports
src/lib/profitability.ts (calculateContribution)  →  ZERO imports
```

**As duas peças que fazem o trabalho são funções puras.** Elas não dependem de banco, de
API, de sessão. Rodam **no navegador**.

Isso significa que a pessoa pode largar o relatório dela na página e ver o próprio lucro
**sem criar conta, sem OAuth, sem o arquivo sair do computador dela**.

---

## Caminho 1 — **"Cole seu relatório"** *(a proposta principal)*

### Como funciona

1. A pessoa chega na landing. O herói não é uma frase bonita: é uma área para soltar
   arquivo.
2. Ela baixa o relatório **Todos os pedidos** no Seller Central — dois cliques, e é um
   arquivo que ela já tem ou consegue em 30 segundos.
3. Solta na página.
4. **Em menos de um segundo** aparece: faturamento real, cupom resgatado que ela não sabia
   que existia, ticket médio, receita por SKU — os números **dela**.

### Por que este é o "momento Lovable" do NEXO

Foi exatamente o que aconteceu hoje, 23/08, nesta conversa. Ela baixou
`168606709420020688.txt`, e em segundos apareceu:

```
30 dias   item-price 493,74  =  o número do Seller Central
          cupom       19,02  ←  ela não sabia que era isso
          líquido    474,72  =  o que entrou de verdade
```

Ela levou **três perguntas** para entender por que dois números na tela diferiam. Com o
relatório na mão, a resposta apareceu em um segundo. **Esse é o produto.** Não é a
promessa dele — é ele acontecendo.

### Por que rodar no navegador não é só elegante — é a decisão correta

⚠️ O relatório **Todos os pedidos contém CPF, nome e endereço dos compradores.**
Verificado hoje.

| Se subir para o servidor | Se rodar no navegador |
|---|---|
| Recebemos dado pessoal de terceiro que **não é nosso cliente** | O arquivo nunca sai da máquina dela |
| Vira responsabilidade de LGPD antes de existir relação comercial | Zero superfície de dado pessoal |
| Precisa de armazenamento, retenção, exclusão | Nada para guardar |
| *"Confie em nós com o CPF dos seus clientes"* | *"Seu arquivo não sai do seu computador"* — e é **verdade** |

A versão no navegador é mais barata **e** mais defensável. Raramente as duas coisas
coincidem.

### O que aparece depois do resultado

O gancho é a diferença entre o que ela vê e o que ela teria:

> *"Isto é uma foto de um arquivo. Conecte a conta e isso se atualiza sozinho a cada 2
> minutos, nos quatro canais, com o custo dos seus produtos entrando na conta."*

O que o arquivo **não** consegue mostrar, e vira o argumento de conversão:

- lucro de verdade (o arquivo não tem o custo do produto)
- os outros três canais
- estoque, ranking, campanhas
- o NEXO explicando **por que** mudou

### Esforço

**2 a 3 dias.** O parser existe e é puro; falta a área de soltar arquivo, a apresentação
do resultado e o texto.

---

## Caminho 2 — **Demonstração ao vivo com dados semeados**

Um botão "ver com dados de exemplo" que entra no produto real, com o workspace de
demonstração que **já existe** (`scripts/_demo-seed.mjs`, contas `amazon:demo`,
`mercado_livre:demo`, `shopee:demo`).

| | |
|---|---|
| A favor | quase pronto; mostra o produto inteiro, não uma fatia |
| Contra | **não é o dado dela.** Demonstração com dado de mentira convence menos que três números verdadeiros |
| Esforço | ~1 dia |

📌 **Papel:** apoio, não protagonista. Serve para quem não quer baixar relatório nenhum e
só quer olhar.

---

## Caminho 3 — **Calculadora aberta**

Preço, custo, canal → margem e ponto de equilíbrio. Sem login. `calculateContribution` já
é pura, e as regras de tarifa dos quatro canais já estão no código.

| | |
|---|---|
| A favor | o mais barato de todos; compartilhável; entra em busca do Google |
| Contra | valor pequeno — existe calculadora de margem em todo lugar |
| Esforço | ~1 dia |

📌 **Papel:** porta de entrada por busca. *"Calculadora de margem Mercado Livre"* é o tipo
de coisa que vendedor procura, e traz gente que ainda não sabe que precisa do NEXO.

---

## O que NÃO fazer

**Não pedir OAuth na landing.** Conectar a conta do marketplace é o pedido de maior
confiança que existe, e pedir isso antes de mostrar qualquer valor é a ordem invertida.
OAuth vem **depois** de ela ver os próprios números.

**Não trocar a landing por um app pesado.** A página precisa continuar carregando rápido e
sendo indexável. O parser são ~100 linhas; a área de soltar arquivo, pouco mais. Se virar
um dashboard inteiro no `/landing`, perdemos as duas coisas.

**Não usar o benchmark como argumento de venda.** O relatório de mercado de hoje diz que a
base instalada é de duas contas. Landing não é lugar de comparação com concorrente até
existir cliente.

---

## Ordem proposta

| Fase | O quê | Esforço | Por que nesta ordem |
|---|---|---|---|
| **1** | **Cole seu relatório** | 2–3 dias | É a ideia. Sem isso, os outros dois não mudam nada. |
| **2** | Demonstração com dados de exemplo | ~1 dia | Atende quem não quer baixar arquivo |
| **3** | Calculadora aberta | ~1 dia | Aquisição por busca, depois que o funil existir |

⚠️ **Fazer a fase 1 sozinha e medir antes de seguir.** Se as pessoas não soltarem o
arquivo, as fases 2 e 3 não salvam — e aí a hipótese está errada, o que também é
informação.

---

## Riscos, honestamente

| Risco | Leitura |
|---|---|
| **A pessoa não vai buscar o relatório** | É o risco principal. Baixar exige sair da landing e voltar. Mitigação: instruções com print, e a demonstração da fase 2 como alternativa para quem não quiser. |
| **Só funciona para Amazon no começo** | ML, Shopee e TikTok têm formatos diferentes. Começar pela Amazon, que é onde o formato já está resolvido e testado. |
| **O arquivo pode vir em formato inesperado** | O parser já lida com o relatório real, mas nunca viu arquivo de outra conta. Precisa falhar dizendo o que houve — nunca mostrar número errado. |
| **Peso da landing** | Medir o bundle antes e depois. Se passar do aceitável, carregar o parser sob demanda, só quando a pessoa soltar o arquivo. |

---

## O que eu preciso de vocês antes de codar

1. **A fase 1 sozinha primeiro, ou as três juntas?** Minha recomendação é a 1 sozinha, com
   medição.
2. **A landing atual continua?** A proposta é o herói virar a área de soltar arquivo — o
   resto da página segue abaixo. Ou vocês querem uma página separada?
3. **Que números mostrar no resultado?** Minha sugestão: faturamento, cupom, ticket médio e
   os cinco SKUs que mais faturam. Lucro **não**, porque o arquivo não tem custo — e
   mostrar lucro errado na primeira impressão é o pior começo possível.

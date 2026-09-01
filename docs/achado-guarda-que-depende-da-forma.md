# Ancoragem de guardas: o catálogo dos seis casos de 01/09/2026

**O que este documento é:** a lista completa das guardas que ficaram vermelhas
**pelo motivo errado** num único dia, o que cada uma casava, o que a derrubou, e
a regra que sai do conjunto. Escrito de uma vez, com os seis frescos, porque
guarda mal ancorada não é erro de quem a escreveu: é o resultado padrão de
escrever guarda com pressa.

**A frase que resume:** uma guarda pode casar **o comportamento** (chame a
função, confira a saída) ou **a forma do código**. A segunda é sempre mais fácil
de escrever, e é a que dá falsa sensação de cobertura — ela protege contra **o
defeito escrito de um jeito só**.

## Os seis casos

Os seis são sobre **onde a guarda ancora**. No fim há uma sétima família, irmã e
diferente: **unidade implícita**, em que nenhuma guarda dispara porque não há
nada de errado no código — só no significado.

| # | a guarda casava | o que a derrubou | o que ela protegia de verdade |
|---|---|---|---|
| 1 | o **texto do fonte cru**, numa asserção que PROÍBE | o comentário que explica a proibição **cita a coisa proibida** — `assert.ok(!/useSearchParams/)` reprovava a nota que documentava a remoção | quase nada: ficava verde com a chamada apagada e o import de pé |
| 2 | o **nome da variável** (`sinais={sinais}`) e uma **lista escrita à mão** de 3 telas | o `ShopeeModulePage` chama a lista de `sinaisDaTela`, e o TikTok não estava na lista — **apagar os sinais dos dois não ficava vermelho** | 3 das 5 telas, e só com um nome de variável |
| 3 | uma **janela fixa de caracteres** (`value={[\s\S]{0,400}?}`) | o casamento atravessava a expressão e reprovava **outro arquivo**, que estava certo | pior que nada: acusava inocente |
| 4 | a **linha exata** de um ternário | a frase passou a sair da peça compartilhada e o teste acusou *"a base voltou a ser constante"* — **o oposto do que aconteceu** | a forma da linha, não a propriedade |
| 5 | o **import exato** `import { declaracaoDeBase }` | a tela passou a importar **também** `nomeDaBase` | a lista de nomes, não a procedência |
| 6 | a **profundidade do caminho** (`../../lib/semImposto`, `./components/Dash…`) | as telas desceram um nível para dentro do route group `(app)` | a posição na árvore, não o módulo |

Os casos 4, 5 e 6 têm uma propriedade que os separa dos outros três, e é a mais
cara: **eles ficaram vermelhos por causa de uma melhora.**

## O caso que vale mais que os outros: a guarda que pune quem conserta

Um exemplo em que a guarda **pune o conserto** ensina mais que dez em que ela
pune o defeito. No segundo caso a pessoa lê o vermelho e corrige o código. No
primeiro ela lê o vermelho, não entende, e **desfaz a melhora** — ou desliga a
guarda. As duas saídas são piores que não ter guarda nenhuma.

O sintoma é reconhecível: **a mensagem do teste descreve o contrário do que
aconteceu.** *"A base voltou a ser constante"* apareceu no exato commit em que a
base deixou de ser constante. Quando o vermelho contradiz o que você acabou de
fazer, suspeite da âncora antes de suspeitar do código.

## A regra, em duas listas

**Ancore em:**

| âncora | quando | exemplo deste dia |
|---|---|---|
| **comportamento** | sempre que houver função pura para chamar | `nomeDaBase({…})` devolve `"sobre a receita"` |
| **o módulo** | import, procedência de uma peça | `from "[./]*components/baseDaMargem"` |
| **a chamada inteira** | propriedade que precisa existir num objeto | `usePrefetchDePeriodos({ … filaDeFundo: false, })` |
| **a ramificação** | valor que precisa vir do dado, não de constante | `rotuloDaBase:x!=null?"o faturamento":"a receita processada"` |
| **a estrutura da árvore** | posição no JSX, escopo de um bloco | contagem de chaves até a chave que envolve a posição |
| **a árvore de arquivos** | cobertura de telas | andar `src/app` inteiro, nunca uma lista |

**Nunca ancore em:**

| nunca | porque |
|---|---|
| **o nome** de uma variável | renomear foge da guarda sem mudar comportamento |
| **uma lista** (de nomes, de imports, de arquivos, de pares `chave: valor`) | **toda guarda que casa uma lista reprova a primeira melhora que acrescentar um item à lista** |
| **a profundidade** de um caminho relativo | mover pasta é refatoração, não defeito |
| **a distância em caracteres** | a janela atravessa a expressão e acusa o arquivo errado |
| **o comentário** | asserção que PROÍBE casa o texto que explica a proibição |
| **a linha exata** | qualquer melhora na linha vira vermelho |

## Duas regras operacionais que vêm junto

**1. Asserção que PROÍBE lê o fonte sem comentários — sempre.** Não é zelo: o
comentário que explica por que algo é proibido **cita a coisa proibida**. Uma
linha resolve:

```js
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
```

Asserção que EXIGE pode casar o fonte cru — comentário a mais nunca fez
`assert.match` passar indevidamente.

**2. Verde por não ter encontrado nada é o pior verde.** Uma guarda que varre a
árvore passa **silenciosamente** se o andador quebrar: a lista vem vazia e todas
as asserções ficam verdes sem olhar arquivo nenhum. Cada varredura carrega um
piso, folgado de propósito:

```js
if (achados.length < 40) throw new Error("achou telas de menos — o andador quebrou");
```

Piso apertado quebra por refatoração, que é o outro jeito de a guarda ser
desligada.

## Guarda também ACHA — não só impede

O quinto sítio da declaração de base (`ShopeeWorkspace.tsx:899`, um *fallback*
constante escondido dentro de um ternário, visível só quando **não** havia
divergência) passou por **três medições manuais** sem ser visto. Quem o achou foi
a guarda, depois de pronta.

A varredura manual escolhe o que parece relevante e se cansa; a guarda não faz
nem uma coisa nem outra. Cada estreitamento do escopo encontrou um sítio que o
recorte anterior não via.

📌 **Isso muda quando vale escrever guarda:** não só quando o defeito é
recorrente, mas quando **a busca manual é propensa a ponto cego** — condição
escondida em ternário, fallback que só aparece num estado raro, arquivo com
extensão fora do recorte (`.ts` numa varredura de `.tsx` — foi assim que o quarto
sítio escapou).

## A família irmã: unidade implícita — o valor está certo, o significado não

Todas as anteriores são sobre **onde a guarda ancora**. Esta é sobre um defeito
que **nenhuma guarda pega**, porque não há nada de errado no código: o número é o
número, o tipo é `number`, o teste é verde. O que está errado é o **significado**
dele na travessia do banco para a tela.

**O caso, pego antes de existir (01/09/2026).** O backend definiu
`percentualDaCategoria = amount / unit_price` — uma **fração**: comissão de 12,01%
chega como `0.1201`. A peça da tela chamava o mesmo dado de
`percentualDaComissao` e o formatava cru. Se o campo tivesse sido entregue e a
peça ligada, a tela diria **"0,12%"** onde a Amazon cobra **12,01%**.

Por que é o pior tipo de defeito:

- **`tsc` fica verde** — `number` de um lado, `number` do outro;
- **teste fica verde** — o valor que entra é o valor que sai;
- **revisão de código fica verde** — as duas linhas estão certas, cada uma no seu
  contexto;
- **quem descobre é o cliente**, conferindo contra a fonte externa e concluindo,
  com razão, que o produto está errado.

Erro de unidade não parece erro. **Ele parece um número pequeno.**

### A regra

> **Todo campo que atravessa a fronteira banco → tela carrega a unidade no nome,
> ou converte num ponto único declarado.**

Na prática, as duas metades, e as duas foram aplicadas neste caso:

1. **Nome igual dos dois lados.** `percentualDaCategoria` aqui e lá. Nome
   diferente para o mesmo dado é um convite a repassar um pelo outro sem
   converter — e ninguém repassa errado de propósito: repassa porque os dois se
   chamam "percentual" e parecem a mesma coisa.
2. **A conversão mora num lugar só**, no ponto em que a unidade do banco encontra
   a unidade da tela. Espalhar `* 100` pelos pontos de render é exatamente como
   este erro nasce: basta um ponto novo esquecer.

Quando o nome não puder mudar, que ele **diga a unidade**: `fracaoDaCategoria`,
`valorEmCentavos`, `duracaoEmMs`, `pesoEmGramas`. Um nome que diz a unidade
transforma um erro invisível num erro que a leitura pega.

### O que dá para guardar, mesmo sem guarda de forma

O que se testa aqui não é o código, é a **travessia**: chame a conversão com o
valor como ele vem do banco e confira a saída como ela aparece na tela — e
escreva a asserção que **proíbe o valor cru**:

```js
assert.match(procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201 }).texto, /12,01%/);
assert.ok(!/0,12%/.test(procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201 }).texto));
```

📌 **A segunda linha não amplia a cobertura — e vale a pena mesmo assim.** Medido:
o primeiro `assert` já reprova os dois erros (o valor cru dá `"0,12%"` e a
conversão dobrada dá `"1.201,00%"`, e nenhum dos dois contém `12,01`). O que a
segunda acrescenta é **a mensagem**: quem vir o vermelho lê *"a fração foi
repassada crua — erro de 100×"* em vez de *"string não casou"*, e vai olhar a
unidade em vez de olhar a formatação.

Guarda também comunica. Duas asserções que reprovam o mesmo estado não são
redundância quando uma delas **diz qual é o estado**.

## Antes de escrever guarda nova, duas perguntas

**1. De quantos jeitos dá para escrever este defeito?** Se a resposta for
"muitos", casar a forma não vai cobrir os outros — e a guarda vai *parecer* que
cobre. Foi com esse critério que a guarda de frases explicativas foi medida e
**reprovada** antes de existir
(`docs/achado-frase-com-validade-nao-vira-guarda.md`: 84 achados, 95% de falso
positivo).

**2. Ela pegaria os casos que a motivaram?** É o **teste de recall**, e ele vale
para toda guarda: precisão alta com recall zero é decoração cara. A guarda de
frases mediu 0 de 2 — não teria pego nenhum dos dois casos reais do dia. Rode a
guarda contra o estado ANTERIOR ao conserto; se ela passar, ela não guarda o que
você acha que guarda.

## Estreitar o escopo ganha de listar exceção

A guarda do vocabulário de base reprovava, na primeira versão, *"Gasto com
anúncio sobre o faturamento total"* (a definição do TACOS, que **é** sobre o
faturamento total) e *"X% sobre o faturamento"* (a base da alíquota). As duas
saídas eram: listar as duas como exceção, ou **estreitar o escopo** para o cartão
de Margem.

Estreitando, TACOS e alíquota saem **por construção** — e a guarda nasce com zero
exceções. Guarda sem exceção é guarda; com exceção já nasce negociável.

## E quando a exceção for inevitável, que ela se limpe sozinha

A exceção do `amazon/page.tsx` durou algumas horas. Ao mover o sinal, o teste
ficou vermelho dizendo *"APAGUE a entrada de PENDENTE"* — nunca o contrário.

```js
const PENDENTE = ["amazon/page.tsx"];
const novos = achados.filter((n) => !PENDENTE.includes(n));
assert.deepEqual(novos, []);
for (const p of PENDENTE) assert.ok(achados.includes(p), "ja foi corrigido — APAGUE a entrada");
```

Exceção que só morre quando alguém lembra não é exceção, é dívida.

## A família vizinha, que não é esta

**Recusa temporária cujo teste passa a defender o defeito** parece o mesmo
problema e não é. Ali a âncora está certa: o teste exige exatamente o que o
código faz. O que mudou foi **a intenção** — a limitação que justificava a recusa
caiu, e o teste que a guardava virou o guardião do remendo.

Aconteceu duas vezes: a recusa de período personalizado da Shopee (31/08) e o
interino `cascaIndecidivelNoServidor` (01/09). Nos dois, a correção é **inverter
a intenção e registrar a inversão no próprio teste**, para quem o vir vermelho
amanhã saber que a mudança foi decidida, não herdada.

O sinal de que você está nesta família e não na outra: a guarda está vermelha
porque **o mundo mudou**, não porque a âncora era frágil.

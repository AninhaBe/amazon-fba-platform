# Achado: guarda que depende da FORMA do código protege menos do que parece

**Data:** 01/09/2026 · **Onde:** ciclo da auditoria de empilhamento de avisos
**Aparições no mesmo ciclo:** 3, em três disfarces diferentes

## A família

Uma guarda pode casar duas coisas: **o comportamento** (chame a função, confira a
saída) ou **a forma do código** (o texto do fonte, o nome do símbolo, a posição).
A segunda é sempre mais fácil de escrever — e é a que dá a falsa sensação de
cobertura, porque ela protege contra **o defeito escrito de um jeito só**.

As três deste ciclo:

| # | a guarda casava | e o defeito passava assim |
|---|---|---|
| 1 | o **texto do fonte** cru | o comentário que explica a proibição **cita a coisa proibida** — `assert.ok(!/useSearchParams/)` reprovava a nota que documentava a remoção |
| 2 | o **nome da variável** (`sinais={sinais}`) e uma **lista de 3 telas** | o `ShopeeModulePage` chama a lista de `sinaisDaTela` e o TikTok não estava na lista: **apagar os sinais dos dois não ficava vermelho** |
| 3 | uma **janela fixa de caracteres** (`[\s\S]{0,400}`) | o casamento atravessava a expressão e reprovava **outro arquivo**, que estava certo |

O #3 é o mais perigoso dos três, e não por reprovar de menos: ele reprova **o
arquivo errado**. Guarda que acusa inocente é desligada na primeira semana, e aí
os outros dois defeitos passam junto.

## As correções, e por que cada uma é a mesma correção

- **#1** → tirar comentário antes de asserção que **proíbe** (regra já no
  `AGENTS.md`). Asserção que **exige** pode casar o fonte cru: comentário a mais
  nunca fez `assert.match` passar indevidamente.
- **#2** → a guarda passou a ser **agnóstica ao nome** (`sinais=\{\w+\}`) e a
  varrer **a árvore inteira**, não uma lista escrita à mão. Lista à mão envelhece
  no dia em que nasce a quinta tela.
- **#3** → a detecção passou a **andar para trás contando chaves** até achar a
  chave que envolve a posição. Não é heurística: é a estrutura real do código.

As três viram a mesma frase: **quando a guarda tem de olhar a forma, que ela
olhe a ESTRUTURA (a árvore, a chave que fecha, a ramificação), nunca a
APARÊNCIA (o nome, a distância em caracteres, a lista de arquivos).**

## O caso que vale mais que os outros: a guarda que pune quem conserta

Três vezes no mesmo dia uma guarda ficou vermelha **por causa de uma melhora**:

| a guarda casava | o que a deixou vermelha |
|---|---|
| a linha exata do ternário da base, no módulo da Shopee | a frase passou a sair da peça — e o teste acusou *"a base voltou a ser constante"*, o oposto do que aconteceu |
| `import { declaracaoDeBase }` exato, no `ShopeeWorkspace` | a tela passou a importar **também** `nomeDaBase` |
| a lista de três telas com sinais | nasceu a quarta e a quinta |

Um exemplo em que a guarda **pune o conserto** ensina mais que dez em que ela
pune o defeito: no segundo caso a pessoa lê o vermelho e corrige o código; no
primeiro ela lê o vermelho, não entende, e **desfaz a melhora** — ou desliga a
guarda. As duas saídas são piores que não ter guarda nenhuma.

A correção é sempre a mesma e é a frase acima: ancore na **estrutura**. A linha
exata virou a **ramificação** (o rótulo sai do campo usado); o import exato virou
o **caminho do módulo**; a lista de telas virou a **árvore**.

## O corolário que decide guarda nova

Antes de escrever uma guarda, pergunte: **de quantos jeitos dá para escrever este
defeito?** Se a resposta for "muitos", casar a forma não vai cobrir os outros — e
a guarda vai *parecer* que cobre. Foi com esse critério que a guarda de frases
explicativas foi medida antes de ser escrita (ver
`docs/achado-frase-com-validade-nao-vira-guarda.md`).

## E a exceção nomeada, que é o outro lado

Guarda estrita precisa de válvula, e a válvula tem prazo. A exceção do
`amazon/page.tsx` durou algumas horas e **se limpou sozinha**: ao mover o sinal,
o teste ficou vermelho dizendo *"APAGUE a entrada de PENDENTE"* — nunca o
contrário. Exceção que só morre quando alguém lembra não é exceção, é dívida.

# Achado: medir HTML servido não é cortar no primeiro `<script>`

**Data:** 01/09/2026 · **Onde:** verificação de vazamento da raiz pública
**O número que quase foi reportado:** 717 bytes. **O certo:** 28.570.

## O que aconteceu

A raiz passou a servir a landing por rewrite, e era preciso conferir o que o
HTML entrega a um visitante **sem sessão** — não o que a tela mostra, porque
print não mede o que foi entregue.

A primeira leitura fatiava o documento assim:

```js
const corpo = html.slice(html.indexOf("<body"));
const markup = corpo.slice(0, corpo.indexOf("<script"));   // ❌
```

O raciocínio parecia sólido: *"o markup renderizado vem antes dos scripts; o
resto é payload"*. **É falso em App Router com streaming.** O que vem antes do
primeiro `<script>` é o **esqueleto do `loading.tsx`** — a resposta abre com o
fallback do Suspense e o conteúdo real chega **depois**, em blocos intercalados
com os scripts que os costuram.

Resultado: a medição do "depois" deu **717 bytes** — quarenta vezes menor que o
real. Um número espetacular, e errado. Pior: ele *confirmava* o que se queria
ver (a casca sumiu), que é exatamente quando não se confere.

## O método certo

Remover **o conteúdo dos `<script>`** e medir o markup inteiro, preservando tudo
que veio depois deles:

```js
const semScript = html.replace(/<script[^>]*>.*?<\/script>/gs, "");
const corpo = semScript.slice(semScript.indexOf("<body"));
// agora sim: corpo.length, corpo.includes("app-shell"), contagem de rótulos…
```

E medir **os dois lados**: o documento inteiro (`html.length`) e o markup sem
scripts. Se os dois não se moverem juntos, a fatia está errada.

## O número, com o método certo

| | antes | depois |
|---|---|---|
| documento inteiro | 64.147 b | 49.111 b |
| markup sem `<script>` | 43.606 b | 28.570 b |
| `app-shell` no markup | sim | **não** |
| `<aside class="nexo-sidebar">` | 6.663 b | **0** |
| rótulos de navegação | 23 ocorrências | **0** |
| landing no markup | sim | **sim** ✅ |

A última linha é a que impede a correção de virar outro defeito: tirar a casca
**sem** tirar a landing era o ponto — ela é o motivo de a raiz existir como
página pública.

## A regra

> **Medir HTML servido = remover o conteúdo dos `<script>` e medir o markup
> inteiro. Nunca cortar no primeiro `<script>`.**

E a regra irmã, que vale para qualquer medição: **um número que confirma o que
você queria ver merece uma segunda conferida, não menos.** Este deu 40× melhor
que o real e passou perto de ser reportado.

## Resolvido em 01/09/2026 — o route group

O interino saiu: o `AppShell` deixou o layout raiz e passou a ser montado por
`(app)/layout.tsx`. Dezoito diretórios de rota mais a Visão geral entraram no
grupo; landing, login, privacidade, `lab`, recuperação de senha e `auth` ficaram
fora. Nenhuma URL mudou — grupo entre parênteses não entra no caminho —, e isso
foi conferido rota a rota: **64 rotas antes, as mesmas 64 depois.**

Medido de novo no HTML servido, com o método acima (`next start` local, `curl`
sem cookie):

| | interino | com o grupo |
|---|---|---|
| markup sem `<script>` | 28.570 b | 27.952 b |
| `app-shell` / `nexo-sidebar` | não | **não** |
| rótulos de navegação | 0 | **0** |
| marcas de sessão | — | **0** |
| landing no markup | sim ✅ | **sim ✅** |

E o prerender ficou igual: 146 rotas no build, **nenhuma mudou de tipo**, 61
estáticas antes e 61 depois, com `/` seguindo `○`.

O flash na Visão geral acabou junto: a casca volta a ser renderizada no
servidor para quem tem sessão, porque a landing já não passa por ela.

## Constante se lê, não se lembra

**Do backend, 01/09/2026.** Uma pré-condição foi medida contra uma **lista de
status escrita de cabeça**. A conta deu *"sumiriam 0 de 10"*, e a mudança parecia
segura. Ao abrir a constante de verdade, o número virou **10 de 10**.

Não foi uma medição imprecisa — foi uma medição **invertida**. Ela dizia o
oposto do que era verdade, com a confiança de um número. E números não são
questionados como opiniões: um "0 de 10" teria aprovado a mudança sem discussão.

> **Toda medição que depende de uma lista de valores cita o arquivo e a linha de
> onde a lista veio.**

Vale para lista de status, de enum, de rota pública, de coluna, de tipo de
tarifa. É a mesma disciplina do bloco anterior por um motivo diferente: lá o
método de fatiar estava errado; aqui o método está certo e **a entrada** é que
foi inventada. As duas produzem um número que confirma o que se esperava — e é
por isso que ambas passam.

📌 **O sinal de alerta é a facilidade.** Se você conseguiu montar a lista sem
abrir arquivo nenhum, você não mediu: você lembrou. Lembrar dá a mesma sensação
de saber, e é a diferença entre "0 de 10" e "10 de 10".

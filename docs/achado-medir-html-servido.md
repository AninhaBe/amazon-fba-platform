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

## Pendente

O interino que produziu o "depois" troca o vazamento por um flash da casca **na
Visão geral**, para quem tem sessão. A correção definitiva é mover o `AppShell`
do layout raiz para um route group das telas autenticadas — **combinada para uma
janela com a árvore quieta**, porque move ~19 diretórios de rota.

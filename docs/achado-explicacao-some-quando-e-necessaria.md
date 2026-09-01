# Achado: a explicação some exatamente no caso em que ela é necessária

**Data:** 01/09/2026 · **Aparições:** 3, em três formas diferentes
**Por que virou doc:** três formas distintas do mesmo defeito, em dois dias, é
**tendência do jeito como escrevemos tela** — não três bugs.

## O defeito

A tela tem um número e, ao lado, a frase que diz o que falta para o número
fechar. A frase é escrita **dentro** de alguma condição — e a condição, sem
ninguém decidir isso, é a mesma que decide se o número existe. Resultado: **a
pendência só aparece quando ela já foi resolvida.**

Quem olha vê um número em branco e nenhuma explicação, que é o estado mais caro
possível: a pessoa não sabe se falta dado, se está carregando, ou se ela vendeu
zero.

## As três formas

**1. `sub` condicional** (`ShopeeModulePage`, corte 1 da auditoria). A frase da
base morava no `sub` do cartão, e o `sub` era multiplexado com os sinais: quando
havia pendência, os sinais tomavam o lugar e **a declaração da base sumia** —
justamente quando o número está incompleto e a base importa mais.

**2. Multiplexador `X ? <aviso/> : explicação`** (`MercadoLivreWorkspace`). O
mesmo espaço servia às duas coisas, então uma sempre custava a outra. A guarda
que reprova essa forma varre a árvore hoje
(`tests/varreduraPorComponente.test.mjs`).

**3. Acoplamento por POSIÇÃO** (`amazon/page.tsx`, o mais silencioso). Os sinais
estavam dentro do `value` do `<Flow label="Margem">`, e o `Flow` inteiro só
renderiza quando `lucroComAnuncio != null && revenue > 0`. Ninguém escreveu
"esconda a pendência quando o lucro não fechar" — **a condição veio de graça com
o lugar.** Efeito: *"3 SKUs sem custo cadastrado"* só aparecia depois de o custo
estar cadastrado.

A forma 3 é a pior porque **não existe no código como decisão**: não há condição
para ler, revisar ou discutir. Ela é uma propriedade da árvore JSX.

## A regra

> **Pendência não mora dentro do elemento que ela explica.** Ela mora em bloco
> próprio, com condição escrita — e a condição é o ESTADO DA PENDÊNCIA, nunca o
> estado do número.

Teste prático, ao rever uma tela: **apague mentalmente o número.** Se a frase que
explica a ausência dele some junto, o defeito está lá.

## O que a Ana passa a ver

A Amazon dela está hoje no ramo sem lucro (token revogado, falta custo ou
tarifa). Com o conserto, os sinais que estavam sendo engolidos aparecem. **Nada
some** — passa a aparecer o que estava escondido.

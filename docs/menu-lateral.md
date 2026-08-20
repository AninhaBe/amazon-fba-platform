# Menu lateral que encolhe

**19/08/2026.** Referência escolhida por ela: o menu de
[`2.datadive.tools`](https://2.datadive.tools). Implementado em
`src/app/components/OperationsRail.tsx` + `globals.css` → "Menu que encolhe".

## A mecânica, medida na página deles

O truque não é óbvio olhando: a `<aside>` **nunca muda de largura**. Ela só reserva o
espaço do rail. Quem anima é um painel `position: absolute` dentro dela, que cresce a
própria largura e passa **por cima** do conteúdo.

É isso que separa esse efeito de um menu comum: um menu que anima a largura da própria
`aside` empurra a página inteira a cada passada de mouse. Aqui nada reflui.

| | DataDive | NEXO |
|---|---|---|
| `aside` (fixa) | 68px | **118px** |
| painel fechado | 68px | **60px** (começa em 58, depois dos canais) |
| painel aberto | 256px | **230px** (58 + 230 = 288, a largura de antes) |
| transição | `300ms cubic-bezier(0, 0, 0.2, 1)` | igual |
| item | 36px, raio 8px, fonte 13px | o do NEXO, mantido |

Os rótulos somem por `opacity`, e o `overflow: hidden` do painel impede que vazem para o
canvas enquanto ele está estreito.

⚠️ **Os 60px do painel fechado não são chute.** O ícone tem que cair no centro da calha:
padding do scroll (8) + padding do item (10) + metade do ícone (12) = 30 = metade de 60.
Mexer em qualquer um dos três desalinha o ícone. A conta está repetida no CSS.

## Por que a forma escolhida foi a de duas calhas

O DataDive tem UMA coluna de ícones. O NEXO tem duas ideias para caber nela: os 5 canais e
as páginas de dentro do canal. Três formas foram construídas e comparadas em `/lab/menu`:

| | fechado | canvas ganha | perde de vista |
|---|---|---|---|
| Coluna única | 68px | 220px | nada |
| **Duas calhas** ✅ | **118px** | **170px** | nada |
| Só os canais | 58px | 230px | em que **página** está |

Ela escolheu **duas calhas**: os canais continuam na coluna própria que já existia e só o
painel das páginas desliza. Com o menu fechado você continua vendo o canal **e** a página
— que é o que as outras duas cobravam mais caro ou entregavam de menos.

## Fixar aberto

O botão no topo do painel fixa o menu (preferência em `localStorage`, chave
`nexo:menu-fixo`). **Fixado, a `aside` passa a reservar os 288px inteiros** — sobreposição
é aceitável de passagem, no hover, mas permanente vira conteúdo escondido para sempre.

Foco de **teclado** também abre o painel — sem isso, quem navega por `Tab` tabularia para
dentro de um painel de 60px e não leria nada.

⚠️ **Isso não pode ser `:focus-within`.** Foi assim na primeira versão e estava errado:
clicar em qualquer item deixa o foco dentro do painel, e o seletor não distingue foco de
clique de foco de teclado — o menu ficava aberto para sempre. Quem decide é
`OperationsRail.tsx`, consultando `:focus-visible` no elemento que recebeu o foco e
pondo/tirando a classe `is-teclado`. E a flag é **atribuída**, não só ligada: mover o foco
por clique de um item para outro dentro do menu tem que desligá-la, senão um `Tab` inicial
prendia o painel aberto pelo resto da sessão.

## `/lab` — bancada e protótipos

- **`/lab/rail`** — o `OperationsRail` de produção montado sozinho, com os mesmos
  componentes e o mesmo CSS. Existe porque o `AppShell` só aparece para quem tem sessão, e
  isso obrigava a estar logado para conferir qualquer ajuste no menu.
- **`/lab/menu`** — as três opções que foram comparadas. Protótipo, com dados estáticos.

`/lab` é liberado no gate de auth **só em desenvolvimento**
(`src/lib/supabase/proxy.ts`): não tem dado atrás dele, mas em produção seria superfície
pública sem motivo.

`ChannelRail` e `NavLinks` ganharam uma prop opcional `workspace` para a bancada poder
mostrar o menu de qualquer canal. No app ela é passada com o mesmo valor que já vinha da
URL — não muda nada em produção.

## Defeitos que apareceram no caminho

Ficam registrados porque os três voltam se alguém refizer a mecânica:

1. **`overflow-y: auto` sozinho cria barra horizontal.** Pela regra do CSS, um eixo
   `visible` ao lado de um não-`visible` computa para `auto`. Com o painel fechado o
   conteúdo é muito mais largo que a calha, e aparecia uma barra de rolagem no meio do
   menu. `overflow-x: hidden` explícito no `.rail-panel-nav`.
2. **O cabeçalho fechado deixava ~113px de vazio no topo**, desalinhando os ícones das
   páginas dos ícones dos canais. Ele agora se recolhe junto (`max-height`).
3. **O realce do item ativo saía do centro com o menu fechado.** A barra de rolagem
   vertical consumia 11px da calha (44px → 33px). O **ícone** não se mexe com isso — a
   posição dele vem dos paddings —, mas o realce é do tamanho do espaço disponível, então
   encolhia e ficava 5px à esquerda do ícone. A barra some enquanto o painel está fechado
   e volta quando abre; a roda do mouse continua rolando nos dois estados.
4. **O menu não fechava ao tirar o mouse.** `:focus-within` segurava o painel aberto
   depois de qualquer clique dentro dele. Ver a seção "Fixar aberto" — a correção é a
   classe `is-teclado`, decidida por `:focus-visible` no componente.
5. **`hidden lg:flex` sumiu quando o markup mudou de arquivo.** As utilitárias eram
   geradas a partir do `AppShell`; ao mover a `aside` para `OperationsRail`, o Tailwind
   servido estava velho e o menu ficou `display: none`. O responsivo do rail passou para o
   próprio bloco de CSS, onde a largura já morava — uma fonte só.

## Ícones

Medidos no menu do DataDive (19/08/2026): **18–20px**, cor `#737373`, e os de traço com
`stroke-width: 1.5` — vários dos deles são até preenchidos (`fill`, `stroke: none`).

Os nossos estavam em **20px com traço 1.8**. Passaram para **18px com 1.5** (`iconProps`
em `Nav.tsx`).

⚠️ **Mas espessura não era o problema principal.** Afinar o traço mantendo os mesmos
glifos não resolveu — ela olhou e disse "são os mesmos ícones de antes". O que suja a
calha é **desenho carregado**, e o critério do DataDive é *um objeto só, sem detalhe
interno*. Quatro dos nossos violavam isso:

| Antes | Depois | Por quê |
|---|---|---|
| `Boxes` — 3 cubos sobrepostos | `Box` | uma caixa lisa |
| `Radar` — arcos + varredura + ponto | `Gauge` | um ponteiro |
| `Sparkles` — 3 estrelas de 4 pontas | `Lightbulb` | uma lâmpada |
| `Blocks` — blocos em 3D | `Plug` | uma tomada |

`Calculator` ficou como está: a grade de teclas é detalhada, mas qualquer troca perde o
significado — e significado ganha de limpeza num menu.

⚠️ **Só o SVG encolheu.** A caixa que o envolve continua `h-6 w-6` (24px), porque é ela
que centraliza o ícone na calha de 60px do menu fechado — mexer nela desalinha tudo.

A cor não mudou: `--ink-muted` (`oklch(0.565 0.021 244)`) tem a mesma luminosidade do
`#737373` deles, com o leve tom azulado que é da nossa paleta.

O que continua diferente do DataDive, de propósito:
- **Magnify no hover** (`scale(1.12)`, estilo Dock do macOS) — os deles não se mexem.
- **Ícone do item ativo assume a cor do canal**; o deles fica cinza.

## Armadilha de ambiente: servidor de dev órfão

**19/08/2026.** A correção do `:focus-within` ficou pronta e o menu continuou aberto no
navegador dela. Não era cache: **um `next dev` órfão de uma rodada anterior ainda segurava
a porta 3001** e servia o CSS antigo.

Acontece porque matar o shell que rodou `npm run dev` **não mata o processo filho** do
Next. O próximo `npm run dev` vê a porta ocupada, sobe numa porta diferente, e a aba que
já estava aberta continua conversando com o servidor velho — que compila código velho.

Como identificar e resolver:

```bash
netstat -ano | grep LISTENING | grep ":3001"     # descobre o PID que segura a porta
powershell -NoProfile -Command "Get-Process node | Select-Object Id,StartTime,CPU"
powershell -NoProfile -Command "Stop-Process -Id <PID> -Force"
```

⚠️ **A lição que custou mais caro:** eu dei o menu como verificado depois de testar em
`/lab/rail`, mas **todo** o comportamento que observei lá era igualmente explicável pelo
CSS antigo — foco dentro do menu mantinha o painel aberto, foco fora fechava, exatamente
como `:focus-within` faria. Nenhum daqueles testes distinguia a versão nova da velha.

O teste que distingue é **procurar a regra no CSS servido**, não observar o efeito:

```bash
CSS=$(curl -s http://localhost:3001/landing | grep -o '/_next/static/chunks/[^"]*\.css' | head -1)
curl -s "http://localhost:3001$CSS" | grep -c "is-teclado"
```

# Donos da árvore

Quem é dono de qual parte do repositório, para o portão de commit saber quando um
commit está levando junto o trabalho de outra pessoa.

## Por que isto existe — e não é burocracia, é cicatriz

Duas colisões reais em **29/08/2026**, com poucas horas de diferença:

- **~03:00** — um `git add` abrangente varreu dois arquivos não commitados de
  outro agente para dentro de um commit alheio.
- **~15:30** — a barra de filtro da Vitrine subiu dentro de um lote de backend,
  em produção, antes da janela que ela tinha combinado.

Nas duas, **ninguém percebeu na hora**. E nas duas o gesto foi o mesmo: alguém
com certeza de que a árvore estava limpa, porque tinha commitado há pouco — e no
intervalo a outra pessoa começou a trabalhar.

> **O erro não é esquecer de olhar. É achar que já sabe.** Nenhuma disciplina
> cobre isso, porque a memória estava correta sobre um estado que mudou por causa
> de outra pessoa. Por isso a defesa é um portão que olha sempre, e não uma regra
> que alguém precisa lembrar.

## O mapa

Casamento por **prefixo mais longo**. Um caminho sem dono é `compartilhado`.

- `src/app/components/` → vitrine
- `src/app/components/FinancialSummaryPanel.tsx` → compartilhado
- `src/app/globals.css` → vitrine
- `src/app/landing/` → vitrine
- `src/app/landing-v2/` → vitrine
- `src/lib/` → backend
- `src/app/api/` → backend
- `src/instrumentation.ts` → backend
- `src/proxy.ts` → backend
- `migrations/` → backend
- `scripts/` → backend
- `docs/` → compartilhado
- `tests/` → compartilhado
- `package.json` → compartilhado
- `fly.toml` → backend

⚠️ **`FinancialSummaryPanel.tsx` é compartilhado de propósito.** Ele mora na área
da Vitrine, mas o que se mexe nele é a **composição de um número** — conta, não
renderização. Território de dois donos vira linha no mapa, não exceção no commit.

⚠️ **`compartilhado` não cruza com ninguém.** Documentação e teste acompanham
quem escreveu o código — barrar um commit por causa de um `.md` seria o tipo de
atrito que faz a cerca virar coisa que se contorna.

⚠️ **As telas de canal** (`src/app/amazon/`, `src/app/mercado-livre/`,
`src/app/shopee/`, `src/app/tiktok/`) ficam de fora do mapa **de propósito**: são
o ponto onde a conta do backend encontra a composição do front, e é justamente
ali que os lotes legítimos cruzam. Marcá-las forçaria o escape em toda mudança
normal, e escape que se usa sempre não é escape — é ruído.

## O escape

Um commit **pode** cruzar duas áreas quando a mudança é de **contrato e precisa
ser atômica** — quando dividir produziria um commit intermediário em que a tela
mente ou o código não compila.

Para isso, a mensagem de commit precisa carregar uma linha:

```
cruza-areas: <motivo em uma frase>
```

O critério **não é urgência nem tamanho**. É **um motivo só**: contrato que
precisa ser atômico.

Dividir produziria um commit intermediário em que a tela mente ou o código não
compila. Exemplo real: o lote da ADR-033 mudou `available_qty` para poder ser
`null` — o leitor em `src/lib` e a tela em `src/app/components` tinham que subir
juntos, senão existe um commit no meio em que a tela afirma estoque zero sobre o
que ninguém informou.

> "Urgente" todo mundo acha que é. "Dividir deixaria um commit em que a tela
> mente" é **verificável por quem lê depois** — e é por isso que este critério
> não apodrece.

### ⚠️ O que NÃO é motivo de escape

**Permissão para tocar arquivo da área do outro.** Isso é questão de **dono**, e
a resposta é o **mapa** — não o escape.

A tentação é real e apareceu no primeiro uso: `FinancialSummaryPanel.tsx` mora em
`components/` (Vitrine), mas a composição de um número é conta, não
renderização. A saída certa foi **uma linha no mapa**, acima, e não uma frase no
commit.

> **O escape descreve o CÓDIGO, nunca a combinação entre pessoas.**

Se ele aceitasse "combinei com fulano", em um mês alguém escreve
`cruza-areas: a Vitrine deixou` e a cerca morreu — porque o critério teria
virado **permissão** em vez de **atomicidade**. Permissão não é verificável por
quem lê o histórico depois; "dividir deixaria um commit em que a tela mente" é.

*(Distinção levantada pelo cerebro em 29/08/2026, antes do primeiro uso real —
a ressalva original da Vitrine sobre este arquivo continua válida, e virou a
linha do mapa.)*

⚠️ **PRIMEIRO USO REAL — 30/08/2026, commit `cc8234f`.** Até aqui a cerca nunca
tinha fechado e o escape nunca tinha sido usado; este doc registrava isso como
*"cerca que nunca fechou não está testada em produção — está só instalada"*.

O lote que a fechou: a margem deixando de ser refém do custo, nos quatro canais.
Ele mistura `backend` (5 arquivos de `src/lib/`, as fontes que paravam de anular
o lucro) e `vitrine` (8 de `src/app/components/`, as telas que passaram a
exibi-lo com o sinal). A mensagem de bloqueio listou os dois donos e as duas
saídas, e resolveu sem precisar abrir este documento.

O escape usado, com **um motivo só**:

> `cruza-areas: a fonte para de anular o lucro e a tela passa a exibi-lo com o
> sinal; separados, um dos dois commits deixa a tela mentindo.`

É **atomicidade, não permissão** — e é verificável por quem ler depois: dividir
produziria um commit em que a fonte devolve o lucro e a tela ainda o esconde, ou
pior, a tela mostrando margem sem o sinal ao lado. **A cerca deixou de estar só
instalada.**

O escape custa uma frase e fica **auditável no histórico** — que é a diferença
entre ele e uma allowlist muda.

## O que este portão NÃO pega

⚠️ **PONTO CEGO DECLARADO: as telas de canal.** `src/app/amazon/`,
`src/app/mercado-livre/`, `src/app/shopee/` e `src/app/tiktok/` estão fora do
mapa de propósito (ver a nota acima) — e a consequência é que **colisão naquelas
quatro pastas não vai ser pega**.

Foi aceito com o caso na mão: as duas colisões de 29/08 foram em
`src/app/components/`, que **está** no mapa — a cerca teria pegado as duas. Se
acontecer colisão nas telas de canal, a gente revisita com o caso real em vez de
com hipótese.

> **Instrumento que declara o próprio ponto cego é mais confiável que o que
> promete cobrir tudo.**

⚠️ **TERCEIRO PONTO CEGO: mudança de contrato que quebra o trabalho EM VOO do
outro.** A cerca impede o commit misturado; ela **não** impede que uma mudança
legítima na sua própria área derrube o que o outro dono está escrevendo agora.

No `cc8234f` o `Metric.tsx` teve `sub` alargado de `string` para `ReactNode`, e o
`Flow` teve `value`. São arquivos da Vitrine, alterados dentro de um commit que
declarou o cruzamento — tudo certo pela regra —, mas se ela estivesse com uma
tela aberta usando o tipo antigo, descobriria pelo `tsc` quebrando, não por
aviso. O portão não tem como saber o que está no editor de ninguém.

**A defesa aqui não é código, é aviso:** mudou contrato de componente
compartilhado, fala com o outro dono. Ficou registrado porque, dos três pontos
cegos, este é o único em que a cerca passar é o comportamento *correto* e ainda
assim alguém pode se machucar.

Ele olha o que está **staged**. As duas colisões de 29/08 nasceram de `git add`
abrangente — e nesse caso o stage **já está contaminado** quando o portão olha.
Ele barra, que é o certo, mas a pessoa descobre depois de ter varrido.

⚠️ **PONTO CEGO MAIOR QUE O PRIMEIRO: a cerca pega "levei o trabalho do outro
junto"; NÃO pega "fiz o trabalho do outro inteiro".** E como todos os commits saem
da **mesma identidade git**, ela não consegue distinguir agente — o que significa
que o segundo caso é **invisível por construção, e não por descuido**.

`avaliarCommit` reprova quando o commit tem **mais de um dono**. Um commit com um
dono só passa — mesmo que o dono não seja quem commitou. Não há nada no stage nem
na mensagem que diga *quem* está commitando, então não há o que comparar.

**O `ab81ef0` é a prova viva:** cem por cento arquivo da Vitrine
(`ShopeeModulePage.tsx`, `TikTokModulePage.tsx`), commitado pelo backend, portão
passou — e **está certo pela regra dele**. Repassado depois pelo próprio portão,
com o mapa antigo e com o novo: `donos: ["vitrine"]`, `PASSOU: true`.

⚠️ **A cerca nunca fechou.** Até 29/08/2026 ela não barrou um commit sequer, e o
escape `cruza-areas:` **nunca foi usado**. Os dois lotes daquele dia foram
divididos por disciplina de quem commitava, não por ela: o `33b82f2` caiu inteiro
dentro do ponto cego das telas de canal, e o `ab81ef0` tinha um dono só. Então não
há dado sobre se a mensagem de bloqueio ajuda — ela nunca foi lida por ninguém.

> **Cerca que nunca fechou não está testada em produção — está só instalada.**

*Os dois pontos cegos acima estão DECLARADOS, não consertados, e isso é a ordem
combinada: primeiro declarar onde não se enxerga, depois resolver. Inventar
identidade por agente às pressas trocaria um buraco conhecido por um mecanismo
não pensado.*

Um aviso mais cedo, no `pre-commit` (*"você está encenando N arquivos que não
estavam no seu último diff"*), pegaria antes. Fica registrado como melhoria
possível, não como falta — *sugestão da Vitrine, 29/08/2026*.

## Como ligar

```
git config core.hooksPath .githooks
```

O portão roda no `commit-msg` (e não no `pre-commit`) porque precisa das **duas**
coisas ao mesmo tempo: os arquivos no stage e a mensagem, para reconhecer o
escape.

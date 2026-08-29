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

Ele olha o que está **staged**. As duas colisões de 29/08 nasceram de `git add`
abrangente — e nesse caso o stage **já está contaminado** quando o portão olha.
Ele barra, que é o certo, mas a pessoa descobre depois de ter varrido.

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

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

O critério **não é urgência nem tamanho**. É atomicidade de contrato. Exemplo
real: o lote da ADR-033 mudou `available_qty` para poder ser `null` — o leitor em
`src/lib` e a tela em `src/app/components` tinham que subir juntos, senão existe
um commit no meio em que a tela afirma estoque zero sobre o que ninguém informou.

O escape custa uma frase e fica **auditável no histórico** — que é a diferença
entre ele e uma allowlist muda.

## Como ligar

```
git config core.hooksPath .githooks
```

O portão roda no `commit-msg` (e não no `pre-commit`) porque precisa das **duas**
coisas ao mesmo tempo: os arquivos no stage e a mensagem, para reconhecer o
escape.

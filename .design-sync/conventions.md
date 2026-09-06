# Como construir com o design system do NEXO

Este pacote é o retrato fiel do NEXO em produção — um SaaS de análise de vendas
para vendedores de marketplace no Brasil. Texto de interface em **pt-BR**,
dinheiro em formato brasileiro (`R$ 1.234,56`), percentual com vírgula (`11,9%`).

## Setup e embrulho

Não há provider. Os componentes funcionam soltos, com UMA exceção que importa:
**tudo que mostra margem ou barras de lucro precisa de um ancestral
`.cockpit-faixa`** — é nele que as variáveis `--ml-verde` (verde de estado
positivo) e `--ml-coluna` (coluna do gráfico) estão definidas. Fora dele,
`ChipDeMargem` positivo, `ReguaDeDias` e `ListaDeTopProdutos` renderizam sem
cor. Embrulhe assim:

```jsx
<div className="cockpit-faixa" style={{ border: 0 }}>
  <ListaDeTopProdutos … />
</div>
```

(`FaixaDeResultado` já É a `.cockpit-faixa` — dentro dela nada disso é preciso.)

## Idioma de estilo

Classes CSS + variáveis de token — sem CSS-in-JS, sem utilitários. Para o seu
próprio layout de cola, use os tokens de `tokens/tokens.css` (leia o arquivo —
os comentários explicam as decisões): tinta `--ink`, `--ink-muted` e a escada de opacidade `--ink-03`, `--ink-05`,
`--ink-08`, `--ink-12`, `--ink-32`, `--ink-50`, `--ink-64`; superfícies
`--paper`, `--paper-warm`; status `--positive`, `--warning`, `--danger` (com
pares `--*-soft`); raios `--radius-sm`, `--radius-md`, `--radius-lg`,
`--radius-badge`, `--radius-menu`, `--radius-modal`; sombras `--shadow-xs`,
`--shadow-surface`, `--shadow-hover`, `--shadow-modal`, `--shadow-inset`. A fonte é
Inter (`var(--font-app-sans), "Segoe UI", sans-serif`), já aplicada no body via
`tokens/tokens-fonte-base.css`.

## Regras do produto que o design carrega

- **Desconhecido é `—` (travessão), nunca `R$ 0,00`** — zero é fato, ausência é
  ausência. `ChipDeMargem` com `margemPct={null}`, `CartaoDeMetrica` com
  `value="—"`, dia com `valor: null` na `ReguaDeDias` (não desenha coluna).
- **Pendência aponta com número e link** (`LinhaDePendencias`:
  "Cadastrar custo de 5 produto(s)") — nunca "parcial" ou "incompleto".
- Carregando é `Esqueleto`, nunca spinner. Tela sem dado é `EstadoVazio` com
  convite para agir. A voz do produto é `MensagemDoNexo` — parágrafos curtos,
  todo número vem de fora por props.

## Onde está a verdade

`styles.css` → `tokens/tokens.css` (tokens comentados) + `_ds_bundle.css`
(estilos dos componentes). A API de cada peça está no `<Name>.d.ts` e o uso no
`<Name>.prompt.md` da pasta `components/`.

## Exemplo idiomático

```jsx
<FaixaDeResultado
  titulo="Resultado — Hoje"
  lucro={240}
  lucroFormatado="R$ 240,00"
  frase={<>de lucro em <strong>50 venda(s)</strong> · margem <strong>11,8%</strong></>}
  parcelas={[
    { id: "cogs", rotulo: "Custo R$ 920,00", valor: 920, cor: "#FF0000" },
    { id: "taxes", rotulo: "Impostos —", valor: null, cor: "#FFC2C2" },
    { id: "result", rotulo: "Lucro R$ 240,00", valor: 240, cor: "#337129" },
  ]}
  aoLado={<ListaDeTopProdutos titulo="Top produtos — Hoje" contagem="4 produtos" linhas={[…]} vazio="Sem vendas no período para ranquear." />}
/>
```

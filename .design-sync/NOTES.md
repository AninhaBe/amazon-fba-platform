# NOTES — design-sync do @nexo/ds

- O pacote vive em `packages/nexo-ds` e NÃO está em node_modules por install
  (o repo não usa workspaces). O sync depende de uma **junction**
  `node_modules/@nexo/ds -> packages/nexo-ds` (Windows: `cmd /c mklink /J`),
  criada em 06/09/2026 só para o `tokensPkg` resolver. Num clone novo, recriar.
- `tokensPkg: "@nexo/ds"` + `tokensGlob: "src/estilos/tokens.css"` é o que faz
  os 32 `var(--*)` do componentes.css resolverem. Sem isso: [TOKENS_MISSING].
- Build do dist: `npm run build --prefix packages/nexo-ds` (verificaExemplos →
  tsup → tsc para .d.ts; o dts do tsup estoura com o TS do repo, por isso tsc).
- Fontes: o app carrega **Inter via next/font no layout** — nenhum CSS do
  pacote declara `font-family` base nem @font-face; nos cards a UI cai na
  sans do sistema (fidelidade parcial, avaliar pelo contact sheet).
  "Cascadia Mono" aparece só como 2º fallback de uma pilha `ui-monospace`
  (.profit-sale-sku) — pilha de fonte de SISTEMA por desenho, não fonte de
  marca; substituto é o comportamento esperado. [FONT_MISSING] dela é aceito.

## Re-sync risks
- A junction `node_modules/@nexo/ds` some em clone novo / `npm ci` — recriar
  antes do build do sync.
- `dist/` do pacote é gitignored — rodar o buildCmd antes do converter.
- Playwright: cache local pina chromium-1161 → playwright@1.51.0 no .ds-sync.

## Achados de design expostos pelo sync (06/09/2026)
- `--ml-verde`/`--ml-coluna` são definidas SÓ em `.cockpit-faixa` (não em
  :root): ChipDeMargem positivo, ReguaDeDias e ListaDeTopProdutos ficam sem cor
  fora dela. Os previews embrulham no contexto real; é a 2ª inconsistência do
  design atual (a 1ª: não existe etiqueta-de-estado única). Se um dia os tokens
  subirem para o :root, tirar os wrappers dos previews.
- `packages/nexo-ds/src/estilos/tokens-fonte-base.css` foi criado PELO SYNC
  (Inter via Google Fonts + body) — no app a Inter entra pelo next/font.
  tokensGlob "tokens*.css" existe para pegá-lo; renomear quebra a fonte.

## Known render warns
- (nenhum — 16/16 limpos em 06/09/2026)

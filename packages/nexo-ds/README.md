# @nexo/ds — design system do NEXO

Um **retrato do design que está no ar**, extraído em 06/09/2026. Não é um
redesign, não é uma proposta: é o que a aplicação renderiza hoje, isolado num
pacote que roda sozinho.

## O que isto é, e o que não é

**É** um pacote apresentacional. Cada componente é uma cópia do markup e das
classes que estão em produção, com `fetch`, sessão e rota removidos — o dado
entra por props.

**Não é** consumido pelo app. Esta extração foi feita sem tocar em uma linha
fora de `packages/nexo-ds/`, de propósito: trocar as telas para consumir o
pacote é uma decisão de outra frente, com risco próprio.

⚠️ **Enquanto isso não acontece, `src/app/globals.css` continua sendo a fonte da
verdade.** Se os dois divergirem, quem está certo é o app, e este pacote é que
está velho.

## Uso

```tsx
import "@nexo/ds/estilos/tokens.css";      // as fundações — sempre primeiro
import "@nexo/ds/estilos/componentes.css"; // as regras das peças

import { ChipDeMargem, FaixaDeResultado } from "@nexo/ds";
```

Cada componente exportado tem um exemplo mínimo que renderiza sozinho em
`src/exemplos/exemplos.tsx` — só com o `tokens.css` importado, sem app, sem
dado real.

## O que está aqui

| Peça | O que ela carrega de decisão |
|---|---|
| `MensagemDoNexo` | a voz do modelo com um peso visual só nas quatro abas |
| `CartaoDeMetrica` / `ReguaDeMetricas` | a explicação vai no `i`, não embaixo do número |
| `ChipDeMargem` | os limiares `<12` / `12–15` / `>15`, e `null` como traço |
| `FaixaDeResultado` / `LinhaDePendencias` | número e frase na mesma linha-base; parcela desconhecida fora da barra |
| `ReguaDeDias` | dia desconhecido não vira coluna no chão |
| `LinhaDeTopProduto` / `ListaDeTopProdutos` | título de uma linha, com o texto inteiro no `title` |
| `LinhaDeRentabilidade` | VENDA − CUSTOS = MARGEM escrita, e a linha como container |
| `AvisoDeCobertura` / `BaseDeData` | só fala quando os números não cobrem o período |
| `SeletorDePeriodo` | cada tela declara o que oferece |
| `Esqueleto` | a forma do que vem, nunca um spinner |
| `EstadoVazio` | o estado real, nunca zeros |
| `AcaoPrimaria` | a ação é preta, não azul |

## Build

```
npm run build      # guarda + bundle ESM + declarações
npm run verifica   # só a guarda
```

⚠️ **A guarda roda antes do bundle e reprova o build**: todo export do
`index.ts` precisa de exemplo, e todo exemplo precisa de export. Export sem
exemplo é componente que ninguém sabe montar; exemplo sem export é código morto
apontando para algo que saiu. E se um componente sumir do próprio módulo, quem
reprova é o `esbuild` — `No matching export`.

Os tipos saem do `tsc`, não do gerador embutido no tsup: o `rollup-plugin-dts`
traz um TypeScript próprio e estoura contra a versão instalada aqui.

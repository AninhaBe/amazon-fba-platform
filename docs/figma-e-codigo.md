# Figma e código — o que aponta para o quê

O arquivo **`NEXO — Mercado Livre (front de 10/09)`** tem uma página
`Sistema — NEXO` com as variáveis e os componentes do front do Mercado Livre,
extraídos de `src/app/globals.css` e dos componentes React. Este doc é o mapa de
volta: dado um componente do Figma, onde ele mora no código.

- Arquivo: `xxJsTJ99dYxG3uluXMO7zB`
- Página do sistema: `node-id=10-2`
- Telas capturadas: Anúncios `1-2`, Dashboard `3-2`, Monitor `4-2`, Radar de
  estoque `5-2`, Pedidos a revisar `6-2`

## ⚠️ Por que este arquivo existe em vez de Code Connect

O Code Connect da Figma faz exatamente isto de forma automática — e **não está
disponível nesta conta**. Medido em 11/09/2026, não suposto:

```
whoami                        → tier: "starter", seat: "Full"
get_code_connect_suggestions  → "You need a Dev or Full seat on an
                                 Organization or Enterprise plan"
```

Enquanto o plano for Starter, o mapa é manual e vive em dois lugares: na
**descrição de cada componente** no Figma (aparece no painel de inspeção) e
aqui, onde um `grep` encontra. O que se perde em relação ao Code Connect é o
automatismo: **ninguém avisa quando o código muda de nome**. Ao renomear
qualquer classe ou componente da tabela abaixo, atualize as duas pontas.

📌 Se o plano subir para Organization/Enterprise, este doc morre e vira
`.figma.ts` por componente — ver a skill `figma-code-connect`.

## O mapa

| Componente no Figma | Código | Variantes / props |
|---|---|---|
| Chip de margem | `.v3-chip` + `.v3-chip-pos` / `-aten` / `-neg` / `-vazio` (`globals.css`) | Vazio é margem **desconhecida**, nunca zero |
| Botão | `.v3-btn`, `.v3-btn.is-primaria` | Ação (azul) e Primária (preta) |
| Cartão de métrica | `ColunaDoMonitor` — `src/app/components/MercadoLivreWorkspace.tsx` | `rotulo`, `valor`, `tom?: "positivo" \| "negativo" \| "vazio"`; Neutro é `tom` ausente |
| Cartão | `.v3-card` | container de seção |
| Seletor | `SeletorNexo` — `src/app/components/SeletorNexo.tsx` | `valor`, `opcoes`, `aoEscolher`, `rotuloAcessivel` |
| Opção da lista | `.v3-seletor-opcao` (dentro de `SeletorNexo`) | `.is-focada`, `.is-escolhida` |
| Cabeçalho de coluna | `.v3-anuncios-cab`, `.v3-revisar-cab`, `.v3-radar-cab`, `.v3-coluna-rotulo` | **uma regra só** — mudar aqui muda todas as tabelas |
| Célula de duas linhas | `.v3-cel-duplo` | usada em `anuncios/page.tsx` e `auditoria/page.tsx` |

## As variáveis

A coleção `NEXO — tokens` tem 46 variáveis, em quatro famílias. Todas saíram do
CSS; nenhuma foi escolhida no Figma.

| Família | O que é | De onde veio |
|---|---|---|
| `tinta/` | a escada de opacidade (cheia, 80, 64, 50, 32, 12, 08, 05, 03) | `--ink`, `--ink-*` |
| `sinal/` | verde, vermelho, âmbar, cada um com o par suave | escopo `.v3` |
| `acao/` | o azul claro de botão e seletor, com hover e aberto | `--acao*` |
| `chip/`, `verde/` | os matizes próprios de chip e de barra de participação | hexadecimais soltos no CSS |
| `raio/`, `espaco/`, `altura/`, `traco/` | os números, nomeados por papel | `--radius-*` e as regras `.v3-*` |

⚠️ **`espaco/` é nomeado por papel, não por medida.** `espaco/entre-cartoes` é
20 e `espaco/dentro-do-cartao` é 14; quem só vê "20" e "14" troca um pelo outro.

## Estado

As cinco telas capturadas **ainda são frames crus** — elas não usam as
instâncias destes componentes. Recompor uma tela é trabalho por tela, e só vale
a pena na que for redesenhada.

## Changelog observado

- **11/09/2026** — Code Connect medido como indisponível (plano Starter). Página
  `Sistema — NEXO` criada com 46 variáveis, 6 conjuntos de componentes, 2
  componentes avulsos e 8 estilos de texto.

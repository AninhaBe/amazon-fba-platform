# Identidade visual do NEXO

**19/08/2026.** Direção escolhida: **monocromática**, a partir de
[peec.ai](https://peec.ai) — comparada contra [sequencehq.com](https://www.sequencehq.com)
(serifada clara) e [lightdash.com](https://www.lightdash.com) (sans com acento próprio).

## A regra que decide tudo

**A única cor da interface é a que significa alguma coisa.** Cromo em branco, preto e um
cinza só; cor reservada para canal, lucro, prejuízo, pendência e alerta.

Isso não é gosto — é a mesma regra que já governa o produto. Se `null ≠ 0` e a tela tem
que dizer o que não sabe, então cor que não carrega informação é ruído que compete com
cor que carrega.

E resolve um problema concreto: Amazon (laranja), Mercado Livre (amarelo), Shopee
(vermelho) e TikTok (rosa) entram na tela queira ou não. Uma identidade neutra hospeda os
quatro; uma identidade com acento próprio colocaria uma quinta cor na disputa — foi o que
eliminou a direção do Lightdash.

## Os valores

| | Antes | Agora |
|---|---|---|
| Título | serifada do sistema, peso 400 | **Inter, peso 700**, tracking −0.03em |
| Tinta | `oklch(0.22 0.012 250)` (preto azulado) | `#000000` |
| Suave | `oklch(0.52 0.02 250)` | `#6d6d6d` |
| Cantos (CTA, pill) | `999px` (pílula) | `8px` |

A **segunda metade do título recua para preto 42%** (`Você vende.` cheio, `Ele confere.`
apagado). É a assinatura do peec.ai e é o que dá hierarquia dentro de uma frase só, sem
apelar para cor nem para uma segunda família tipográfica.

📌 **A direção removeu fontes em vez de adicionar.** A serifada da landing nunca foi fonte
carregada — era a serifada do sistema. A `Inter` já estava no projeto. A `Bricolage
Grotesque`, usada em `.page-heading h1` do app, é display com personalidade própria e
briga com a neutralidade: **sai na etapa 2**.

## Onde a cor continua

Nada disso muda:

- **Canal** — laranja Amazon, amarelo ML, vermelho Shopee, rosa TikTok
- **Lucro** verde · **prejuízo/dedução** vermelho · **pendência** âmbar
- **Gráficos** — a paleta de séries

## Como foi aplicada

**Pelos tokens, não pelos usos.** Os tokens de marca só apareciam no próprio
`globals.css` (`--brand` em 27 lugares, nenhum em `.tsx`), então trocar a definição levou
a aplicação inteira junto — nenhum componente precisou ser editado.

Depois, uma varredura neutralizou 36 valores de cinza tingido soltos pelo arquivo. O
critério foi mecânico e vale repetir se sobrar algum: **croma < 0.05 em matiz azul
(235–260) ou amarelo (60–110) é cinza tingido, ou seja, cromo.** Croma ≥ 0.05 é cor de
verdade e ficou de fora.

## Estado

- ✅ **App** — cromo neutro, `--brand` preto, `Bricolage` fora dos títulos, fundo sem
  gradiente, rail neutro
- ⬜ **Landing** (`/landing`) — **não** foi tocada; continua com serifada do sistema,
  tinta azulada e CTAs em pílula

⚠️ **As duas divergem hoje.** Isso é estado intermediário, não decisão: aplicar a
identidade na landing também é o passo que falta para elas baterem.

## Em aberto

- **`--core`** (o laranja da marca, `oklch(0.685 0.158 48)`) continua laranja. É o ponto
  do logo, não cromo de interface — cabe decidir se a marca fica monocromática também.
- **`--tiktok`** já era quase preto e agora encosta no `--brand`: o canal TikTok e o
  acento neutro ficam parecidos.

A bancada com as três direções fica em `/lab/identidade`, com o hero do NEXO em cada uma.

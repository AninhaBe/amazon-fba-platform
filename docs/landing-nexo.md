# Landing do NEXO — mapeamento a partir de dub.co e midday.ai

**16/08/2026.** Referências escolhidas por ela: **estrutura do [dub.co](https://dub.co)**
("encaixa mais na nossa proposta") e **efeitos do [midday.ai](https://midday.ai)**.
Código do midday é aberto: `github.com/midday-ai/midday`.

Isto é mapa, não decisão fechada. Serve para discutir seção a seção.

---

## ⚠️ De onde dá para copiar código (verificado em 16/08/2026)

| Repo | Landing no repo? | O que serve |
|---|---|---|
| `midday-ai/midday` | **Sim** — `apps/website`, Next.js separado, 457 arquivos | página, seções e `components/motion-primitives` |
| `dubinc/dub` | **Não** — só `app.dub.co` (o dashboard) | estrutura, lida da página renderizada; e a UI do produto em `apps/web/ui` |

O dub teve `app/(marketing)` aberto até maio/2023 (commit `4ff9cb0`), mas é a landing
de três anos atrás, não a que está no ar.

📌 **Padrão que vale para a próxima referência:** empresa OSS quase sempre abre o produto
e fecha o site de marketing (Dub, Cal.com, Documenso). O midday é exceção. Ao procurar
código de landing, o filtro é `apps/website` ou `apps/www` no monorepo — o Supabase
também tem.

### A técnica de animação do midday

De `time-tracking-calendar-animation.tsx`:

```ts
calendarEvents.forEach((e, i) =>
  setTimeout(() => setVisible(prev => new Set(prev).add(e.id)), i * 150 + 300));
setInterval(animateEvents, 8000);   // o REINÍCIO é o que faz parecer vídeo
```

Estado com os itens visíveis + `setTimeout` escalonado por índice + `setInterval` que
zera e recomeça. Eles usam `motion/react`; aqui o mesmo resultado sai com transição CSS,
sem dependência nova. Implementado em `src/app/landing/VitrineAnimada.tsx`.

## Por que o dub.co encaixa

Os dois vendem a mesma promessa que o NEXO: **"você já tem os dados, mas não tem
clareza"**. O manifesto deles é literalmente isso:

> *"Marketing isn't just about clicks. It's about outcomes. […] Because you deserve
> more than vanity metrics. You deserve clarity."*

Trocando marketing por venda multicanal, é a nossa frase. O produto todo que
construímos hoje — faturamento que é o valor pago, saldo que diz quando o dinheiro
cai, pendência que diz de quem é a espera — é sobre isso.

---

## A estrutura do dub.co, seção a seção

| # | Seção deles | Equivalente no NEXO |
|---|---|---|
| 1 | Pílula de anúncio no topo | "Agora com Shopee e TikTok Shop" |
| 2 | Hero: claim curto + 1 frase + 2 CTAs | ver abaixo |
| 3 | Três pilares nomeados como produtos | Financeiro · Anúncios · Estoque |
| 4 | Manifesto com frases rotativas | "não é sobre quanto você vendeu" |
| 5 | Seção profunda por pilar: claim + UI real + 3 sub-features + depoimento | uma por pilar |
| 6 | "Built to scale" com contadores animando de 0 | pedidos conciliados, canais, R$ auditados |
| 7 | Seção de API com abas de SDK | **pular** — não temos API pública |
| 8 | Parede de clientes: logos + citações | **não temos ainda** (ver risco) |
| 9 | "We ship fast" — changelog com datas | temos, e é forte |
| 10 | CTA final repetindo o hero | igual |

### O detalhe que faz a diferença deles

Cada pilar tem **UI de verdade renderizada em HTML**, não print. Os cards de link, a
tabela de eventos ao vivo, a lista de payouts rolando. É caro de fazer e é o que separa
"landing de SaaS" de "landing que parece o produto".

**Nós temos vantagem aqui:** os componentes já existem. Os doze cards, a cascata
financeira, o bloco de saldo com as datas de liberação, a tabela de pedidos a revisar —
tudo já é React no repo. Dá para reusar de verdade em vez de recriar.

---

## Hero — três versões para escolher

O padrão do dub é: **claim de 3-5 palavras** + uma frase explicando + dois botões.

**A. Pelo dinheiro**
> ### Seu lucro, sem achismo
> O NEXO reúne Amazon, Mercado Livre, Shopee e TikTok Shop e mostra quanto cada venda
> deixou — com a tarifa que foi cobrada, não com a estimada.

**B. Pela clareza** *(mais próximo do manifesto do dub)*
> ### Pare de adivinhar quanto sobrou
> Faturamento, tarifa, imposto e frete de todos os seus canais numa conta só. Quando o
> dado não existe, dizemos que não existe.

**C. Pelo tempo**
> ### Sua operação inteira numa aba
> Quatro marketplaces, um painel. Sem planilha, sem exportar relatório, sem conferir no
> braço.

Minha preferência é a **B**: é a única que promete algo que os concorrentes não
prometem. "Quando o dado não existe, dizemos que não existe" é uma frase que só quem
construiu com a regra `null ≠ 0` pode assinar — e é verificável na primeira tela.

---

## Manifesto — a seção que o dub faz melhor

Eles rodam frases trocando dentro do parágrafo. Nossa versão:

> ### Não é sobre quanto você vendeu.
> ### É sobre quanto sobrou.
>
> O NEXO junta *o que o marketplace cobrou* · *o que o comprador pagou* · *quando o
> dinheiro cai* — numa conta só.
>
> Rápido. Auditável. E honesto quando não sabe.
>
> Porque relatório que arredonda para zero não é relatório. É palpite bonito.

As três frases em itálico são as que rotacionam.

---

## Contadores — o que dá para provar hoje

O dub anima de 0: links criados, eventos, receita. Os nossos, com número real:

```
PEDIDOS CONCILIADOS      70.479
CANAIS INTEGRADOS             4
TARIFAS AUDITADAS     R$ 455 mil
```

⚠️ Os dois primeiros são medidos (banco, 16/08). O terceiro sai de comissão +
frete no canônico do ML — conferir antes de publicar. **Número em landing é promessa;
se não bate, vira o mesmo problema que passamos o dia corrigindo.**

---

## Efeitos do midday que valem copiar

Ela citou os efeitos. O que dá para reaproveitar sem virar enfeite:

- **Revelação por scroll**, seção a seção — combina com o tom "domínio tranquilo"
- **Números que sobem de 0** ao entrar na viewport
- **UI que se monta sozinha** (linhas da tabela entrando escalonadas), que é primo do
  efeito de letras assentando que já fizemos na assinatura NEXO
- **Cursor/hover discreto** nos cards de pilar

O que **não** copiar: gradiente colorido e glow. O midday é escuro e sóbrio; nosso
painel é claro. Copiar o efeito sem copiar a paleta.

---

## Riscos a resolver antes de construir

1. **Não temos clientes para a parede de depoimentos.** O dub tem Vercel, Framer,
   Perplexity. Fingir isso é o pior erro possível numa landing. Alternativas: mostrar
   **números da operação real** (com permissão), ou trocar a seção por "como
   funciona".
2. **Não temos API pública** — a seção 7 do dub sai inteira.
3. **A URL ainda é `sellercore.onrender.com`**, e trocá-la quebra o OAuth de Shopee e
   TikTok. A landing precisa entrar no plano de renomeação, não antes dele.
4. **Licença do midday** — o repo é aberto, mas conferir a licença antes de copiar
   código, não só ideia.

---

## Ordem sugerida

1. Hero + manifesto (só texto e a assinatura NEXO que já existe)
2. Três pilares com UI real reusada do produto
3. Contadores, depois de conferir os números
4. Changelog (já temos conteúdo)
5. CTA final

As duas primeiras já entregam uma landing defensável. O resto é incremento.

---

## A voz: o NEXO é um funcionário *(17/08/2026)*

Decisão dela: a proposta do NEXO é **ser um funcionário**, não um painel. A copy passou
a falar dele em terceira pessoa — "ele abre", "ele confere", "ele compara" — porque o que
se vende é **assumir um trabalho**, não entregar mais uma tela para a pessoa interpretar.

| Antes | Depois |
|---|---|
| Pare de adivinhar quanto sobrou. | **Você vende. Ele confere.** |
| Menos conferência. Mais operação. | O trabalho que ele tira das suas mãos. |
| Começar agora | Colocar para trabalhar |
| Sua operação inteira numa aba. | Ele começa a conferir hoje. |

### ⚠️ O limite da voz — leia antes de escrever mais copy

Só entra verbo que descreve o que o código **executa hoje**: ler tarifa, conciliar pedido,
comparar frete, acompanhar liberação. Isso é honesto porque o motor de sync e a
conciliação rodam de verdade.

**O que a landing NÃO pode prometer enquanto for backlog:** chat sobre a operação, alerta
proativo, recomendação e ação autônoma. Tudo isso está em `docs/ai-agent-harness.md` com
status *ideia / backlog — não implementar agora* (12/07/2026). "Funcionário" na landing é
a **descrição do serviço que já roda**, não a antecipação do que o produto vai virar.

Quando o harness sair do backlog, esta seção é o lugar de registrar o que passou a ser
verdade — e só então a copy pode crescer.

## Abas na vitrine do hero *(17/08/2026)*

O dub tem três abas no hero (Short Links / Conversion Analytics / Affiliate Programs), e
cada uma troca a tela **e a animação**. Replicado em `src/app/landing/Vitrine.tsx`:

| Aba | Tela | Animação |
|---|---|---|
| Financeiro | painel do canal (`VitrineAnimada.tsx`) | cards escalonados, barras subindo, cursor clicando o filtro |
| Saldo | `MostraSaldo` | cartões entrando, depois cada data de liberação |
| Auditoria | `MostraAuditoria` | linhas comparando de cima para baixo até a que não fecha |

O truque da troca é `key={aba}` no contêiner da tela: React remonta o componente e o
`useEffect` de cada animação recomeça do zero. Sem isso, quem clica cai no meio de um
ciclo já rodando.

As três telas são as mesmas das seções profundas — a aba é atalho e demonstração ao mesmo
tempo. Nenhuma é mock inventado: todas usam a UI real com os números de 16/08/2026.

## Efeitos do dub que entraram junto *(17/08/2026)*

- **Contadores subindo de 0** (`Contadores.tsx`) — com três travas para nunca exibir um
  zero falso: o valor final é o estado inicial, número abaixo de 1.000 não anima ("4
  canais" passaria 1,2s mostrando "0"), e se o scroll for rápido a ponto de o gatilho
  chegar com a seção já visível, a animação simplesmente não acontece.
- **Manifesto com ênfase rotativa** (`Manifesto.tsx`) — o dub troca o texto; aqui as três
  frases *são* a conta, então o que rotaciona é qual delas está acesa.
- **Réguas verticais do container** e **textura de pontos** atrás do manifesto — o
  `pattern`/`lines` do dub, sem cor e sem glow (a regra de não copiar a paleta continua).
- **Container 1080px**, que é o valor medido na página deles.

---

## Segunda referência: `dub.co/analytics` *(17/08/2026)*

Ela apontou a aba Analytics do dub. É um **template diferente** do da home — página de
produto — e rendeu três padrões, todos implementados.

⚠️ A galeria a1 tem 10 páginas do dub capturadas (about, blog, careers, customers,
changelog, contact, docs, solutions/creators, integrations, pricing) e **`/analytics` não
está entre elas**. Foi preciso abrir a página. Para a próxima referência: conferir
`get_website_pages` antes de prometer que a galeria cobre.

### 1. Fita de funil — `FitaFunil.tsx`

O "Visualize your journey" deles é o funil de conversão. Aqui virou a conciliação: entra
o faturamento largo, cada dedução estreita a faixa, sai o lucro.

**A largura de cada trecho é `valor / faturamento`, calculada dos centavos no componente.**
Não é proporção desenhada no olho — se alguém trocar um número, o desenho acompanha. É o
que autoriza a nota "a fita mede o que diz" embaixo do gráfico.

Substituiu a `AnimacaoConciliacao` no pilar Financeiro. A cascata de linhas continua no
repo e pode voltar se a fita não convencer.

### 2. Métricas que trocam o gráfico — `GraficoMetricas.tsx`

O "Success at a glance": três números grandes com bolinha colorida, o ativo sublinhado em
preto, gráfico de área trocando junto.

**A curva é acumulada, e isso foi decisão de honestidade, não de estética.** O período real
tem 5 vendas; um gráfico diário seria quase todo zero com cinco picos — e zero, nesta base,
significa "não vendeu nada". O acumulado sobe de verdade e cada ponto é um fato ("até aqui
tinha entrado tanto").

⚠️ **O que ainda não é medido:** as três séries compartilham a forma do faturamento, e a
distribuição entre os dias é proporcional, não apurada. Só o **ponto final de cada métrica**
é o valor real. Isso está escrito na nota ao pé do gráfico, na tela — não escondido no
código. Se um dia a série diária real sair do banco, é trocar `ACUMULADO` e apagar a
segunda frase da nota.

### 3. Arte do hero — `HeroGrafico.tsx`

Três linhas subindo, sangrando pela direita até a borda da janela, desbotadas à esquerda
por máscara para não brigar com o texto. Componente de servidor: sem estado, entrada por
CSS.

**Não tem eixo, rótulo nem valor, de propósito.** Gráfico decorativo com escala numerada
afirmaria um resultado que ninguém apurou. Aqui o problema se resolve tirando o número, e
não conferindo — o dado com valor aparece logo abaixo, onde tem origem.

### Padrões do dub que ficaram de fora

- **Parede de logos de clientes** — de novo, e pelo mesmo motivo.
- **Cards com a UI flutuando e desbotando no topo** (o 2-up deles) — cabe, não foi feito.
- **Linha de 4 features pequenas com ícone** — cabe, não foi feito.

## Nota de ambiente: o Turbopack em dev

Durante esta sessão o dev server serviu CSS e chunks velhos **cinco vezes** — regra que já
estava na memória, mas que aqui apareceu em três formas: CSS antigo com o arquivo novo em
disco, `ChunkLoadError` com o overlay marcando "(stale)", e `MODULE_NOT_FOUND` no runtime
do Turbopack.

**O que funciona:** parar o servidor, `rm -rf .next`, subir de novo. **O que engana:**
validar pelo print — o print mostrava o estado velho. Validar pelo **CSS computado**
(`getComputedStyle`) ou pelo erro no output do servidor.

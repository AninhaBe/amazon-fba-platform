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

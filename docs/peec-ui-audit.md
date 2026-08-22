# Auditoria de UI do peec.ai

**20/08/2026.** Levantamento feito em `app.peec.ai` com sessão autenticada, lendo
o CSS servido e medindo elementos renderizados — não a partir de screenshot.
Serve de referência para o redesenho do NEXO (`docs/identidade-visual.md` trata
da paleta; **este doc trata de estrutura e comportamento**).

> ⚠️ **O que este doc é e o que não é.** É um registro de princípios e medidas
> observadas. Não contém código, texto, dado nem asset do Peec, e nada aqui
> autoriza copiar identidade: o que se reproduz é a *qualidade estrutural*, não
> a aparência da marca deles.

> 📌 **A lição que motivou este doc.** A primeira tentativa de redesenho trocou
> paleta e chamou de identidade. Cor é a menor parte. O que faz aquela interface
> parecer o que parece é densidade, escala tipográfica curta, e a decisão de não
> ter nenhum elemento gritando.

---

## O resumo em uma frase

**É uma interface sem tipografia grande, sem borda, sem cor decorativa e sem
número gigante — e é exatamente por isso que ela lê como cara.**

Se você precisar reproduzir só uma coisa deste doc, reproduza o censo
tipográfico da seção 3. Ele sozinho responde por metade da diferença.

---

## 1. Estrutura geral

| Região | Medida | Observação |
|---|---|---|
| Sidebar | **240px** externo, **224px** de trilho útil | `position: fixed` |
| Deslocamento do conteúdo | `--sidebar-placeholder-width` (224px) | Variável CSS, não JS |
| Topbar | **48px** | Breadcrumb à esquerda, status/ajuda à direita |
| Barra de filtros | **~40px**, logo abaixo da topbar | Fila de pills, largura total |
| Conteúdo | resto da viewport, sem `max-width` | Cresce com a tela |
| Coluna de trabalho (onboarding) | 440–600px | Só nos fluxos de formulário |

**A decisão que mais importa aqui:** o deslocamento do conteúdo é uma *variável
CSS*, não um cálculo de layout em JS. É o que permite a sidebar encolher sem que
nada reflua e sem `useEffect` medindo largura.

**Ordem vertical, sempre a mesma:** breadcrumb → filtros → título de seção →
faixa de números → blocos de conteúdo. O filtro fica **acima** dos números
porque define todos eles.

## 2. Espaçamento

Censo do que está realmente renderizado na tela de Overview:

| `gap` | Ocorrências |
|---|---|
| 6px | 106 |
| 8px | 63 |
| 4px | 37 |
| 2px | 25 |
| 5px | 25 |
| 12px | 18 |
| 16px | 3 |

Escala efetiva: **2 / 4 / 5 / 6 / 8 / 12 / 16**. Acima de 16px praticamente não
existe gap — o respiro entre seções vem de padding e de régua, não de `gap`.

`padding` dominante: **`12px 16px`** (100 ocorrências) — é a célula de tabela.
Depois `0 8px`, `0 6px`, `0 12px`, que são os controles.

📌 **A densidade é alta de propósito.** Não é uma interface arejada; é uma
interface *silenciosa*. São coisas diferentes: o silêncio vem da ausência de
contraste desnecessário, não de espaço em branco.

## 3. Tipografia — a seção que mais importa

Censo de tamanho + peso efetivamente renderizados (Overview):

| Estilo | Ocorrências |
|---|---|
| **14px / 20 · w500 · −0.112px** | **142** |
| 13px / 18 · w500 · −0.065px | 39 |
| 12px / 12 · w500 · 0 | 17 |
| 14px / 20 · w600 · −0.196px | 3 |
| 16px / 16 · w600 · −0.128px | 3 |
| 13px / 18 · w600 · −0.065px | 3 |

**O app inteiro vive entre 12 e 16px.** Não há display, não há h1 de 30px, não
há número de 27px. O maior texto de uma tela de dado é 16px em peso 600, e ele
aparece três vezes.

Três regras que saem daí:

1. **Peso base é 500, não 400.** Isso é metade da aparência de produto pago e
   custa uma linha de CSS.
2. **Tracking negativo em tudo acima de 12px**, crescendo com o tamanho:
   −0.065px em 13, −0.112px em 14, −0.128px em 16, até −0.896px em 28.
3. **Número que varia vai em mono; número que descreve fica na sans.** A
   variação percentual ao lado de um KPI está em `ui-monospace` com tracking
   zero, enquanto o valor está na sans. A fonte diz qual dígito muda.

Face única: **Geist Variable**. Não há segunda família além da mono.

## 4. Geometria

| Raio | Ocorrências | Uso |
|---|---|---|
| **8px** | 77 | Controles — botão, pill, item de menu, input |
| 10px | 27 | Base (`--radius`), item de menu de popover |
| 14px | 5 | Card de conteúdo |
| 12px | 3 | Popover |
| 6px | 3 | Badge |

**O raio cresce com a altura do elemento na pilha.** Badge 6 → controle 8 →
base 10 → popover 12 → card 14–16 → modal 20.

**Alturas de controle:** 28px (40 ocorrências) é o padrão da barra de
ferramentas; 36px para input de formulário; 16px para checkbox.

### Não existe `border`

O contorno de cada superfície é a **última camada de um `box-shadow`
empilhado** — um anel de 1px a 5% de tinta:

```
0 1px 2px -1px  (tinta 8%)
0 1px 3px  0    (tinta 8%)
0 0 0 1px       (tinta 5%)   ← o "contorno"
```

Consequências práticas, e é por isso que vale copiar:

- Contorno e sombra sobem **juntos** quando o elemento eleva. Com `border`
  separado, um sobe e o outro fica.
- O elemento **não muda de tamanho** ao ganhar contorno no foco ou no hover —
  `box-shadow` não ocupa espaço no box model, `border` ocupa.

### Camadas de superfície

| Camada | Valor |
|---|---|
| Rebaixada (sidebar) | tinta 3% |
| Página e card | `#fdfdfd` |
| Modal e paleta | `#ffffff` |

**Branco puro é exclusivo do que flutua.** A página não é branca, então o modal
se destaca por ser literalmente mais branco — antes de qualquer sombra agir.

## 5. Componentes

### Faixa de KPI
Não é card, não é grade. É uma **faixa contínua** dividida por filete vertical
de 8%, ~70px de altura. Rótulo 14px terciário, valor **16px peso 500**,
variação em mono. Sem fundo próprio, sem canto, sem sombra.

O peso da tela não está no número — está na **frase editorial** logo acima da
faixa ("Você é #4 em visibilidade — Binance, Kraken e Ledn lideram"). É a
inversão exata do dashboard convencional.

### Tabela
Header 40px com fundo próprio (`#f6f6f6`), linha 41px, divisor sólido
(`#ebebeb`), `tabular-nums` em toda coluna numérica, número à direita.

Primeira coluna **sticky**, e a sombra lateral dela **anima** ao rolar
(keyframes `sticky-shadow-show-right` / `-left`) em vez de aparecer seca.

**Célula sem valor recebe travessão, nunca fica vazia.** Vazio parece bug e
zero seria mentira — o mesmo princípio que o NEXO já aplica com `null ≠ 0`.

### Ranking com barra
A barra **é o fundo da linha da lista**, não um gráfico ao lado. O rótulo fica
por cima. Você lê nome e proporção no mesmo movimento do olho, e a lista
continua sendo lista.

### Filtros
Fila de pills de 28px, raio 8, contorno pelo anel. Ficam logo abaixo da topbar,
nunca soltos no meio do conteúdo.

### Popover / dropdown
256px de largura, raio 12, sombra `lg`. Rótulo de seção 13px a 32%. Item de
32px com raio 10. Bloco de "selecionar tudo" separado do resto por régua.

Dois comportamentos que valem roubar:

- **Ação escondida no hover:** passar o mouse num item revela um botão
  secundário à direita ("apenas este") que isola aquele item. A ação mora na
  linha, não numa barra de ferramentas.
- **Upsell honesto:** itens bloqueados aparecem na lista, em cinza, com um chip
  ao lado — em vez de sumirem. Você vê o que não tem.

### Badge
Fórmula única: **o mesmo hex a 8% no fundo e a 100% no texto.** Altura 22px,
raio 6.

### Modal e paleta de comando
Raio 20, branco puro, sombra própria. **Dois tratamentos distintos de véu:**

| Contexto | Véu |
|---|---|
| Modal comum | tinta 20%, **sem** blur |
| Paleta de comando | cinza 24% **+ `backdrop-blur(5px)`** |

O véu **clareia**, não escurece. O produto não fica sombrio nem quando está
bloqueando você.

### Tooltip
Dois tipos, e a diferença é conceitual:

- **De valor** (no gráfico): cartão claro, rótulo à esquerda, valor à direita,
  ponto colorido da série.
- **Didático** (na coluna de métrica): fundo escuro, e lista a **escala inteira
  de 1 a 5** com a descrição de cada nível, destacando onde você está e
  apagando os outros. Ensina a métrica em vez de exigir que você a decore.

### Gráficos
A inspeção transversal de Overview, Insights, Ads, Domains, detalhe de Domain e
detalhe de Prompt mostrou um sistema único, não seis tratamentos isolados:

- tendência principal ocupa a largura da seção; comparação imediata usa gráfico
  e ranking lado a lado;
- canvas, eixos e grade permanecem neutros; cor identifica série, canal ou
  estado sem pintar a superfície inteira;
- linha fina, pontos de 2,5px, grade horizontal tracejada e referência vertical
  tracejada mantêm alta densidade sem pesar;
- tabs de métrica e D/W/M ficam no cabeçalho do próprio gráfico, em alvos de
  28px, e cada métrica recalcula sua escala;
- hover no plot acende somente o ponto consultado e uma referência vertical
  tracejada; o tooltip flutua dentro do painel, sem deslocar o gráfico;
- tooltip consolida todas as medidas daquela data, com marcadores de série,
  números tabulares e uma segunda camada para cobertura/evento quando existem;
- a métrica ativa mantém ícone + rótulo; as alternativas ficam em alvos de 28px
  somente com ícone, reduzindo ruído sem esconder a capacidade;
- séries numerosas usam legenda compacta abaixo do plot, com rótulo truncado;
- período sem amostra suficiente não inventa linha, tendência ou zero; preserva
  a estrutura e deixa o canvas vazio;
- loading usa skeleton com a geometria final do gráfico e de sua tabela ou
  ranking associado.

No NEXO, cor semântica segue a mesma parcimônia: verde só para ganho/crescimento,
vermelho para perda, cancelamento ou risco confirmado, âmbar para pendência e a
cor do marketplace para a série operacional. Dado desconhecido continua neutro.

### Tour com holofote
`box-shadow: 0 0 0 1920px` num retângulo vazio: a sombra gigante cobre a página
e o próprio retângulo vira o recorte. Um elemento, zero overlay separado, e o
furo acompanha o alvo. O véu é claro a 60%.

### Carregamento
`@keyframes shimmer` e `text-shimmer` — skeleton que espelha a estrutura final
(mesmas posições de KPI, gráfico e tabela), não um spinner centralizado.

Também existe `peec-toast-progress`: o toast traz barra de progresso própria.

## 6. Microinterações

| Item | Valor |
|---|---|
| Duração padrão | **0.15s** |
| Easing padrão | **`cubic-bezier(.4, 0, .2, 1)`** |
| Painel que desliza | 0.3s |
| Revelações lentas | 0.5s |
| Entrada/saída de overlay | `@starting-style` nativo (6 usos) |

**Não há biblioteca de animação no bundle.** Entradas e saídas usam
`@starting-style` do próprio CSS.

Comportamentos observados:

- **Hover de linha de tabela:** só o fundo muda (`#f6f6f6`). Sem borda, sem
  sombra, sem deslocamento.
- **Foco:** anel duplo (`0 0 0 1px` + `0 0 0 3px` a 8%), e existe um keyframe
  `peec-focus-ring-default` — o anel de foco é animado.
- **Ao fechar popover com `Esc`, o foco volta ao gatilho.**
- **Colapso de painel mantém a informação:** o painel de tópicos encolhe para um
  trilho estreito e **preserva as contagens**, descartando só os rótulos. O
  estado fechado continua informando.

## 7. Hierarquia visual — o que o olho pega primeiro

1. **A frase.** O título editorial de 20px é a única coisa com peso 600 e
   tamanho acima da média. Ele diz o que aconteceu.
2. **A forma dos dados.** Barra, linha do gráfico, coluna de números alinhada.
3. **Os números em si**, que são pequenos e só são lidos quando você já sabe
   onde olhar.

A interface conduz o olhar por **posição e forma**, não por tamanho e cor. É o
oposto do dashboard que usa número grande e cartão colorido para dizer "olhe
aqui" — quatro alvos competindo é o mesmo que nenhum.

## 8. Responsividade

**13 media queries em 619KB de CSS.** Breakpoints: 640, 768, 1024, 1280, 1536px
(padrão do Tailwind) mais dois próprios, 601px e 1512px.

Isso é pouquíssimo, e é uma escolha: o layout resolve quase tudo com
`flex`/`grid` que dobram sozinhos e com o deslocamento por variável CSS. A
sidebar encolhe alterando uma variável, não trocando o layout.

---

## Biblioteca transversal para o NEXO

O cruzamento abaixo é por **necessidade**, não por página equivalente. Cada
família do NEXO pode combinar padrões encontrados em áreas diferentes do PEEC.

| Necessidade do NEXO | Melhores padrões encontrados no PEEC | Adaptação necessária |
|---|---|---|
| Shell e troca de canal | shell global + seletor de projeto + navegação secundária de Settings | sidebar única 240→48, canal como contexto e grupos próprios por marketplace; sem copiar marca ou onboarding |
| Resumo de operação | frase editorial de Insights + faixa de KPI do Overview + aviso contextual de Actions | substituir grids de cards por sequência “situação → números → decisão”, mantendo `null ≠ 0` |
| Filtros globais | barra persistente de Overview/Insights/Ads | período e conta acima dos dados, pills de 28px e estado refletido na URL |
| Filtros locais | toolbars de Gap Analysis, Chats, URLs e Ads | busca, status, logística, custo e ordenação junto da tabela que controlam |
| Listagem densa | tabelas de URLs/Chats/Gap + primeira coluna sticky | header 40px, linha 41px, números alinhados, travessão e ação contextual por linha |
| Análise hierárquica | Fanouts + múltiplas tabs independentes de Ads | agrupamentos expansíveis, paginação por grupo e escopos de tab que não interferem entre si |
| Página de detalhe | detalhe de Prompt + detalhe de Domain | breadcrumb, resumo factual, visão temporal, movers, distribuição e registros relacionados na mesma narrativa |
| Drill-down | modal de Chats + modal de frases em Fanouts | modal grande com anterior/próximo e subvisões; modal compacto para expansão de uma lista curta |
| Formulário longo | Profile + Company | coluna alinhada, subtítulos curtos, grupos progressivos e ação de salvar estável |
| Criação complexa | drawer de Brands + setup progressivo de Crawl Insights | drawer para entidade; assistente em etapas para anúncio, sempre com resumo de prontidão |
| Diagnóstico | Crawlability + Crawl Insights | estado diagnosticado, explicação causal e ferramenta de teste separada por tab |
| Configurações | navegação secundária de Settings + formulários Company/Profile/Members | separar conta, canais, pessoas e segurança sem misturar com operação diária |
| Estado vazio/bloqueado | Shopping, Earned/Owned, API Keys e integrações de crawl | uma causa real, uma ação principal e nenhum zero inventado |
| Carregamento e feedback | skeleton estrutural + shimmer + progresso de toast | reutilizar `LoadingState`, fazendo o esqueleto espelhar cada família |
| Efeitos e camadas | hover de linha, foco duplo, popovers, drawer e modais | 150ms para microinteração, 300ms para painel, sem deslocar geometria; branco puro reservado a camadas flutuantes |

### O que **não** copiar

- **Cor de canal continua.** Amazon, Mercado Livre, Shopee e TikTok trazem as
  próprias cores para dentro da tela de qualquer jeito; o Peec não tem esse
  problema. A neutralidade do cromo existe justamente para hospedar as quatro.
- **Onboarding de 5 passos e paleta de comando** não são prioridade: o NEXO tem
  outro fluxo de entrada.
- **Nada de texto, logo, asset ou código deles.**

---

## 9. Mapa de telas e fluxos percorridos

Auditoria complementar feita no Chrome autenticado em **20/08/2026**, por
navegação real e sem mutação de dados. Foram evitados explicitamente os
controles que criam, enviam, agendam, exportam, descartam ou alteram
configurações. A sessão foi usada somente para abrir menus, trocar telas,
inspecionar abas e observar estados transitórios.

| Tela | Estrutura observada | Componentes e comportamento |
|---|---|---|
| Overview | topbar → filtros globais → aviso contextual → grade 2 colunas → seções de fontes e chats | gráfico + ranking dividem a primeira linha; listas usam a barra como fundo; tabelas ficam densas e sem cards aninhados |
| Insights | filtros globais → indicadores editoriais → matriz de desempenho → rankings | H1 da topbar em 14px/500; H2 de seção em 16px/600; alternância por tabs e seletores D/W/M |
| Prompts | filtros globais → painel lateral de tópicos → tabs de estado → tabela/lista de prompts | o painel de tópicos preserva contagens ao recolher; ações de criação ficam separadas dos filtros de leitura |
| Gap Analysis | filtros globais → tabs Domains/Hosts/URLs → filtros locais → lista tabular | hierarquia quase toda por alinhamento e régua; ações por linha aparecem no contexto da linha |
| Domains | filtros globais → overview → movers → tabela detalhada | tabs Top/New/Trending/Losing; seleção de série removível; seções longas mantêm a mesma coluna e densidade |
| Ranking | shell e filtros globais permanecem enquanto o corpo troca de estado | primeiro paint preserva o shell; o conteúdo entra sem deslocar topbar/sidebar |
| Chats | filtros globais → resumo → filtros locais → tabela longa paginada | linhas de duas camadas em ~64px mantêm pergunta e resposta escaneáveis; colunas factuais ficam estreitas, valores longos truncam sem alterar a altura e o detalhe abre sem perder o contexto da fila |
| Shopping / Overview | coluna de trabalho estreita dentro do canvas largo | estado vazio/onboarding com 454px de largura; um CTA por vez e alternativas progressivas, sem preencher o resto da tela com cards fictícios |

### Shell em movimento

O botão de recolher troca a reserva lateral de **240px para 48px**. Na medição,
o `main` mudou de `x: 240` para `x: 48`; o conteúdo ocupou a largura liberada sem
ganhar `max-width` e sem remontar as seções. A transição dura ~300ms e preserva
o ícone/estado ativo quando o rótulo some.

### Dropdowns e popovers medidos

| Controle | Caixa renderizada | Conteúdo/organização |
|---|---|---|
| Período | 401×372px, raio 12px | presets à esquerda + calendário; o intervalo e a duração ficam explícitos |
| Tags | 237×217px, raio 12px | modo lógico Or/And antes da lista |
| Modelos | 256×425px, raio 12px | ativos primeiro; disponíveis/bloqueados depois; upsell aparece sem esconder opções |
| Tópicos | 256×213px, raio 12px | contagem por item e ação contextual “apenas este” no próprio item |
| Configurar colunas | 288×366px, raio 12px | colunas fixas, ativas e disponíveis em blocos; reset separado no rodapé |

Todos usam a mesma sombra empilhada e superfície `#fdfdfd`; `Esc` fecha e
devolve o foco ao gatilho. Nenhum popover desloca o layout.

### Hover, foco e transições

- Item de navegação: alvo de 28px, sem deslocamento nem escala; somente fundo e
  tinta transitam em 150ms.
- Linha de tabela/lista: muda apenas o fundo. Não ganha sombra, borda ou
  translação.
- Controles flutuantes: abrem sobre o canvas e não alteram medidas dos elementos
  vizinhos.
- O foco visível usa anel duplo e `Esc` fecha a camada ativa sem perder o ponto
  de navegação.

### Estados vazios, carregamento e modais

- **Vazio/onboarding:** coluna estreita, mensagem direta e progressão em uma
  decisão por vez; o espaço restante fica vazio de propósito.
- **Carregamento:** o shell e filtros permanecem estáveis; skeletons ocupam as
  caixas finais em vez de um spinner central interromper a orientação.
- **Popover:** sem véu, para escolhas locais e reversíveis.
- **Modal bloqueante:** superfície branca, raio 20px e véu claro; a paleta de
  comando acrescenta blur, enquanto modal comum não.

### Evidência de captura

As capturas brutas desta passagem ficaram fora do repositório, em
`G:/sc-temp/peec-audit/`, para não versionar dados visíveis da conta de
referência. O Chrome externo reportou viewport efetivo de **1920×863** nesta
janela; o ciclo de fidelidade do NEXO deve usar o mesmo canvas para a comparação
direta e registrar separadamente a verificação pedida em 1440×900 e mobile.

### Checklist de cobertura — PEEC

`Parcial` significa que a superfície acessível foi inspecionada, mas o estado
indicado exigiria criar dados, executar uma análise, trocar de plano ou possuir
outra conta/projeto. A lacuna não foi preenchida por suposição.

| Área/rota | Estados e fluxos observados | Cobertura / lacuna real |
|---|---|---|
| Shell global | grupos da navegação, recolhimento 240→48, seletor de projeto, busca, perfil, foco e `Esc` | coberto; só havia um projeto disponível, portanto sem variação real entre projetos |
| Overview `/` | filtros globais, KPIs, gráfico, rankings, fontes, chats, carregamento estável | coberto |
| Insights `/insights` | indicadores editoriais, tabs de métrica, D/W/M, escala por métrica, crosshair e tooltip contextual | coberto; Visibility/Sentiment e D/W foram alternados sem mutação |
| Perception `/brand-perception` | formulário, mercado, mapa e expansão em drawer/tela cheia | parcial: resultado pós-execução não foi aberto para não iniciar análise |
| Prompts `/prompts` | lista, tópicos recolhíveis, tabs, filtros e paginação | coberto |
| Prompt `/prompts/:id` | resumo factual, gráfico, ranking, Domains/URLs, movers, fanouts e chats | coberto; configurações do prompt não foram alteradas |
| Gap Analysis `/sources/gaps` | Domains/Hosts/URLs, filtros locais, tabela e navegação por fonte | coberto |
| Domains `/sources/domains` | overview, movers, Top/New/Trending/Losing, séries e tabela | coberto |
| Domain `/sources/domains/:id` | URLs/Chats, D/W/M, movers, distribuição e registros relacionados | coberto |
| URLs `/sources/urls` | tabela densa, classificação e ações por linha, paginação | coberto em leitura; bookmark e classificação não foram acionados por serem mutáveis |
| Earned `/actions/earned` | loading e bloqueio por competidores insuficientes | parcial: lista preenchida indisponível nesta conta |
| Owned `/actions/owned` | loading analítico e bloqueio por competidores insuficientes | parcial: lista preenchida indisponível nesta conta |
| Impact `/actions/impact` | tabs Todo/History e dois vazios distintos | coberto; sem ações concluídas para preencher o histórico |
| Ranking `/ranking` | tabela, troca de contexto de marca por linha e carregamento | coberto |
| Chats `/chats` | tabela longa, filtros, colunas, paginação e modal de conversa | coberto; modal inclui anterior/próximo e subvisão Sources; fanouts estava desabilitado no chat observado |
| Fanouts `/query-fanouts` | lista hierárquica, múltiplos grupos abertos, paginação interna e modal de frases | coberto |
| Ads `/ads` | KPIs, tendência, share, mercado, branded bidding e três conjuntos independentes de tabs | coberto; exports não foram acionados |
| Crawl Insights `/agent-analytics/crawl-insights/overview` | setup inline, integrações, filtros, KPIs e lista de URLs; Vercel expandido/recolhido | coberto em leitura; teste de chave e deploy não foram executados |
| Crawlability `/agent-analytics/crawlability` | diagnóstico, tabs Crawlability/URL Tester, vazio do tester | parcial: não havia `robots.txt` nem histórico; reload e teste não foram executados |
| Shopping `/shopping/overview` | onboarding/estado vazio em coluna estreita | parcial: resultados posteriores à configuração não existiam |
| Settings `/company`, `/profile` | formulários, preferências, toggles, perfil longo e mapa | coberto em leitura; nada salvo |
| Brands `/brands` | busca, lista e drawer de criação de entidade | coberto em leitura; drawer cancelado sem criar |
| Tags `/tags` | corpo vazio sob a navegação secundária | coberto como estado vazio observado; nenhum controle disponível |
| Projects `/projects` | uso, busca, lista, criação e ações por linha | coberto em leitura; havia apenas um projeto |
| API Keys `/api-keys` | API bloqueada por plano e seção de token pessoal | coberto em leitura; nenhum segredo foi criado |
| Members `/members` | loading, tabela, export, convite e modal de permissões | coberto em leitura; convite cancelado |
| Billing `/billing` | plano, ciclo, add-on, pagamento e invoices | coberto em leitura; nenhuma ação financeira executada |

### Checklist de cobertura — NEXO

O código é a fonte de verdade para regras, estados e ações; o Chrome confirmou
a composição renderizada. Rotas que só reexportam outra página são registradas
como aliases, não como telas independentes fictícias.

| Área/rotas | Funcionalidades confirmadas | Cobertura / lacuna real |
|---|---|---|
| Shell autenticado | seletor de canal, grupos recolhíveis, subnav de Histórico, busca, integrações, briefing, conta/logout e sidebar 240→48 | coberto em código e desktop; mobile entra na validação visual pós-síntese |
| `/` | consolidação multicanal, série diária, cobertura e status por canal, primeira conexão | coberto; estado carregando e lógica vazia confirmados |
| `/amazon` | período, pendências, resumo financeiro, saldo, vendas, estoque, rentabilidade e produtos | coberto; corpo atual continua provisório até a síntese |
| `/briefing`, `/amazon/briefing` | alertas com evidência, impacto, destino, adiar, dispensar e resolver | coberto; ações mutáveis preservadas no código e não acionadas durante auditoria |
| `/monitor`, `/amazon/monitor` | período/customizado, fluxo financeiro, transações, rentabilidade, filtros, paginação e expansão por pedido | coberto; expansão local inspecionada |
| `/desempenho`, `/amazon/desempenho` | período, KPIs de tráfego, busca, ordenação, tabela e falta de permissão/dado | coberto |
| `/estoque`, `/amazon/estoque` | período, resumo por risco, busca, status, ordenação e tabela operacional | coberto |
| `/produtos`, `/amazon/produtos` | adicionar ASIN, busca, custo, ordenação, paginação, edição e remoção | coberto; ações de escrita não foram executadas |
| `/amazon/catalogo` | KPIs, busca, status, logística, sort, paginação e link externo | coberto |
| `/pesquisa`, `/amazon/pesquisa` | consulta, FBA, sort, carregar mais, monitoramento e vazios de busca | coberto em estado inicial e código; pesquisa não foi disparada |
| `/pesquisa/historico`, `/amazon/pesquisa/historico` | termos, busca, ordenação, seleção em lote, fixar/remover, curva e paginação | coberto; ações mutáveis não foram acionadas |
| `/amazon/abc` | período, Pareto, quadrantes, filtro local, tabela e custo ausente | coberto pelo `AbcView` compartilhado e validado com dados no ML |
| `/calculadora`, `/amazon/calculadora` | consulta por ASIN, preço, custo, FBA/FBM/DBA e alíquota | coberto; salvar e consulta externa não executados |
| `/amazon/anuncios` | modos existente/novo, stepper, categoria, conteúdo, oferta, variações, prontidão, preview, validação e publicação | coberto em código e nos dois estados iniciais; chamadas e publicação não executadas |
| `/mercado-livre` | dashboard, parcialidade, fluxo financeiro, estoque, pedidos, repasses e produtos | coberto com estado carregando e estado preenchido |
| `/mercado-livre/monitor` | período, composição financeira, notas de cobertura e rentabilidade por pedido | coberto com dados |
| `/mercado-livre/estoque` | KPIs, explicação do cálculo, busca, filtros, ordenação e tabela | coberto com dados |
| `/mercado-livre/produtos` | alíquota, cobertura, busca e custo inline | coberto; gravações não executadas |
| `/mercado-livre/anuncios` | KPIs, busca, status, modalidade, logística, sort e paginação | coberto com dados |
| `/mercado-livre/abc` | período, Pareto, quadrantes, tooltip, filtro e tabela | coberto; filtro de quadrante validado localmente |
| `/mercado-livre/calculadora` | lookup por URL/ID, custos, tarifa, imposto, publicidade, frete, preço e margem | coberto; consulta não executada |
| `/mercado-livre/auditoria` | período, cobertura parcial, totais e divergências de frete | coberto com dados e linguagem de incerteza preservada |
| `/mercado-livre/vendas` | redirect permanente para `/mercado-livre/monitor` | coberto |
| `/shopee` + módulos | conexão, dashboard, monitor, catálogo, estoque, custos e ABC | estado sem conexão validado em todas as rotas com orientação compartilhada; preenchidos permanecem mapeados no código |
| `/tiktok` + módulos | conexão, dashboard, monitor, financeiro, catálogo, estoque, custos e ABC | dashboard preenchido validado com a loja Crystal Fancy; módulos preenchidos, filtros, tabelas, paginação e salvamento confirmados no código e seguem na passagem visual por rota |
| `/integracoes` | estado por provedor, conexões, OAuth, reconexão e desconexão | coberto em leitura; nenhuma conexão foi criada ou removida |
| Estados globais | loading estrutural, vazios de dado/busca/permissão/sucesso, erro/retry e trial | coberto no código e em ocorrências reais; sucesso de escrita não foi provocado |

Lacuna de nomenclatura encontrada durante o inventário: textos visíveis ainda
contêm “SellerCore” no assistente de anúncios, integrações e estados de conexão.
Devem virar **NEXO** quando essas famílias forem adaptadas, sem renomear URLs,
contas, tabelas, arquivos ou identificadores legados.

### Síntese de arquitetura do NEXO

| Família | Estrutura própria sintetizada | Componentes existentes a preservar/reusar |
|---|---|---|
| Shell | canal → grupos de tarefa → rota; topbar contextual; canvas fluido; filtros abaixo da topbar | `AppShell`, `SidebarNexo`, `NavLinks`, `ShellTopbar`, `AccountSwitcher` |
| Dashboards | situação editorial → pendências → faixa financeira → tendência/composição → listas de atenção | `PageHeader`, `DashboardPeriodFilter`, `Metric`, `RevenueChart`, `OperationPending`, `OrderProfitabilityTable` |
| Listagens | título → toolbar local → resumo curto → tabela densa → paginação; edição fica na linha | `PageHeader`, `SortButton`, `Pagination`, `EmptyState`, `LoadingState` |
| Análises | pergunta/diagnóstico → métricas → gráfico → segmentos/tabs → registros que explicam o resultado | `AbcView`, `RevenueChart`, `Metric`, `OrderProfitabilityTable` |
| Detalhes e drill-down | breadcrumb → fatos principais → série/distribuição → registros relacionados; modal só quando mantém contexto da lista | ainda não há base única; extrair somente quando uma rota real exigir |
| Ferramentas de decisão | entradas à esquerda/acima → cálculo explicável → comparação → recomendação; sem grade decorativa | calculadoras Amazon/ML e seus modelos atuais |
| Fluxos assistidos | escolha inicial → stepper → formulário progressivo → prontidão persistente → validação → ação irreversível | assistente de `/amazon/anuncios`; não transformar em dashboard |
| Configurações/integrações | navegação por assunto → estado atual → formulário/ação; OAuth e ações destrutivas separados | `/integracoes`, modelos de provider e componentes de conexão |

Filtros globais são período, canal/conta e atualização. Busca, status,
logística, custo, ordenação e seleção são locais à seção que controlam. Tabs
podem coexistir na mesma página quando têm escopos independentes. As famílias
são implementadas em sequência contínua, escolhendo para cada finalidade o
padrão transversal adequado e preservando suas particularidades funcionais.

---

## 10. Matriz única de progresso

Esta é a única matriz operacional desta frente. Ela é atualizada no lugar a
cada ciclo; herdar o shell não significa que o corpo de uma rota foi adaptado.

| Rota | Família | Funcionalidades preservadas | Padrão aplicado | Status | Pendências reais |
|---|---|---|---|---|---|
| Todas as rotas autenticadas | Shell | troca de canal/conta, navegação agrupada, busca, integrações, briefing e logout | sidebar única 240→48 com reflow persistido, topbar de 48px, canvas fluido, alvo de nav de 28px e caret sólido 14px à esquerda | validada no navegador | geometria, sanfona, estado ativo e reflow validados no Chrome; falta repetir a captura em mobile real |
| `/` | Dashboard multicanal | receita, lucro parcial, margem, pedidos, cobertura, série diária e status por canal | faixa consolidada contínua → comparação tabular prioritária por canal com barras proporcionais e ação contextual → gráfico diário explorável por canal; cores identificam canal e vermelho/verde preservam a semântica financeira | validada no navegador | cinco indicadores compactos, quatro canais comparáveis na primeira dobra, estados ativo/conectar, links e filtro Todos/Amazon do gráfico validados no Chrome; valores ausentes continuam explícitos e fora do consolidado |
| `/amazon` | Dashboard de canal | período, pendências, resumo financeiro, conciliação, vendas, estoque, rentabilidade e produtos | anatomia transversal + painel canônico compartilhado `Resumo financeiro → composição → faturamento → custos → resultado → margem`; gráfico com métrica ativa, crosshair, tooltip e variação semântica | validada no navegador | composição completa, lucro/margem semânticos, desktop 1440×900 e mobile sem overflow confirmados no Chrome |
| `/mercado-livre` | Dashboard de canal | faturamento, cancelamentos, lucro/cobertura, pedidos, estoque, custos, série diária, saldo, pedidos recentes e top produtos | mesma anatomia interna da Amazon via `FinancialSummaryPanel`; receita parcial abre composição com saldo pendente neutro, seguida da mesma cascata e margem | validada no navegador | composição pendente de R$ 107,34, disclosure dos custos, resultado/margem neutros e mobile sem overflow confirmados; imposto ausente continuou `null` |
| `/shopee` | Dashboard de canal | conexão, sincronização, faturamento/pedidos, escrow, custos e estados reais de ausência de dados | mesma anatomia interna da Amazon via `FinancialSummaryPanel`: composição, faturamento, custos expansíveis, resultado e margem; estados de erro/loading/conexão continuam no `IntegrationDashboardFrame` | implementada | ausência de conexão e orientação OAuth validadas sem escrita; o corpo preenchido segue sem validação visual porque não há loja real conectada |
| `/tiktok` | Dashboard de canal | conexão, período, visão financeira, status dos pedidos, backlog e estados reais de ausência de dados | mesma anatomia interna da Amazon via `FinancialSummaryPanel`; faturamento capturado e composição pendente ficam explícitos antes da cascata custo/resultado/margem | validada no navegador | Crystal Fancy desktop/mobile, donut parcial, disclosure dos sete componentes, resultado/margem neutros e ausência de overflow confirmados; nenhuma lacuna foi convertida em zero |
| `/briefing`, `/amazon/briefing` | Análise acionável | alertas priorizados, evidência, impacto, estado “sob controle”, analisar novamente, adiar, dispensar, resolver e próximo passo | resumo contínuo → contagens por severidade → tabs locais → tabela de duas camadas inspirada na densidade do Chats → evidência e impacto em colunas → detalhe inline com ações; disclosure progressivo 12 por vez | validada no navegador | 12 linhas a 68px, truncamento, filtro, cabeçalho e expansão inline a 88px validados no Chrome sem executar mutações; mobile coberto por CSS e ainda requer captura real |
| `/monitor`, `/amazon/monitor` | Análise financeira | período/customizado, pedidos, resumo financeiro personalizável, composição, taxas expansíveis, transações e rentabilidade por pedido | filtro global → faixa financeira contínua → tabs Composição/Transações/Rentabilidade → detalhe contextual; resultado parcial permanece neutro | validada no navegador | cinco KPIs, margem desconhecida, drill-down de 9 taxas, quatro resumos, 12 transações e 30 vendas confirmados; console local sem erros/avisos e mobile ainda requer captura real |
| `/mercado-livre/monitor` | Análise financeira | monitor de vendas, conciliação, cobertura, fretes, impostos e rentabilidade por pedido | filtro global → faixa financeira contínua → tabs Composição/Rentabilidade → cascata explicável ou registros por venda; resultado incompleto permanece neutro | validada no navegador | cinco KPIs, canceladas em vermelho, margem desconhecida, composição e 1.000 vendas com 791 cálculos completos validados no Chrome |
| `/shopee/monitor` | Análise financeira | pedidos, valores e cobertura sincronizada da Shopee | estado de conexão compartilhado com contexto próprio da rota | validada no navegador | ausência de conexão e retorno para integrações validados; preenchido depende de loja real |
| `/tiktok/monitor`, `/tiktok/financeiro` | Análise financeira | pedidos, monitor, filtros, ledger final, paginação e cobertura dos extratos | estrutura compartilhada por módulo → resumo contínuo → filtros locais → cobertura explícita → tabela densa ou vazio honesto | validada no navegador | Crystal Fancy validada com 3.498 pedidos no monitor e financeiro parcial sem transações finais; nenhum valor ausente virou zero e o console permaneceu limpo |
| `/desempenho`, `/amazon/desempenho` | Análise de desempenho | visualizações, conversão, Buy Box, busca, ordenação e permissões ausentes | resumo contínuo → ranking proporcional com tabs Sessões/Conversão/Receita/Buy Box → filtros locais → tabela densa; indisponibilidade usa `—`, nunca zeros fictícios | validada no navegador | estado real de permissão ausente, retry, reconexão, KPIs desconhecidos e tabela vazia validados no Chrome; ranking preenchido aguarda permissão Brand Analytics para validação visual com dados |
| `/amazon/abc`, `/mercado-livre/abc` | Análise ABC | classes A/B/C, contribuição, giro, custos ausentes, quadrantes, Pareto e tabela | faixa de período → tese editorial → cobertura → quadrantes contínuos filtráveis → Pareto → tabela explicativa | validada no navegador | Amazon validada com 43 produtos, 40 sem custo, quatro quadrantes e filtro Baixa margem (2 linhas); ML usa o mesmo componente e contrato |
| `/shopee/abc` | Análise ABC | classes A/B/C por receita e estado de conexão | módulo compartilhado por canal + estado inicial orientado | validada no navegador | ausência de loja conectada preservada e validada; estado preenchido continua uma lacuna externa real |
| `/tiktok/abc` | Análise ABC | classe, receita, participação acumulada, lucro indisponível por SKU e paginação | resumo contínuo → aviso de contrato → concentração visual dos top produtos → distribuição A/B/C com barras semânticas → tabela de detalhe | validada no navegador | Crystal Fancy validada com 20 produtos, top 3 em 56,6% da receita e classes A/B/C; visual usa somente receita/participação reais e mantém lucro como “—” |
| `/mercado-livre/auditoria` | Análise de divergências | comparação de fretes, período, cópia para contestação, cobertura parcial e linguagem de incerteza | filtro local → faixa de cobertura → aviso parcial → comparação proporcional previsto/cobrado → tabela de drill-down → método | validada no navegador | 419 pedidos comparados, 81 sem referência, quatro divergências favoráveis e total contestável zero validados no Chrome; cópia não foi acionada porque não havia valor positivo a contestar |
| `/amazon/catalogo` | Listagem de anúncios | busca, status, logística, ordenação, paginação, preço, estoque e entrada para criação | faixa de quatro indicadores → toolbar local → tabela densa com produto em duas linhas → ação externa contextual → paginação; criação voltou a ser descoberta pelo cabeçalho | validada no navegador | 108 anúncios, filtros, 30 linhas, status, logística e navegação para Criar anúncio validados no Chrome sem abrir links externos |
| `/mercado-livre/anuncios` | Listagem de anúncios | busca, status, tipo, logística, ordenação, paginação e estoque | mesma anatomia de catálogo, preservando modalidade, vendidos, cobertura do lote e logística próprias do ML | validada no navegador | 387 anúncios, quatro filtros, 30 linhas por página, estado e hierarquia validados no Chrome |
| `/produtos`, `/amazon/produtos` | Listagem editável | busca, filtro de custo, ordenação, paginação, cadastro/remoção e salvamento de custo | cobertura contínua → cadastro por ASIN em disclosure → filtros → tabela densa com editor de custo inline e feedback local | validada no navegador | 108 produtos, filtro Sem custo (105), foco no cadastro, 30 linhas e estados de custo validados sem salvar nem remover |
| `/mercado-livre/produtos` | Listagem editável | busca, cobertura de custo, alíquota e edição inline | configuração fiscal compacta → cobertura contínua → busca/filtro → tabela editável paginada | validada no navegador | 387 produtos, cobertura 18/369, alíquota, 30 linhas e custos pendentes validados sem executar gravações |
| `/shopee/produtos` | Listagem editável | custos por produto, cobertura e estados de sincronização | módulo compartilhado por canal + estado inicial orientado | validada no navegador | ausência de conexão validada; estado preenchido depende de loja real |
| `/tiktok/produtos` | Listagem editável | busca, cobertura de custos e editor inline isolado por loja/SKU | resumo contínuo → busca local → tabela densa com custo editável e feedback local | validada no navegador | Crystal Fancy validada com 100 produtos e 50 sem custo nesta página; nenhuma gravação foi executada |
| `/estoque`, `/amazon/estoque` | Listagem operacional | busca, status, velocidade, dias restantes, alertas e estados vazios | período → faixa semântica de risco → filtros locais → tabela operacional paginada → método | validada no navegador | loading estrutural e ausência honesta validados; o estado preenchido continua pendente porque `/api/radar` não assentou nesta conta |
| `/mercado-livre/estoque` | Listagem operacional | estoque, giro, ruptura e estados de cobertura do ML | período → faixa semântica → método compacto → filtros → tabela por urgência paginada | validada no navegador | 372 produtos, 301 ações imediatas, filtros, 30 linhas e paginação validados no Chrome |
| `/shopee/estoque` | Listagem operacional | estoque, giro, ruptura e estado de cobertura | módulo compartilhado por canal + estado inicial orientado | validada no navegador | ausência de conexão validada; estado preenchido depende de loja real |
| `/tiktok/estoque` | Listagem operacional | estoque, giro, ruptura, busca, situação e período | período → resumo semântico → filtros locais → tabela por produto; ausência de base permanece textual | validada no navegador | Crystal Fancy validada com 100 produtos, 16 sem estoque e 34 sem base de venda; console limpo |
| `/shopee/catalogo` | Listagem de anúncios | catálogo, filtros e estado de sincronização | módulo compartilhado por canal + estado inicial orientado | validada no navegador | ausência de conexão validada; estado preenchido depende de loja real |
| `/tiktok/catalogo` | Listagem de anúncios | catálogo, busca, status, preço, disponibilidade e atualização | resumo contínuo → busca/status → tabela densa somente leitura | validada no navegador | Crystal Fancy validada com 100 anúncios, 11 ativos e preço conhecido em 50/50 linhas carregadas; console limpo |
| `/pesquisa`, `/amazon/pesquisa` | Pesquisa e decisão | consulta, filtro FBA, ordenação, paginação, métricas competitivas e estados vazios | pergunta compacta → explicação em disclosure → filtros contextuais → tabela densa com estado vazio honesto e paginação progressiva | validada no navegador | estado inicial, entrada, ação, disclosure, cabeçalho e vazio orientado foram validados no Chrome; consulta externa não foi disparada nesta passagem |
| `/pesquisa/historico`, `/amazon/pesquisa/historico` | Histórico e drill-down | snapshots, variação de ranking, curvas, filtros, seleção, fixar/remover e explicações | termos recentes → busca e ordenação local → tabela temporal densa com variação semântica, minicurvas, ação contextual e paginação | validada no navegador | 357 anúncios, três ordenações, tendências verde/vermelha, minicurvas, truncamento e paginação validados no Chrome; ações mutáveis não foram executadas |
| `/amazon/anuncios` | Fluxo assistido | anúncio existente/novo, categoria, oferta, conteúdo, variações, prontidão, preview, validação e publicação | escolha compacta do fluxo → stepper persistente → formulário progressivo → prontidão lateral → pré-validação → publicação condicionada | validada no navegador | dois modos, stepper de três/quatro etapas, erro local ao avançar sem confirmação, troca de modo e prontidão validados no Chrome; nenhuma consulta, validação remota ou publicação foi executada |
| `/calculadora`, `/amazon/calculadora` | Ferramenta de decisão | consulta por ASIN, preço, custo, imposto e comparação FBA/FBM/DBA | entrada compacta → configuração fiscal contextual → três cenários explicáveis somente após cálculo | validada no navegador | composição inicial, foco, campos, imposto desconhecido e erro real de consulta externa validados no Chrome; resultado preenchido aguarda a Price/Fees API responder nesta conta |
| `/mercado-livre/calculadora` | Ferramenta de decisão | consulta de anúncio, tarifas, frete, imposto, ads, outros custos, margem-alvo e comparação Clássico/Premium | painel de entradas à esquerda → resultado/recomendação à direita → breakdown progressivo | validada no navegador | dez entradas, imposto configurado, placeholder explicativo e responsividade estrutural validados no Chrome sem disparar consulta externa |
| `/integracoes` | Configurações | conectar/reconectar/desconectar canais, status, contas, capacidades e explicação do modelo multicanal | navegação por assunto → resumo contínuo → lista comparável de provedores com estado/conta/cobertura/ação → explicação compacta do modelo comum | validada no navegador | duas contas e quatro provedores validados no Chrome; estados conectado/disponível e ações OAuth preservados, sem conectar ou desconectar contas |
| `/configuracoes` | Configurações | identidade autenticada, nome de exibição, datas da conta, plano/trial real, estado de pagamento, preferência de navegação, custos, integrações, privacidade e encerramento de sessão | navegação local por assunto → perfil → plano e pagamento → preferências → operação → dados e sessão; estado ausente fica explícito e não simula cobrança | validada no navegador | página unificada, âncoras, ausência real de cobrança, sidebar sem item redundante, imagens e overflow validados no Chrome; nenhuma ação financeira foi criada porque o produto ainda não possui backend de assinatura |
| `/perfil` | Compatibilidade | acesso antigo ao perfil sem manter uma segunda tela redundante | redirecionamento para `/configuracoes#perfil` | validada no navegador | destino final e ausência do item duplicado na sidebar confirmados no Chrome |
| `/landing` | Entrada pública | proposta de valor, canais, benefícios, demonstração financeira e entradas para autenticação | hero/grid/navegação e primeira dobra inspirados na Dub + vitrine composta por `Metric`, `AnimatedNumber`, `RevenueChart`, `CompositionDonut`, ícones e estados reais do sistema NEXO | validada no navegador | amostra local identificada, troca automática/manual 15/30 dias, três abas, métricas animadas, gráfico explorável e donut validados no Chrome; comparação desktop lado a lado com Dub e viewport móvel 390×844 sem overflow de documento concluídos |
| `/login` | Autenticação | login, criação de conta, validação, erro, retorno e acesso à política de privacidade | contexto de segurança → garantias do workspace → formulário compacto com tabs locais; símbolo oficial lidera a assinatura e o nome fica secundário | validada no navegador | desktop e mobile 390×844 sem overflow ou sobreposição; troca Entrar/Criar conta confirmada sem enviar credenciais |
| `/privacidade` | Conteúdo legal | política, âncoras por assunto e navegação de retorno | rota pública autônoma → cabeçalho compacto → índice lateral/sticky que vira trilho horizontal no mobile → texto legal de medida curta | validada no navegador | shell autenticado removido; conteúdo jurídico preservado e desktop/mobile validados sem erro de página |
| `/mercado-livre/vendas` | Compatibilidade | redirecionamento permanente para o monitor | redirecionamento preservado | validada no navegador | navegação terminou em `/mercado-livre/monitor` sem erro e sem criar tela duplicada |

As rotas de entrada e legais agora fazem parte do redesign completo. `/lab/*`
continua classificado como laboratório interno, não como superfície de produto;
serve para testar shell/identidade e não deve ganhar uma experiência paralela.

## 11. Pendências de execução e validação

Esta é a fila restante, na ordem de retomada. Itens já validados acima não devem
ser reabertos sem uma dúvida concreta.

- [x] Validar no Chrome a correção recém-aplicada na faixa de período: altura
  mínima de 52px, botões de 32px e sombra/raio sem recorte em `/amazon`,
  `/mercado-livre`, `/amazon/monitor` e `/mercado-livre/monitor`.
- [x] Concluir a estrutura compartilhada Shopee/TikTok e o estado inicial
  orientado para dashboard, monitor, financeiro, catálogo, produtos e estoque.
- [x] Concluir a validação preenchida dos módulos TikTok no Chrome. A loja
  Crystal Fancy permite validar essas rotas; Shopee preenchida permanece lacuna
  explícita porque não há loja conectada.
- [x] Revisar e redesenhar `/landing`, `/login` e `/privacidade`, preservando
  autenticação, redirects, segurança e conteúdo legal.
- [ ] Revalidar os estados preenchidos hoje bloqueados por dependência externa:
  estoque Amazon (`/api/radar`), Brand Analytics em `/desempenho` e resultado da
  Price/Fees API na calculadora Amazon. Não substituir ausência por zero ou mock.
- [ ] Executar a passagem final por rota no Chrome: visual, interação, console,
  loading, vazio, erro, sucesso e preservação funcional; atualizar esta matriz no
  lugar após cada validação.
- [ ] Repetir a validação em 1440×900 e em viewport mobile. Corrigir overflow,
  truncamento, ordem de conteúdo, áreas de toque e disclosures antes de marcar
  cada rota como `validada no navegador`.
- [ ] Rodar a verificação final de qualidade: ESLint somente nos arquivos tocados,
  `tsc --noEmit` e testes relevantes. O lint global continua contaminado por
  diretórios `.next-broken-*`; não confundir esse ruído com regressão do produto.

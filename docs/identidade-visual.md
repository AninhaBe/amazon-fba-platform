# Identidade visual e sistema de interface do NEXO

**Documento canônico de continuidade do front-end — atualizado em 22/08/2026.**

Este guia descreve a identidade visual que já está implementada. Ele existe para
que outra pessoa ou outro modelo consiga continuar o front sem recomeçar a
direção de arte, criar um segundo design system ou reduzir o trabalho a “deixar
as cores parecidas”.

O PEEC foi referência de arquitetura da informação, densidade, hierarquia e
interação. A landing usa a composição pública da Dub como referência estrutural.
Nenhum texto, marca, conteúdo ou asset proprietário dessas referências pertence
ao NEXO.

## 1. Leia isto antes de mudar uma tela

1. O produto visível se chama **NEXO**. “SellerCore” só permanece em
   identificadores técnicos existentes que não podem ser renomeados por impulso.
2. A interface é neutra; **cor só entra quando comunica canal, estado ou
   significado financeiro**.
3. Amazon, Mercado Livre, Shopee e TikTok Shop usam a **mesma anatomia de
   produto**. O canal troca dados, logo e acento — não troca o layout-base.
4. `null` não é zero. Dado ausente, parcial ou ainda não conciliado precisa ser
   mostrado como tal.
5. Antes de criar um componente, procure um equivalente compartilhado em
   `src/app/components/`.
6. Não crie um grid de cards por padrão. Primeiro agrupe a informação pela
   tarefa e pela decisão que a pessoa precisa tomar.
7. Uma rota não está redesenhada se o corpo antigo apenas foi colocado dentro do
   shell novo.

## 2. Fontes de verdade

Em caso de divergência, siga esta ordem:

| Prioridade | Fonte | Responsabilidade |
|---|---|---|
| 1 | `src/app/globals.css` (`:root`) | tokens globais, shell, densidade e padrões compartilhados |
| 2 | componentes reutilizáveis em `src/app/components/` | anatomia e comportamento aprovados |
| 3 | este documento | intenção, regras de composição e limites da identidade |
| 4 | `docs/peec-ui-audit.md` | evidências da referência e matriz de validação por rota |
| 5 | `docs/peec-padroes.md` e `docs/peec-video-frame-map.md` | catálogo detalhado de padrões observados no PEEC |
| 6 | `docs/landing-nexo.md` | narrativa e efeitos específicos da landing |

Arquivos centrais:

| Tema | Arquivo/componente |
|---|---|
| fonte, metadata e favicon | `src/app/layout.tsx` |
| símbolo oficial | `public/nexo-symbol.svg` e `NexoSymbol.tsx` |
| assinatura NEXO | `NexoWordmark.tsx` |
| shell autenticado | `AppShell.tsx`, `SidebarNexo.tsx`, `ShellTopbar.tsx` |
| navegação e sanfonas | `Nav.tsx` |
| cabeçalho de página | `PageHeader.tsx` |
| troca e logos de canal | `MarketplaceIcon.tsx`, `ChannelSwitcher.tsx` |
| métricas | `Metric.tsx`, `CustomizableMetricGrid.tsx` |
| período | `DashboardPeriodFilter.tsx` |
| gráfico diário | `RevenueChart.tsx` |
| composição financeira | `FinancialSummaryPanel.tsx`, `CompositionDonut.tsx` |
| ranking | `TopProductsRanking.tsx` |
| tabelas e paginação | `OrderProfitabilityTable.tsx`, `Pagination.tsx`, `SortButton.tsx` |
| estados | `EmptyState.tsx`, `LoadingState.tsx`, `ConnectionBroken.tsx` |
| login | `src/app/login/page.tsx`, `LoginForm.tsx` |

## 3. Personalidade visual

O NEXO deve parecer:

- preciso, calmo e operacional;
- denso sem ficar apertado;
- inteligente sem estética genérica de “produto de IA”;
- financeiro sem parecer um internet banking;
- multicanal sem virar um arco-íris;
- honesto sobre lacunas de dados.

A hierarquia vem de proporção, alinhamento, agrupamento, tipografia e densidade.
Cor é a última camada, não a primeira.

### O que não pertence à identidade

- gradientes decorativos no produto autenticado;
- azul genérico de SaaS em botões e links;
- títulos de 30–40 px dentro de telas de dados;
- ícones grandes em chips coloridos repetindo o canal;
- bordas pesadas ao redor de todo bloco;
- cartões soltos para cada número;
- sombras coloridas, glow ou glassmorphism;
- pílulas em tudo;
- uma aparência diferente para cada integração;
- cores que não carregam significado;
- zeros inventados para preencher ausência de dados.

## 4. Marca e iconografia

### Símbolo oficial

O símbolo do NEXO é a seta preta de `public/nexo-symbol.svg`. Ela representa
direção, conexão e passagem de dados para decisão.

Regras:

- use sempre `<NexoSymbol />`; não copie o SVG para dentro de páginas;
- o mesmo arquivo é favicon, marca do shell e elemento narrativo;
- não volte ao antigo “a” da Amazon nem a qualquer logo antigo;
- não aplique gradiente, glow ou uma cor de marketplace no símbolo;
- respeite o contorno branco interno do SVG, criado para preservar leitura em
  fundos diferentes;
- ajuste símbolos assimétricos opticamente, não apenas geometricamente.

### Assinatura

`<NexoWordmark />` combina a seta com “NEXO”. A animação de assentamento das
letras é uma assinatura de entrada pública; não deve tocar em todo carregamento
de painel ou disputar atenção com dados.

O favicon é definido globalmente em `src/app/layout.tsx`. Uma rota nova não deve
declarar outro favicon. Se a aba não exibir a seta, corrija a metadata/caching —
não adicione um ícone alternativo.

### Marketplaces

Use `<MarketplaceIcon provider="..." app />` em shell, títulos compactos e
seletores. Use a variante sem `app` somente quando o logo livre fizer mais
sentido no conteúdo.

Os logos oficiais ficam em:

- `public/brands/amazon.svg` e `public/brands/app/amazon.svg`;
- `public/brands/mercado-livre.svg` e `public/brands/app/mercado-livre.svg`;
- `public/brands/shopee.svg` e `public/brands/app/shopee.svg`;
- `public/brands/tiktok-shop.svg` e `public/brands/app/tiktok-shop.svg`.

Ícones funcionais usam `lucide-react`, normalmente com 14–20 px e traço entre
1.7 e 1.9. Não misture outra biblioteca sem uma necessidade real. Ícone estático
de navegação não precisa de animação própria.

## 5. Cor

### Regra principal

**A única cor da interface é a que significa alguma coisa.** O cromo é formado
por duas âncoras neutras e opacidades da mesma tinta. Não invente novos cinzas.

Novas cores cromáticas devem ser escritas em OKLCH. Derivações devem partir de
tokens com `color-mix(in oklch, ...)`, para preservar coerência perceptual.

### Neutros canônicos

| Token | Valor | Uso |
|---|---:|---|
| `--ink` | `#171717` | texto principal, CTA sólido, ação ativa |
| `--paper` | `#fdfdfd` | canvas e superfícies comuns |
| `--paper-modal` | `#ffffff` | branco puro, reservado a modal/popover elevado |
| `--ink-03` | `#17171708` | fundo rebaixado, sidebar, hover muito leve |
| `--ink-05` | `#1717170d` | anel de superfície e item ativo neutro |
| `--ink-08` | `#17171714` | separador e fundo terciário |
| `--ink-12` | `#1717171f` | traço forte e divisor interno |
| `--ink-32` | `#17171752` | texto ou ícone muito secundário |
| `--ink-50` | `#17171780` | placeholder, cabeçalho de tabela, eixo |
| `--ink-64` | `#171717a3` | texto secundário |
| `--divider` | `#ebebeb` | divisores sólidos de tabela/estrutura |

`--ink-soft`, `--ink-muted` e `--ink-faint` são aliases da escada acima. Use o
degrau existente mais próximo em vez de criar `#777`, `slate-*` ou outro cinza.

### Significado operacional

| Token | Valor | Significa |
|---|---:|---|
| `--positive` | `oklch(0.505 0.102 161)` | lucro, crescimento confirmado, sucesso |
| `--positive-soft` | `oklch(0.956 0.027 160)` | fundo de resultado positivo |
| `--danger` | `oklch(0.545 0.17 27)` | custo, dedução, cancelamento, prejuízo, erro |
| `--warning` | `oklch(0.575 0.126 72)` | pendência, cobertura parcial, atenção |
| `--core` | `oklch(0.685 0.158 48)` | voz/insight do NEXO e orientação pontual |

`--core` não é uma cor genérica de marca para decorar a tela. Use-o em blocos
onde o próprio NEXO interpreta ou orienta — briefing, narração, seleção analítica
e sinais equivalentes. CTA global continua preto.

Regras financeiras não negociáveis:

- custo e dinheiro que saiu: vermelho;
- lucro confirmado: verde;
- prejuízo: vermelho, nunca verde;
- resultado ainda aberto: neutro ou âmbar, nunca verde;
- cancelados: vermelho;
- variação positiva: verde; negativa: vermelho;
- `null`: `—` ou texto explicativo, nunca `R$ 0,00`.

### Acentos por canal

| Canal | Principal | Escuro | Suave |
|---|---|---|---|
| Amazon | `--amazon: oklch(0.548 0.142 249)` | `--amazon-dark` | `--amazon-soft` |
| Mercado Livre | `--meli: oklch(0.895 0.166 96)` | `--meli-dark` | `--meli-soft` |
| Shopee | `--shopee: oklch(0.596 0.198 30)` | `--shopee-dark` | `--shopee-soft` |
| TikTok Shop | `--tiktok: oklch(0.285 0 0)` | `--tiktok-dark` | `--tiktok-soft` |

`AppShell` converte esses valores em `--channel-accent`,
`--channel-accent-dark`, `--channel-accent-soft` e `--channel-on-accent`. Um
componente compartilhado deve consumir esses aliases, não perguntar qual canal
está aberto para escolher uma cor manualmente.

O acento do canal serve para localização, série de gráfico e identidade de
origem. Não pinte toda a página com ele.

### Contraste

- texto normal deve atingir WCAG AA, 4.5:1;
- texto grande e controles não textuais devem atingir pelo menos 3:1;
- cor nunca é o único sinal: use rótulo, sinal, ícone ou posição;
- ajuste primeiro a luminosidade do OKLCH; não aumente cromaticidade para tentar
  resolver contraste;
- não existe dark mode implementado. Não crie valores escuros isolados em uma
  página.

## 6. Tipografia

### Família

O produto usa **Inter** como única família, carregada por `next/font/google` em
`src/app/layout.tsx` e exposta como `--font-app-sans`.

- não reintroduza Bricolage Grotesque;
- não use serifada no produto ou na landing;
- não carregue outra fonte para dar “personalidade” a uma única seção;
- `font-synthesis: none` impede negritos artificiais;
- a raiz já aplica antialiasing.

### Escala fechada

| Token | Tamanho/linha | Tracking | Papel típico |
|---|---:|---:|---|
| `--text-caption` | `12px/12px` | `0` | badge, rótulo curto |
| `--text-s` | `13px/18px` | `-0.065px` | navegação, tabela, descrição compacta |
| `--text-m` | `14px/20px` | `-0.112px` | corpo padrão da interface |
| `--text-l` | `16px/22px` | `-0.128px` | título de seção |
| `--text-h1` | `20px/28px` | `-0.56px` | título principal de tela de dados |
| `--text-display` | `28px/36px` | `-0.896px` | destaque excepcional, não KPI repetido |

Pesos globais principais: `--weight-body: 500` e
`--weight-semibold: 600`. Componentes existentes possuem alguns ajustes locais
para números e microcopy; reutilize o componente em vez de criar uma nova escala
global.

### Hierarquia por contexto

- topbar: 14 px, peso 500;
- breadcrumb: 13 px, tinta terciária;
- H1 de página de dados: 20 px; em dashboards compactos pode ser 16 px conforme
  o padrão já implementado;
- H2 de seção: 16 px, peso 600;
- métricas: rótulo 12–14 px, valor normalmente 16–18 px;
- cabeçalho/célula de tabela: 12–13 px;
- kicker em caixa alta: 10–12 px, tracking positivo; use pouco;
- hero público: 34–56 px, tracking negativo e medida curta;
- corpo editorial: 14–18 px, linha 1.5–1.65 e largura máxima aproximada de
  60–75 caracteres.

Títulos devem usar `text-wrap: balance`; descrições curtas,
`text-wrap: pretty`. Não escolha um `h3` apenas porque ele “parece do tamanho
certo”: semântica do documento e estilo são decisões diferentes.

Valores financeiros, contadores, percentuais e tabelas usam
`font-variant-numeric: tabular-nums`. Monoespaçada fica reservada a identificador
técnico e conteúdo realmente tabular, não a todo número.

No mobile, inputs ficam em pelo menos 16 px para evitar zoom automático no iOS.

## 7. Superfícies, raio e elevação

Canvas e card usam o mesmo `--paper`. O card aparece por contorno/sombra, não por
um branco diferente.

### Escala de raio

| Token | Valor | Uso |
|---|---:|---|
| `--radius-badge` | 6 px | badge e status curto |
| `--radius-sm` | 8 px | botão, input, pill de filtro |
| `--radius` | 10 px | controle/base intermediária |
| `--radius-md` | 12 px | menu, painel compacto |
| `--radius-lg` | 16 px | card e seção principal |
| `--radius-modal` | 20 px | modal |

O raio cresce com a altura. Em superfícies aninhadas, preserve concentricidade:
raio externo = raio interno + padding quando as duas bordas estão próximas.
`999px` só é aceitável para indicador realmente circular, avatar, switch ou
segmento que precisa ser uma cápsula.

### Elevação

- `--shadow-xs`: botão e controle destacado;
- `--shadow-surface`: card/painel comum;
- `--shadow-hover`: elevação de hover;
- `--shadow-lg`: popover grande;
- `--shadow-modal`: modal e superfície máxima;
- `--shadow-inset-highlight`: aresta de CTA sólido.

Use sombra para contorno de cards e botões. Mantenha borda real em input,
divisor, tabela e separação estrutural. Imagens dentro do app recebem outline
preto puro de 10% e `outline-offset: -1px`.

## 8. Espaçamento e densidade

A interface é compacta, mas não comprimida.

- canvas autenticado: 20 px no desktop; 16 px abaixo de 1024 px;
- espaço entre grandes seções: 24 px no desktop, 16–20 px no mobile;
- padding típico de painel: 14–22 px;
- controles compactos de desktop: 28 px;
- campos de formulário: 36 px ou mais;
- alvo touch/coarse: mínimo 44 × 44 px;
- alvo desktop: pelo menos 40 × 40 px quando o controle é só um ícone;
- linhas densas de tabela: aproximadamente 38–42 px;
- listas de ranking usam a própria barra como fundo da linha, não um gráfico ao
  lado e nem um card por item.

Faixas de KPIs devem ser contínuas, com divisores internos, sempre que os números
forem partes da mesma leitura. Cards independentes só fazem sentido quando cada
bloco possui tarefa, interação ou estado próprio.

## 9. Shell autenticado

### Desktop

- sidebar aberta: 240 px;
- sidebar recolhida: 48 px;
- topbar: 48 px;
- sidebar e topbar permanecem estáveis enquanto o corpo carrega;
- o canvas ocupa toda a largura restante; não imponha `max-width` centralizado a
  tabelas e análises;
- a preferência de sidebar é persistida;
- o seletor de canal fica no topo da própria sidebar;
- pesquisa, integrações e briefing são ações globais, não cards do dashboard.

### Navegação

- item de navegação: 28 px no desktop;
- ícone: 16 px;
- texto: 13 px;
- item ativo: fundo `--ink-05`; a hierarquia da sidebar permanece neutra;
- grupos usam sanfona e não desaparecem ao trocar de rota;
- subtabs/subitens ficam recuados sob uma guia vertical;
- caret de grupo é um triângulo sólido de 14 px: rotacionado `-90deg` quando
  fechado e `0deg` quando aberto;
- o rótulo deve continuar visível na sidebar aberta — não dependa de hover para
  explicar ícones.

### Mobile

A sidebar some abaixo de 1024 px e é substituída pelo `mobile-console`, com
seletor de canal, ações de conta e navegação horizontal. Não encolha a sidebar
desktop até caber no telefone.

## 10. Anatomia das páginas

### Cabeçalho

Use `<PageHeader />`:

1. breadcrumb/contexto com ícone do canal;
2. título;
3. subtítulo opcional;
4. ação primária/secundária no slot direito.

Não repita o logo do canal em um glifo grande. Não use eyebrow colorido para
dizer a mesma coisa que a sidebar já informa.

### Dashboard de canal

Ordem-base:

1. filtro de período sticky;
2. pendência operacional, somente se houver;
3. frase de contexto/resumo;
4. faixa contínua de KPIs;
5. métricas secundárias compactas;
6. gráfico diário explorável;
7. resumo financeiro canônico;
8. rankings, estoque e drill-downs específicos do canal.

Amazon, Mercado Livre, Shopee e TikTok usam essa anatomia. Particularidades da
API entram no conteúdo e nos estados, nunca como um novo design system.

### Dashboard multicanal

Prioriza comparação e decisão:

1. visão consolidada;
2. comparação por canal;
3. alerta/insight acionável;
4. série temporal por canal;
5. detalhes e atalhos.

Não replique quatro dashboards completos na mesma página.

### Listagens

Ordem-base:

1. contexto e contagem/resumo;
2. filtros locais e ações;
3. tabela densa;
4. paginação;
5. detalhe progressivo em linha, drawer ou seção expandida.

Cabeçalho de tabela usa fundo `--paper-soft`; números alinham à direita; linha
ganha hover neutro; ordenação usa `<SortButton />`; conteúdo truncado importante
precisa continuar acessível por título, tooltip ou expansão.

### Análises

Ordem-base:

1. pergunta/diagnóstico;
2. métricas que respondem a pergunta;
3. gráfico ou ranking proporcional;
4. tabs/segmentos;
5. registros que explicam o resultado;
6. drill-down.

Não use um gráfico porque “está faltando visual”. Use-o apenas quando forma,
proporção, tendência ou comparação reduzirem esforço cognitivo.

### Configurações e integrações

- navegação local por assunto;
- perfil, plano/pagamento, preferências, operação, dados e sessão em uma página
  coerente;
- “Perfil” aponta para configurações; não crie outra tela redundante;
- integrações compartilham o mesmo layout e mudam por capacidade/estado real;
- ações destrutivas ficam separadas, explicadas e confirmadas;
- ausência de backend de cobrança não deve virar UI falsa de pagamento.

## 11. Componentes compartilhados

### Métricas

Use `Metric` ou `CompactMetric`. Valor grande não é hierarquia quando todos os
KPIs têm o mesmo tamanho. A frase acima da faixa e a ordem dos indicadores dizem
o que importa.

- `positive`: verde;
- `danger`: vermelho;
- `warn`: âmbar;
- padrão: tinta neutra;
- tendência compara bases equivalentes e deve explicar o período no `title`/
  `aria-label`.

### Filtros

Filtros globais ficam próximos do topo; filtros locais ficam dentro da seção que
controlam. O filtro de período usa `DashboardPeriodFilter`, é sticky no desktop
e ganha elevação somente quando encosta na topbar.

Não misture seleção global e local na mesma fileira sem agrupamento. Estado
ativo é preto/neutro ou acento contextual; não use uma nova cor.

### Tabs

Use tabs para alternar visões equivalentes dentro da mesma tarefa. O estado
ativo deve ser óbvio por fundo, sublinhado ou sombra interna, com
`aria-selected`/`aria-current` e teclado quando aplicável.

### Tabelas e rankings

- tabela para precisão e consulta;
- ranking com barra proporcional para comparação rápida;
- card por linha é proibido em listas densas;
- ações secundárias surgem por hover/foco quando isso não esconder informação
  essencial;
- paginação não deve perder filtros ou contexto.

### Resumo financeiro

Use `FinancialSummaryPanel` em todos os canais. A anatomia é:

1. estado da composição;
2. faturamento total;
3. custos conhecidos;
4. resultado/lucro/prejuízo;
5. margem;
6. explicação da cobertura.

`CompositionDonut` usa degraus de vermelho para custos, verde para lucro,
vermelho para prejuízo e âmbar para composição pendente. Hover/foco sincroniza
anel, legenda e valor central. Não use paleta arco-íris para categorias de custo.

### Gráfico diário

Use `RevenueChart` quando houver série temporal diária.

- linha monotônica suave; não use polilinha pontuda;
- cor da série: `--channel-accent-dark`/`--rev`;
- área com baixa opacidade;
- grade, eixo e crosshair neutros;
- seletor Faturamento/Pedidos/Unidades no cabeçalho interno;
- hover e teclado mostram crosshair, ponto e tooltip estruturado;
- tooltip compara com o dia anterior e usa verde/vermelho semanticamente;
- vazio é desenhado na geometria final do gráfico, sem inventar linha em zero;
- labels nunca podem ser cortadas; preserve os paddings do `viewBox`.

### Top produtos

Use `TopProductsRanking`: barra proporcional como fundo, tabs de métrica,
unidades, faturamento e margem na mesma linha. A visualização deve responder
“qual produto concentra resultado?” antes de exigir leitura da tabela completa.

## 12. Estados e feedback

### Loading

Use skeleton com a geometria da tela final:

- `DashboardSkeleton` para KPI + gráfico + tabela;
- `PanelLoading` para painel;
- `TableLoading` para lista/tabela;
- `InlineLoading` para atualização pequena.

O shell e os filtros não devem desaparecer durante loading. Evite spinner
centralizado em uma página inteira.

### Vazio

Use `EmptyState` com:

1. título factual;
2. o que está faltando;
3. o que a pessoa ganha ao resolver (`payoff`);
4. ação possível.

Tipos disponíveis: `data`, `search`, `permission` e `success`.

### Erro e sucesso

- erro explica o que falhou sem expor detalhes internos;
- conexão quebrada oferece reconexão quando aplicável;
- sucesso confirma a ação no mesmo contexto;
- não substitua ausência ou permissão insuficiente por erro genérico;
- status não depende apenas da cor.

## 13. Movimento e microinterações

O movimento deve explicar estado, direção ou relação. Não é decoração contínua
do produto autenticado.

Tokens-base: `--duration: 150ms` e
`--ease: cubic-bezier(.4, 0, .2, 1)`.

Regras:

- transição para hover, toggle, accordion e seleção; keyframes para entrada,
  loading e narrativa encenada;
- declare somente as propriedades animadas; nunca `transition: all`;
- pressão em botão: `scale(.96)`, nunca menor que `.95`;
- entrada de seções: pequenos grupos com `opacity`, `blur(4px)` e
  `translateY(12px)`, escalonados em cerca de 50–100 ms;
- saída é mais curta e discreta que entrada;
- ícones contextuais alternam entre `scale(.25)`, `opacity: 0`, `blur(4px)` e o
  estado final;
- não aplique `will-change` sem stutter observado;
- implemente `prefers-reduced-motion: reduce` para toda animação não essencial.

No login, os canais disparam sinais em sequência por trilhas distintas, convergem
no símbolo NEXO e acionam “Conectando os pontos”. O formulário permanece estável.
Na landing, movimento demonstra funcionalidades reais do NEXO; não use uma
animação genérica que não corresponda ao produto.

## 14. Superfícies públicas

### Landing

A landing compartilha Inter, símbolo, monocromia, raios e semântica financeira,
mas possui ritmo editorial próprio:

- conteúdo máximo de 1080 px;
- grid estrutural sutil;
- hero entre 36 e 54 px;
- CTA preto com raio de 8 px;
- seções longas com respiro de 60–110 px;
- demonstrações reutilizam componentes e dados representativos do app;
- cores aparecem apenas em marketplaces e significado financeiro.

### Login

O login usa duas colunas no desktop e uma no mobile:

- lado editorial: assinatura, narrativa, três benefícios e fluxo animado;
- lado funcional: card estável de login/criação de conta;
- fundo: grid de 60 px inspirado na linguagem da landing;
- formulário não herda o movimento do lado editorial;
- inputs possuem borda visível, foco claro, sugestões de domínio e visibilidade
  de senha;
- cadastro repete e valida a senha no cliente e no servidor.

Copy vigente dos três benefícios:

1. **Todos os canais** — Uma visão única do que está acontecendo.
2. **Números com contexto** — Não apenas quanto mudou. O que existe por trás.
3. **Decisão mais rápida** — Saiba onde agir sem perder tempo interpretando
   painel.

### Privacidade

Página pública autônoma, com cabeçalho compacto, índice lateral sticky que vira
trilho horizontal no mobile e texto legal de medida curta. Não use o shell
autenticado nessa rota.

## 15. Responsividade e acessibilidade

Breakpoints são guiados pelo conteúdo. Os mais recorrentes são 1024/1023, 900,
760/767, 600/560 e 540 px. Antes de criar outro, verifique se um desses resolve.

Regras obrigatórias:

- testar inicialmente em 1440 × 900;
- testar viewport mobile próximo de 390 × 844;
- não permitir overflow horizontal do documento;
- grids viram duas colunas e depois uma conforme a leitura exigir;
- filtros podem quebrar linha ou virar trilho horizontal, mas não cortar botões;
- alvos touch têm no mínimo 44 px;
- `:focus-visible` permanece visível;
- toda interação de hover possui caminho por teclado/foco;
- gráficos interativos têm `role`, `aria-label` e navegação por teclado;
- loading usa `role="status"`; erros relevantes usam `role="alert"`;
- animações respeitam redução de movimento;
- não bloqueie zoom do navegador.

## 16. Como implementar uma nova tela

1. Identifique a família: dashboard, listagem, detalhe, análise, configuração ou
   página pública.
2. Liste dados, ações, filtros, estados e regras existentes antes de desenhar.
3. Procure os componentes compartilhados adequados.
4. Defina a pergunta principal da tela e ordene o conteúdo para respondê-la.
5. Monte a estrutura com tokens e anatomias deste documento.
6. Preserve funcionalidades e contratos; reorganizar não significa remover.
7. Verifique loading, vazio, erro, sucesso, `null`, parcialidade e permissões.
8. Valide no Chrome em desktop e mobile, incluindo interação, console e
   responsividade.
9. Compare a nova rota com as outras da mesma família e equalize densidade,
   títulos, filtros, métricas e componentes.
10. Atualize a matriz única em `docs/peec-ui-audit.md`.

## 17. Checklist de revisão visual

- [ ] Produto visível chamado NEXO; nenhum texto novo diz SellerCore.
- [ ] Símbolo vem de `<NexoSymbol />` e favicon global.
- [ ] Inter é a única família.
- [ ] Nenhuma cor decorativa ou cinza novo foi introduzido.
- [ ] Custos/vermelho, lucro/verde e pendência/âmbar estão coerentes.
- [ ] Acento de canal vem de `--channel-accent*`.
- [ ] Título da tela de dados não compete com as métricas.
- [ ] Conteúdo está agrupado por tarefa, sem grid arbitrário de cards.
- [ ] Raios seguem a escala e superfícies aninhadas são concêntricas.
- [ ] Cards usam sombra/anel; divisores e inputs usam borda real.
- [ ] Números variáveis usam tabular nums.
- [ ] Tabela, gráfico e ranking preservam alinhamento e drill-down.
- [ ] Loading mantém a geometria final.
- [ ] Ausência de dado não aparece como zero.
- [ ] Hover, foco, teclado, pressão e redução de movimento foram tratados.
- [ ] Desktop 1440 × 900 e mobile foram validados no Chrome.
- [ ] Não há overflow, clipping, erro de console ou perda funcional.

## 18. Anti-regressões rápidas

Se uma mudança fizer qualquer uma destas coisas, pare e revise:

- a integração Shopee parecer um produto diferente da Amazon;
- um custo ficar verde ou um lucro ficar vermelho sem ser prejuízo;
- o símbolo do NEXO ser substituído por logo de marketplace;
- a sidebar voltar a exigir hover para ler os itens;
- o caret de grupo voltar a um chevron fino ou a apontar para o lado errado;
- o filtro sticky ficar sob a topbar ou cortar botões;
- uma tabela virar coleção de cards no desktop;
- um donut cortar legenda/valor ou usar o mesmo tom no número e no fundo;
- um gráfico voltar a uma linha pontuda, sem tooltip ou com label cortado;
- um estado parcial parecer resultado definitivo;
- uma página pública ganhar o shell autenticado;
- uma tela mudar só cor, borda e fonte mantendo a arquitetura antiga.

O critério final não é “parece com o PEEC”. É: **o NEXO organiza as próprias
funcionalidades com clareza, hierarquia, consistência, honestidade e inteligência.**

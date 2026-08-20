# Mapa de frames — walkthrough do peec.ai

**20/08/2026.** Levantamento do walkthrough de produto (9:00) que acompanha
`docs/peec-ui-audit.md`. A auditoria mediu o app ao vivo; este doc registra
**telas e estados que a conta de teste não mostra** — ela está vazia, e vazia
esconde justamente o que interessa: tabela populada, drill-down, modal de
criação, drawer de edição, filtro aplicado.

> **Precedência.** Onde vídeo e app ao vivo divergirem, vale o **app ao vivo**
> para o visual atual — o vídeo pode estar à frente ou atrás da build. O vídeo é
> a fonte para **fluxo e estado**; o app é a fonte para **pixel e microinteração**.

> **Nada aqui é para copiar literalmente.** Texto, marca, dado e funcionalidade
> são deles. O que se transfere é o padrão de experiência.

---

## Pontos de observação

| Tempo | Tela/estado | Estrutura visual | Componentes | Interação observada | Adaptação para o NEXO |
|---|---|---|---|---|---|
| 0:18 | Abertura | Sem UI | — | — | — |
| 0:45 | Overview + dropdown de modelos aberto | Sidebar 3 grupos (General / Preferences / Settings). Conteúdo em 2 colunas ~60/40 | Popover de seleção múltipla com "All Models" + check, lista com ícone por modelo | Abre por clique no pill; item com checkbox | Filtro de canal e de conta no NEXO vira o mesmo popover. Hoje são controles soltos |
| 1:15 | Overview, hover no header da coluna | Idem | Tooltip escuro ancorado abaixo do header | Passar o mouse no cabeçalho **explica a métrica** | Alto valor: colunas do NEXO (tarifa, repasse, margem) precisam disso mais que as deles |
| 1:50 | Prompts — lista agrupada | Card único ocupando a largura; abas acima da tabela | Abas Active/Suggested/Inactive; busca à direita; Export; header de coluna com ícone e ordenação | Linha de GRUPO mostra o **valor agregado** do grupo e colapsa por chevron | Produtos por categoria, pedidos por status: linha de grupo com o agregado, não só um rótulo |
| 2:25 | Modal "Add new Topic" | Modal centrado ~450px, radius ~12 | Campos: texto, stepper numérico, select com bandeira, select | Rodapé com **uma** ação sólida à direita; X no topo | Criar produto/custo no NEXO usa modal centrado com uma ação só |
| 2:25 | Aba "Suggested" ao fundo | Mesma tabela | Botões **Reject / Track** por linha | Triagem item a item, sem sair da lista | "Pendências da operação" vira lista de triagem com ação por linha |
| 3:00 | Prompts — vários tópicos | Grupos empilhados, uns abertos outros fechados | "..." por grupo | Expandir/colapsar preserva o resto da página | Igual para agrupar por canal ou por categoria |
| 3:35 | **Drill-down de um prompt** | **A MESMA composição da Overview**, escopada | Breadcrumb `Prompts > "texto"`; chip de país + status `● Active` | A barra de filtros **encolhe**: some o que não se aplica no escopo | O padrão mais valioso do vídeo. Ver nota abaixo |
| 4:00 | Drill-down, tabela de marcas | Idem | Linha "você" recebe **ponto** no lugar do número de posição | Identidade do próprio no ranking sem cor extra | Nas tabelas de concorrência do NEXO, marcar "seu anúncio" assim |
| 4:28 | Drawer de edição de marca | **Drawer lateral** ~570px, altura cheia, à direita | Capa, logo, título editável, seções por régua, toggle, input com × e "+ Add Alias" | Página atrás **escurece** (sem blur). Rodapé fixo Cancel/Save | Editar custo, imposto ou conta no NEXO: drawer, não navegação |
| 4:50 | Brands — grade de cards | 4 colunas | Card com faixa superior tingida na cor da marca, logo, nome, contagem | Seções "Suggested" (Track/Reject) e "Tracked" (menu "...") | Tela de integrações e de produtos: mesma grade. A faixa tingida é o único lugar com cor decorativa, e ela vem do logo |
| 5:32 | Overview com **filtro aplicado** | Idem | Pill troca "All Models" por uma contagem; surge um **Reset** ghost à direita da barra | Ver a correção abaixo — o vídeo engana aqui | Período/canal aplicado no NEXO: rótulo vira contagem e aparece Reset. Hoje o "30 dias" ativo é um bloco azul sólido |
| 5:32 | Gráfico + tabela | Idem | Série destacada, demais apagadas | **Realce cruzado**: hover na linha da tabela acende a série no gráfico | Vale para faturamento por canal e curva ABC |
| 6:15 | Donut de tipos | Card à esquerda do bloco | Donut com total no centro, legenda em lista de pontos | Hover no segmento troca o **rótulo central** para aquele segmento e abre tooltip | Composição de tarifas no NEXO cabe nisso |
| 6:15 | "Recent Chats" | Grade 3 colunas abaixo da tabela | Card com ícone, pergunta, trecho da resposta, tempo, chips | **Toggle** no header da seção filtra a própria seção | Últimos pedidos / últimas auditorias |
| 6:55 | Sources | Gráfico multi-linha + donut à direita; tabela abaixo | Legenda de séries **acima** do gráfico, em pontos coloridos + nome | Toggle "Gap Analysis" com ícone de info ao lado do filtro | O NEXO já tem Gap Analysis: mesma disposição |
| 7:37 | URLs | Idem, tabela mais larga | Badges de tipo de URL; coluna "Mentioned" Yes/No/Unknown; **botão "Details" por linha** | Ação por linha à direita, fora do fluxo de leitura | "Ver pedido", "ver anúncio": botão por linha em vez de linha clicável inteira |
| 8:15 | URLs com "Unknown" | Idem | Estado **Unknown** distinto de Yes e de No | Três estados, não dois — desconhecido é um valor | Alinha com `null ≠ 0`, que o NEXO já pratica |
| 8:48 | Overview, fechamento | Idem | — | — | — |

---

## As cinco lições que valem mais que a lista

### 1. Uma composição, vários escopos
A tela de um prompt é **a mesma tela** da Overview: mesmo gráfico de visibilidade,
mesma tabela de marcas, mesmo bloco de fontes. Muda o escopo e a barra de
filtros encolhe para os que ainda fazem sentido.

Não são duas telas parecidas — é uma composição aplicada duas vezes. É o que
permite ao produto ter profundidade sem multiplicar layouts, e é por isso que
navegar nele não custa reaprendizado.

**Para o NEXO:** o dashboard de canal e o detalhe de um produto podem ser a
mesma composição em escopos diferentes. Hoje são telas desenhadas separadamente.

### 2. Filtro aplicado se anuncia por rótulo e por Reset — não por cor

⚠️ **Correção do vídeo, medida ao vivo em 20/08.** No frame de 5:32 o pill da tag
aparece vermelho e eu li isso como "aplicado fica tingido". **Está errado.**
Medindo os dois estados no app:

| | Pill neutro | Pill aplicado |
|---|---|---|
| Fundo | `#fdfdfd` | `#fdfdfd` — **igual** |
| Raio / padding / sombra | 8px / `0 6px` / anel 5% | **idênticos** |
| Rótulo | "All models" | "2 models selected" |
| Largura | 105px | 174px |

O vermelho do frame é a **cor daquela tag** (tags têm cor própria), não um estado.
E o anel azul que aparece no pill aplicado é **foco** — voltou para o gatilho
depois do `Esc`, não é sinal de filtro.

O que realmente muda:
1. **O rótulo vira contagem.** "All models" → "2 models selected". O pill cresce.
2. **Surge um `Reset`** ghost à direita da barra, que só existe quando há filtro.
3. **O filtro entra na URL** (`?models=…&models=…`) — a tela filtrada é
   compartilhável e o botão voltar desfaz.

**Para o NEXO:** o seletor de período é hoje um bloco com o item ativo em azul
sólido. Vira pill de 28px com rótulo-contagem, Reset condicional, e estado na URL.

### 3. A linha de grupo carrega o agregado
Colapsar um grupo não esconde a informação — a linha do grupo mostra a soma
daquele grupo. Fechado continua informando, igual ao painel de tópicos que
encolhe e mantém as contagens.

### 4. Modal cria, drawer edita
Criar um tópico é um modal centrado, curto, com uma ação. Editar uma marca é um
drawer lateral, longo, com seções e rodapé fixo. A forma diz o tamanho do
trabalho antes de você ler o conteúdo.

### 5. Três estados, não dois
A coluna "Mentioned" tem Yes, No e **Unknown**. Desconhecido é um valor exibido,
não um vazio. É exatamente a regra que o NEXO já aplica em `null ≠ 0` — a
diferença é que lá ela chegou na tabela como um rótulo próprio.

---

## O que NÃO transferir

- **A estrutura de navegação deles.** General / Preferences / Settings serve a um
  produto de uma marca só. O NEXO tem quatro canais e já resolveu isso com duas
  calhas (`docs/menu-lateral.md`), que é melhor para o caso dele.
- **Cor de marca nos cards de concorrente.** No NEXO a cor já é ocupada pelos
  quatro marketplaces.
- **Texto, dado, nome e funcionalidade.** Nada disso é nosso.

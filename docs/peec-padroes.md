# Biblioteca de padrões — o peec.ai inteiro como referência

**20/08/2026.** Complementa `peec-ui-audit.md` (medidas) e
`peec-video-frame-map.md` (fluxos). A diferença é a organização: aqui os
padrões estão agrupados **por necessidade do NEXO**, não por página do Peec.

> **Por que não mapear página a página.** O melhor padrão para uma tela do NEXO
> raramente está na tela "equivalente" do Peec. O seletor de colunas está na Gap
> Analysis, o estado vazio bom está em Actions, o formulário de setup está em
> Perception e a anatomia de configuração está em Settings. Cada necessidade
> pega o melhor de onde ele estiver.

> **Nada de texto, dado, marca ou funcionalidade deles.** O que se transfere é
> o padrão de experiência.

---

## 1. Navegação

### 1.1 Contexto no topo da sidebar, não em calha própria
**Onde:** todas as telas. **Medida:** sidebar 240px, seletor de 32px no topo.

O Peec troca de marca por um dropdown no topo da sidebar. Não existe coluna de
ícones para contexto.

**NEXO — feito.** Os quatro canais saíram da calha e viraram esse dropdown
(`SidebarNexo.tsx`). É o que liberou largura para o rótulo caber sempre visível.

### 1.2 Sub-navegação SUBSTITUI a sidebar
**Onde:** Settings. Entrar em configurações troca a sidebar inteira por
`Project settings` (Profile, Brands, Tags) + `Company` (Settings, Projects, API
Keys, Members, Billing), com um `‹ Overview` para voltar.

**NEXO — fazer.** `/integracoes` e as configurações por canal hoje vivem soltas
no meio da navegação de operação. Entrar em configuração deveria trocar o
contexto da sidebar, não empilhar mais um item.

### 1.3 Contador no item de nav
**Onde:** `Brands 10+` no Settings.

**NEXO — fazer.** "Pendências", "Pedidos a revisar" e "Radar de estoque" são
exatamente contagens que a pessoa precisa ver **antes** de clicar. Hoje ela
precisa entrar para descobrir se há trabalho.

### 1.4 Popover educativo em item novo
**Onde:** hover em `Perception · Beta` abre um card com vídeo, descrição e
"Learn more".

**NEXO — talvez.** Só vale quando houver feature nova de verdade. Registrado
para não ser reinventado quando chegar a hora.

---

## 2. Filtros — a distinção que mais importa

### 2.1 Dois níveis, visualmente distintos
**Onde:** Gap Analysis mostra os dois ao mesmo tempo.

| Nível | Onde fica | Exemplo no Peec |
|---|---|---|
| **Global** — afeta a página inteira | pills logo abaixo da trilha | marca, período, tags, modelos, tópicos |
| **De tabela** — afeta só aquela tabela | na toolbar, ao lado da busca | "Min 1 Competitor", "All brands", "All domain types" |

**NEXO — fazer, e é o que falta com mais urgência.** Período e canal são
globais. "Só FBA", "só com custo cadastrado", "só pendentes" são de tabela e
hoje não existem ou estão misturados com os globais.

### 2.2 Filtro aplicado: rótulo vira contagem, e surge Reset
**Medido ao vivo.** O pill aplicado **não muda de cor** — fundo, raio, padding e
sombra são idênticos ao neutro. O que muda: "All models" → "2 models selected",
o pill cresce, e aparece um `Reset` ghost no fim da barra. O filtro também entra
na URL, então a tela filtrada é compartilhável e o botão voltar desfaz.

**NEXO — fazer.** O período ativo hoje é um bloco sólido no acento do canal —
o elemento mais saturado da tela competindo com o dado.

### 2.3 Filtro some quando não há o que filtrar
**Onde:** Actions vazio não mostra barra de filtros.

**NEXO — fazer.** Hoje a tela de canal sem conexão ainda exibe o seletor de
período, que não filtra nada.

---

## 3. Tabelas

### 3.1 Seletor de colunas em três níveis
**Onde:** Gap Analysis. `Fixed` (não removível) · `Active` (marcadas) ·
`Available` (disponíveis) · `Reset to default`.

**NEXO — fazer.** Produtos, catálogo e pedidos têm muitas colunas e cada pessoa
olha um recorte. O `CustomizableMetricGrid` já faz isso para KPI; falta para
coluna, que é onde dói. Reaproveitar o mesmo modelo de preferência salva.

### 3.2 Densidade dos indicadores
**Onde:** engrenagem da toolbar → `Default` / `Indicators only` / `None`.

**NEXO — fazer.** Numa tabela de 200 SKUs a variação em toda linha vira ruído.
Deixar desligar é barato.

### 3.3 Slot de variação sempre presente
Toda célula numérica reserva o espaço da variação e mostra `–` quando não há.
A coluna não pula de largura quando um delta aparece.

**NEXO — fazer.** Casa com a regra de `null ≠ 0` que o produto já tem: o
travessão é a ausência declarada, não célula vazia.

### 3.4 Toolbar da tabela
Busca à esquerda, filtros de tabela no meio, três ícones à direita (colunas,
indicadores, exportar). Contagem no rodapé à direita ("12 items") quando o
conjunto é pequeno — paginação só quando precisa.

### 3.5 Ação por linha à direita
**Onde:** URLs tem botão `Details` por linha, fora do fluxo de leitura.

**NEXO — fazer.** "Ver pedido", "ver anúncio", "cadastrar custo" como botão por
linha é melhor que linha inteira clicável: convive com seleção e com copiar
texto da célula.

### 3.6 Agrupamento com agregado na linha do grupo
**Onde:** Prompts agrupados por tópico. A linha do grupo mostra a soma daquele
grupo e colapsa por chevron.

**NEXO — fazer.** Produtos por categoria, pedidos por status, SKU por canal.
Fechado continua informando.

---

## 4. Gráficos

### 4.1 Seletor de métrica onde só o ativo tem rótulo
**Onde:** Insights. Grupo de ícones; o selecionado expande para ícone + nome
("👁 Visibility"), os outros ficam só ícone. Quatro métricas em ~130px, e o
eixo Y reescala.

**NEXO — fazer.** Faturamento, lucro, margem e ROI no mesmo gráfico, trocando
por esse seletor, em vez de quatro gráficos ou um só fixo.

### 4.2 Menu de exportação por card
**Onde:** todo card de gráfico. `Export CSV` / `Save as image` / `Copy to
clipboard`.

**NEXO — fazer.** Quem opera marketplace vive colando número em planilha e em
conversa com suporte do canal.

### 4.3 Resolução D / W / M
Grupo de três letras no canto do card.

**NEXO — fazer.** Hoje a granularidade é fixa por período.

### 4.4 Realce cruzado tabela ↔ gráfico
Hover na linha da tabela acende a série dela e apaga as outras.

**NEXO — fazer.** Faturamento por canal e curva ABC.

---

## 5. Estados vazios

### 5.1 O vazio explica o que você ganha, não o que falta
**Onde:** Actions. Ícone discreto, título, duas linhas dizendo **por que** vale
e o que aparece quando houver dado, e **uma** ação sólida.

**NEXO — fazer.** É uma evolução direta da regra que o produto já tem ("tela sem
dado mostra o estado real"). Falta a segunda metade: dizer o que a pessoa ganha
ao resolver.

### 5.2 O vazio de configuração É o formulário
**Onde:** Perception. Em vez de "sem dados", a tela mostra "Set up Brand
Perception" com os campos reais.

**NEXO — fazer.** Canal sem custo cadastrado, sem alíquota, sem conexão: em vez
de avisar e mandar para outra tela, resolver ali.

---

## 6. Formulários e configuração

### 6.1 Um card por assunto, ação dentro do card
**Onde:** Settings. Cada bloco tem título, descrição e o próprio `Save` no canto
inferior direito — sem barra de salvar global.

### 6.2 Ajuda embaixo do campo, não no placeholder
Placeholder some quando você digita; a regra precisa continuar visível.

### 6.3 Linha de preferência com status à direita
**Onde:** Email preferences. Toggle + nome à esquerda, chip com o estado
resultante à direita ("Every 2 weeks · Next Fri 28 Aug").

**NEXO — fazer.** Cron por canal, alerta de estoque, frequência de sync: dizer
**quando é a próxima** ao lado do controle.

### 6.4 Modal cria, drawer edita
Modal centrado e curto para criar; drawer lateral de ~570px com seções e rodapé
fixo para editar. A forma anuncia o tamanho do trabalho.

---

## 7. O que NÃO trazer

- **A hierarquia de navegação deles.** General/Preferences/Settings serve a um
  produto de marca única.
- **Cor de marca em card de concorrente.** No NEXO a cor já pertence aos quatro
  marketplaces.
- **Paleta de comando e onboarding de 5 passos.** Fluxo de entrada do NEXO é
  outro.

---

## Ordem de execução sugerida

Por impacto sobre o que a pessoa faz todo dia, não por facilidade:

1. **Filtro de tabela separado do global** (§2.1) — destrava recortes que hoje
   não existem
2. **Estado vazio que explica e resolve** (§5.1, §5.2) — é a primeira tela de
   qualquer canal não conectado
3. **Contador no item de nav** (§1.3) — trabalho pendente visível sem clicar
4. **Seletor de métrica no gráfico** (§4.1) e **exportação por card** (§4.2)
5. **Seletor de colunas** (§3.1) e densidade de indicadores (§3.2)
6. **Agrupamento com agregado** (§3.6)
7. **Sub-navegação de configuração** (§1.2)

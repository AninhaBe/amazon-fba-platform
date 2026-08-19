---
name: monitorar-ads
description: Use para acompanhar as campanhas de Sponsored Products da Amazon ao longo do dia — ler impressões, cliques, CTR, gasto e vendas por campanha, comparar com a leitura anterior e dizer se é para agir ou esperar. Dispara em "como estão as campanhas", "monitorar ads", "olha as campanhas", "e os anúncios?", ou quando um /loop de acompanhamento de Ads acorda.
---

# Monitorar as campanhas de Ads (NEXO)

Objetivo: responder **"tem algo para fazer agora?"** — não despejar números. Toda
leitura termina com uma de três conclusões: **esperar**, **agir** (com o quê), ou
**investigar** (com o quê).

> ## 🔀 Esta skill LÊ. A skill `gerenciar-ads` DECIDE e EXECUTA.
>
> | Pergunta | Skill |
> |---|---|
> | "Como estão as campanhas?" · "tem algo pra fazer?" | **esta aqui** |
> | "Negativa esse termo" · "cria a manual do clips" · "quanto posso pagar por clique?" | **`gerenciar-ads`** |
>
> Quando a leitura terminar em **agir** ou **investigar**, o passo a passo está em
> `../gerenciar-ads/` — o motor de decisão, a matemática do lance, o ciclo de colheita,
> as armadilhas da tela de criação e a calculadora `scripts/lance.mjs`.
>
> **As duas compartilham este arquivo como log.** Toda leitura e toda mudança são
> registradas aqui, com data e hora. Foi esse histórico que permitiu, dias depois, provar
> que o preço era a causa e não a campanha.

## ⛔ FORMATO OBRIGATÓRIO DE TODA LEITURA

Ela cobrou, com razão: *"não adianta você criar um puta guia e você mesmo não seguir"*.

Escrever a regra num doc **não faz ninguém segui-la** — o doc é passivo, e eu li os
capítulos de atribuição e volume mínimo e errei no dia seguinte mesmo assim.

**Por isso a regra virou formato de saída, não lembrete.** Toda leitura de campanha começa
com este bloco, sem exceção:

```
Período lido: <as datas EXATAS que estão na tela>
Recarreguei: sim/não
Volume: <impressões> · <cliques> · atribuição <fechada/pendente>
```

**Por que formato e não checklist:** checklist mental se esquece em silêncio. Cabeçalho
ausente aparece na tela — ela vê, e eu tropeço nele antes de concluir.

### O que cada linha impede

| Linha | Erro que ela bloqueia |
|---|---|
| **Período lido** | Concluir sobre um dia achando que é o acumulado (aconteceu com a Manual - Clips) |
| **Recarreguei** | Ler DOM em cache e jurar que o dia não andou |
| **Volume + atribuição** | Cortar orçamento de campanha que estava convertendo (aconteceu com a Auto - Protetor) |

⚠️ **Se qualquer uma das três não puder ser preenchida com certeza, a leitura está
incompleta — e leitura incompleta não vira conclusão.** Diga o que falta e pare.

---

## 🔴 O ERRO QUE JÁ COMETI TRÊS VEZES — leia antes de concluir qualquer coisa

**Concluir sobre uma janela curta demais.** Três vezes em três dias, sempre o mesmo
mecanismo, sempre com prejuízo:

| Quando | O que eu concluí | O que era de verdade |
|---|---|---|
| 16/08 | "Auto - Protetor tem 21 cliques e zero venda" → cortei o orçamento pela metade | Era a **melhor campanha da conta** (ROAS 15,11). A atribuição ainda não tinha fechado |
| 16/08 | "Manual - Clips desabou, CTR de 0,12%" → candidata a investigar/negativar | Lendo **só o dia 17**. No período de 2–15/08 ela tem **CVR de 25% a 40%** — a melhor conversão da conta |
| 16/08 | "os números não mudaram em 5 horas" | Era **DOM em cache**; eu não tinha recarregado |

### A regra, agora obrigatória

**Antes de qualquer conclusão, diga em voz alta qual é o período da leitura.**

```
[ ] Qual filtro de data está aplicado AGORA na tela?
[ ] Esse período tem volume suficiente? (500 impr / 10 cliques / 45 cliques)
[ ] A janela de atribuição fechou? (7 dias + 3 de folga)
[ ] Eu recarreguei a página, ou estou lendo DOM velho?
```

⚠️ **O console mostra períodos DIFERENTES na mesma tela.** O cartão de resumo, o gráfico e
a tabela podem estar em três janelas distintas — já vi "17 de ago" na tabela e
"12 ago - 17 ago" no gráfico simultaneamente. **Ler o rótulo de cada bloco antes de citar
o número.**

📌 **Nunca concluir "não converte" com um dia de dado.** Um dia serve para ver se a máquina
parou, nada além disso.

---

## 🔁 A ANÁLISE DIÁRIA — campanha por campanha, sempre

**Regra dela, dada em 17/08/2026:** *"é esse tipo de análise que quero de você, todo dia,
entrando campanha por campanha e não vendo apenas o todo."*

⚠️ **A tabela agregada NÃO é análise.** Ela esconde as três coisas que mais importam:

| O que a tabela agregada esconde | Como só apareceu ao abrir uma a uma |
|---|---|
| Lance real ≠ lance anotado | `Auto - Martelo` estava em R$ 3,00, não R$ 0,84 — 4 dias pagando 9× a sugestão |
| Qual campanha realmente vende | Só 2 das 6 vendem; as colunas Compras/Vendas ficam fora da tela na lista |
| De onde vem o tráfego ruim | 75% das impressões do martelo eram `Substitutos` (página de concorrente), que não gera termo de busca |

### O roteiro (repetir todo dia)

**1. Pegar os links, sem adivinhar URL.** Na lista de campanhas:

```js
[...document.querySelectorAll('a')].map(a=>a.textContent.trim()+' => '+a.getAttribute('href'))
```

**2. Para CADA campanha**, abrir `/cm/sp/campaigns/<id>/ad-groups` e extrair:

```js
[...document.querySelectorAll('[role="row"]')].map(r=>[...r.querySelectorAll('[role="gridcell"]')]
  .map(c=>c.innerText.replace(/
+/g,' | ').trim()).filter(Boolean).join('  ||  ')).filter(Boolean).join('
')
```

Isso devolve **lance padrão, lance sugerido, custo, compras, vendas e ROAS por grupo** —
sem rolar a tabela para o lado (o que já derrubou a sessão).

**3. Nas AUTOMÁTICAS**, abrir também `/ad-groups/<adGroupId>/targeting` — é onde moram os
quatro grupos (aproximada, vaga, substitutos, complementos) com **lance independente**. Foi
aí que o R$ 3,00 estava escondido.

**4. Calcular o CPC real de cada campanha** (`custo ÷ cliques`) e comparar com o lance.
Com dinâmico em "somente redução" e posicionamento em 0%, **o CPC nunca pode passar do
lance**. Se passar, o lance anotado está errado — vá conferir.

**5. Fechar com as três perguntas:**
- Alguma campanha está com lance diferente do anotado?
- Quais campanhas vendem, e alguma delas está limitada por orçamento?
- Alguma está gastando sem vender há tempo suficiente para concluir?

### Checklist por campanha

```
[ ] status (Em inserção / Orçamento excedido / Pausado)
[ ] orçamento e se bateu no teto
[ ] lance de cada grupo × lance anotado × lance sugerido
[ ] impressões, cliques, CTR
[ ] custo, compras, vendas, ROAS
[ ] CPC real vs lance
```

### Duas armadilhas do console, já pagas

- **`get_page_text` lê o DOM e NÃO recarrega.** Sempre `navigate` antes. Duas leituras com
  5h de diferença devolveram números idênticos ao centavo.
- **O editor de lance só abre com `triple_click`.** Clique simples só seleciona a linha, e
  o que você digitar se perde em silêncio. Conferir por screenshot antes de salvar.

---

## Fonte de dados

**Hoje: navegador.** A Amazon Ads API foi solicitada em 13/08/2026 como Direct
Advertiser e ainda não foi aprovada. Enquanto isso, a leitura é pela extensão do
Chrome, na conta `admin@sellercore.test` / NEXAHUB BR.

**Como testar se a aprovação saiu, sem abrir o navegador** (10 segundos, não depende de
sessão nem de a vendedora estar logada):

```bash
CID=$(grep '^ADS_CLIENT_ID='    .env.local | cut -d= -f2- | tr -d '"\r')
RURI=$(grep '^ADS_REDIRECT_URI=' .env.local | cut -d= -f2- | tr -d '"\r')
curl -sS --compressed -o /tmp/ads-scope.html -w "HTTP %{http_code}\n" \
  "https://www.amazon.com.br/ap/oa?client_id=${CID}&scope=advertising::campaign_management&response_type=code&redirect_uri=${RURI}"
grep -o "bad-scope\|unknown scope\|invalid-parameter" /tmp/ads-scope.html | sort -u
```

| Resposta | Significa |
|---|---|
| `HTTP 400` + `invalid-parameter` · `bad-scope` · `unknown scope` | **ainda pendente** |
| Página de consentimento (HTTP 200, sem esses marcadores) | **aprovada** — seguir para o passo abaixo |

**Histórico do teste:**

| Data | Resultado |
|---|---|
| 13/08/2026 | pendente (solicitada neste dia) |
| 16/08/2026 ~11h50 | pendente |
| **16/08/2026 22h45** | **pendente** — `ADS_REFRESH_TOKEN` e `ADS_PROFILE_ID` seguem vazios no `.env.local` |
| **17/08/2026 23h05** | **pendente** — 4 dias após o pedido; o prazo indicado era 14/08 (sexta). 🔴 **Vencido: abrir caso no suporte de desenvolvedores.** |

### 2ª solicitação enviada em 17/08/2026, ~23h30

A 1ª (13/08) venceu o prazo sem resposta. Reenviada pela vendedora em
`advertising.amazon.com/partner-network/register-api`, categoria **Direct advertiser**.

**O que foi declarado** (guardar — se pedirem correção, é daqui que se parte):

| Campo | Valor |
|---|---|
| Razão social | `66.106.202 ANA BEATRIZ DE OLIVEIRA` |
| Site | `https://sellercore.onrender.com` |
| País / Nome da marca | Brasil · NEXAHUB BR |
| Relacionamento | *Vendedor da Amazon, e pretendo usar a API em meus negócios* |
| Escopo | Apenas **Publicidade** (não marcar "Provedor de dados" — exige avaliação maior) |

⚠️ **A razão social é o campo que reprova.** É "CNPJ + nome da titular", porque é
empresário individual — **não existe nome fantasia registrado**. Foi exatamente escrever
"NEXAHUB" aqui que reprovou duas categorias no TikTok.

**O que mudou em relação à 1ª:** os dois campos de texto livre passaram a descrever a
operação concreta (6 campanhas no ar, integração com custo e tarifa já no sistema, e os
quatro processos a automatizar) em vez de descrição genérica. É a única variável sob nosso
controle.

⚠️ **Preencher esse formulário por automação NÃO funciona** — a digitação não entra nos
campos (React re-renderiza) e o renderizador chegou a travar. Passar os valores prontos
para ela colar. É formulário legal: um campo errado custa semanas.

**Próximo passo se não sair até ~24/08:** abrir caso no suporte de desenvolvedores. Foi o
que moveu a candidatura do Solution Provider.

⚠️ O prazo que ela mencionou era **17/08**. Se passar disso sem aprovação, vale abrir caso
no suporte de desenvolvedores em vez de continuar esperando — foi o que destravou (ou
pelo menos moveu) a candidatura do Solution Provider.

**Depois da aprovação:** conferir se `.env.local` tem `ADS_REFRESH_TOKEN` e
`ADS_PROFILE_ID` preenchidos. Se tiver, usar a API (`scripts/ads-profiles.mjs` já
resolve o profile) e parar de depender do navegador.

### Caminho no navegador

A sessão de anúncios cai com frequência se outras abas da Amazon forem usadas. O
caminho que funciona é **sempre pelo Seller Central**, nunca direto:

```
https://sellercentral.amazon.com.br/cm/ref=xx_cmpmgr_dnav_xx?source=ngs
```

Ele redireciona para `advertising.amazon.com.br/campaign-manager/all-campaigns`
já com a entidade certa. Ir direto na URL de anúncios devolve tela de registro.

Depois: rolar até a tabela, e **rolar a tabela para a direita** — as colunas de
Cliques, CTR, Custo, CPC, Compras e Vendas ficam fora da área visível. A coluna
`Impressões` só aparece se tiver sido adicionada em *Colunas → Personalizar*.

Para ver **hoje**, trocar o "Intervalo de datas" do topo para `Hoje` — o padrão do
cartão de resumo e o da tabela são diferentes e isso já gerou leitura errada.

### O rótulo de status mudou

A Amazon mostra **"Em inserção"**, não "Em veiculação". O tooltip diz: *"Sua campanha
está sendo inserida. Os anúncios dessa campanha com status 'Funcionando' estão
qualificados para impressões."* — **é veiculação normal, não é problema.** Confirmado em
13/08/2026. Não tratar como campanha parada; confirmar por impressão acumulando.

### Quando TODA rota do console dá 404 (visto em 16/08/2026)

Sintoma: o console de Ads **carrega** — barra `amazon ads`, menu lateral, rodapé — mas
qualquer rota devolve **"Página não encontrada"**. E o `entityId` some da URL depois da
primeira navegação.

Tentado, tudo falhou:

| Caminho | Resultado |
|---|---|
| `sellercentral.amazon.com.br/cm/ref=xx_cmpmgr_dnav_xx?source=ngs` | **Erro interno** |
| `advertising.amazon.com.br/campaign-manager/all-campaigns?entityId=ENTITY16D5M3ZYVBEMC` | 404 |
| Link "Campanhas" no topo | 404 |
| Ícone de campanhas na lateral | 404 |

**Não é sessão caída** (aí viria tela de login) **nem falta de permissão** (aí viria tela
de registro). Os RIDs mudam a cada tentativa, então a requisição chega na Amazon e é ela
que responde 404.

**Confirmado que não é a automação:** a vendedora abriu no navegador dela e deu o mesmo
404. E `status.ads.amazon.com` dizia **"No known issues"** no mesmo minuto — o status
oficial não cobre esse tipo de quebra.

**O que fazer:** não insistir. Registrar a tentativa, avisar, e sugerir trocar a entidade
pelo seletor de conta (ícone de pessoa, canto superior direito) antes de tentar de novo.
A leitura fica pendente — e leitura pendente **não vira conclusão**: não inventar número
nem repetir o da véspera como se fosse de hoje.

### Quando o painel avisa de falha nos relatórios

Se aparecer a tarja *"Estamos investigando uma interrupção temporária em nossos
relatórios"*, **nenhuma métrica ausente é fato**. Zero clique e zero compra podem ser
dado que não chegou. Ler mesmo assim, mas **não concluir e não agir** — registrar a
leitura marcada como parcial e reolhar depois que a Amazon avisar que normalizou.

## O que ler, por campanha

Impressões · Cliques · CTR · Custo · CPC · Compras · Vendas.

Registrar sempre junto: **data e hora da leitura**, porque a conclusão depende do
tempo decorrido, não só do número.

## Como concluir

Aplicar nesta ordem e parar na primeira que casar:

| Sinal | Conclusão |
|---|---|
| Campanha parada, ou anúncio inativo | **Investigar** — veiculação parada, nada mais importa |
| Impressões praticamente zero há 2+ dias | **Agir** — lance baixo demais para entrar no leilão |
| Gasto encostando em 50%+ do orçamento diário | **Agir** — o teto virou o limitador; subir orçamento |
| 500+ impressões e 0 clique | **Investigar** a página: preço, imagem principal, título |
| Cliques acumulando e 0 venda com 15+ cliques | **Investigar** a página do produto, não o anúncio |
| Termo com 3+ pedidos no relatório de busca | **Agir** — migrar para manual exata + negativa **exata** na automática |
| Termo com 10+ cliques e 0 pedido | **Agir** — negativa exata |
| Nada acima | **Esperar** e dizer em quantos dias vale reolhar |

Volume mínimo para o CTR dizer algo: **~500 impressões**. Abaixo disso, não
concluir nada sobre CTR — dizer explicitamente que é ruído.

## Contexto que muda a leitura

- **A operação está em fase de ranqueamento.** O preço atual é de entrada e sobe
  quando as vendas começarem. Não avaliar cada clique como se tivesse que se pagar
  hoje; o objetivo é velocidade de venda para o BSR.
- **A tarifa da Amazon está zerada** por promoção temporária de vendedor novo
  ("O FBA agora é GRÁTIS"). As margens abaixo já refletem isso e **mudam quando a
  promoção acabar** — reconferir antes de decidir lance com base em margem.
- **Cupom não aparece na Pricing API.** O preço que a API devolve é o cheio; o
  praticado é menor. Usar o valor do pedido, nunca o do anúncio, para margem.

### Margens (atualizado 15/08/2026, taxa zero)

| Produto | Recebe | Custo | Margem |
|---|---|---|---|
| **martelo-borracha** | **R$ 31,90** · ~R$ 28,71 c/ cupom | R$ 5,84 | R$ 26,06 · R$ 22,87 c/ cupom |
| kit-clips-320 | R$ 22,11 · R$ 19,90 c/ cupom | R$ 6,82 | R$ 15,29 · R$ 13,08 c/ cupom |
| kitprote-8 | R$ 22,11 | R$ 9,57 | R$ 12,54 |

⚠️ **O cupom de 10% (09/08–08/09) só desconta se o comprador resgatar.** O pedido de
08/08 do clips saiu a R$ 19,90 sem promoção porque era o preço antigo; o de 15/08 saiu a
R$ 22,11 **cheio** — ninguém resgatou. Não assumir o preço com cupom ao calcular margem:
usar o valor do pedido.

### De onde veio a estrutura — e onde o material acaba

A conta foi montada a partir do deck **"A Máquina de Compras: como dominar os Ads da
Amazon"** (Rafael Lavall / AME), 12 slides — `~/Downloads/MVP_Amazon_Slides.pptx.pdf`.
Lido por inteiro em 14/08/2026.

**O que o deck cobre:** o que é Ads; para que serve (primeiras vendas, ranqueamento,
visibilidade); automática × manual; os três tipos de correspondência; e a estrutura de
**1 automática + 1 manual com grupo Exata e grupo Frase, por produto** — que é
exatamente a configuração no ar.

Ele acerta no enquadramento principal: **Ads como ferramenta de ranqueamento**, não de
lucro imediato. É o que sustenta aceitar ACOS de 30–60% nesta fase.

⚠️ **O deck monta a conta e para onde a operação começa.** Seis lacunas, todas com
efeito prático aqui — o aprofundamento está em
[`docs/amazon-ads-especialista.html`](../../../docs/amazon-ads-especialista.html):

1. **Negativas — a mais grave.** Não são mencionadas uma vez. A estrutura do deck
   *exige* negativa exata na automática: automática e manual carregam as mesmas palavras
   e, sem ela, leiloam entre si e encarecem o próprio clique.
2. **A colheita.** O deck diz que a automática "descobre", mas não diz o que fazer com o
   achado. O ciclo (3+ pedidos → promove a exata → negativa exata na automática) é o
   motor da conta e está ausente.
3. **Orçamento é da campanha, não do grupo.** Exata e Frase moram na mesma campanha
   manual e **dividem os R$ 10/dia**. Não é erro — é o desenho recomendado — mas muda
   como ler o número de cada grupo.
4. **Empilhamento de lance.** Ajuste de posicionamento e lance dinâmico se multiplicam.
   A conta está em 0% e "somente redução", que é o certo — mas por configuração, não
   porque o material avisou.
5. **Janela de atribuição.** 7 dias para SP, e tudo dos últimos 28 dias é provisório.
   Sem isso, zero de hoje é lido como fracasso quando pode ser dado não atribuído.
6. **Métricas.** O deck não traz nenhuma. Sem ACOS × TACOS × CVR não há como dizer se
   está funcionando.

**Consequência para a rotina:** o primeiro relatório de termos de busca é o ponto em que
o deck acaba e a operação começa. Não assumir que "está montado" significa "está
completo".

## Mudança aplicada em 15/08/2026 — preço do martelo

**R$ 43,22 → R$ 31,90.** `PATCH /listings/2021-08-01` · `ACCEPTED` ·
submissionId `e3220815c4ab4982b5743e5bc58b6e20` · productType `HAMMER_MALLET`.
Com o cupom de 10% ativo, o efetivo fica em ~R$ 28,71. **Decisão dela:** manter o cupom;
o objetivo é destravar as primeiras vendas, e o preço sobe depois.

### Por que — a campanha não era o problema

Comparação de preço via `competitiveSummary` nos ASINs do topo orgânico de
"martelo de borracha" (15/08):

| Anúncio | Menor preço |
|---|---|
| **O nosso** (B0HBGQNBD4) | **R$ 43,22** |
| Vonder 40mm cabo madeira | R$ 12,89 |
| MTX 225g | R$ 15,07 |
| YIYITOOLS | R$ 16,27 |
| MTX 225g (outro) | R$ 17,73 |
| Vonder 45mm cabo fibra | R$ 28,00 |
| MTX preto/branco | R$ 31,87 |
| Vonder 50mm cabo fibra | R$ 34,90 |

Era **o mais caro dos oito, 3,4× o Vonder de 40 mm** — produto equivalente. Com 12,39%
de participação no topo da busca e CTR de 0,30%, o anúncio **aparecia e não era
clicado**: problema de oferta, não de lance nem de termo.

📌 **Lição:** antes de otimizar campanha, conferir se o preço está no mercado. Otimizar
com preço fora da faixa é pagar para ser ignorado mais rápido.

### Relatório de termos do Auto - Martelo (15/08)

Uma linha só:

| Termo | Correspondência | Custo | Compras |
|---|---|---|---|
| `martelo` | aproximada | R$ 8,90 | — |

**R$ 8,90 dos R$ 10,94 da campanha foram para a palavra mais genérica da categoria.**
Quem busca "martelo" quer martelo de unha ou marreta. O rodapé da tela avisa que só
aparecem termos **com clique** nos últimos 65 dias — então esse foi o único que gerou
clique. Os ~R$ 2,04 restantes provavelmente vieram de segmentação por produto, que não
conta como termo de busca.

**Negativar `martelo` em exata é a próxima alavanca** — mas só depois de o preço novo
propagar. Com preço fora do mercado, o termo certo também não converteria.

### O que observar agora

A propagação da oferta leva **~2h**. A pergunta que o preço novo responde é uma só:
**o CTR sai de 0,30%?**

- **Subiu** → era preço; a campanha volta a fazer sentido e a colheita segue.
- **Continuou em 0,30%** → é imagem principal ou título, e aí a negativa do termo vira
  a alavanca seguinte.

Reolhar em **2 dias**, para dar tempo de propagar e acumular impressão nova.

## Preço do martelo: R$ 31,90 → R$ 27,90 (16/08/2026, ~12h20)

`PATCH /listings/2021-08-01` · `ACCEPTED` · submissionId `1d5af093f66545e0872d3675f569c9eb`
· productType `HAMMER_MALLET`. Segunda queda em dois dias (era R$ 43,22 em 14/08).

Margem em R$ 27,90: recebe 27,90, custo 5,84 → **R$ 22,06**.

### ⚠️ Erro meu que ela corrigiu: comparar preço sem comparar tamanho

Eu montei a tabela de concorrentes de "martelo de borracha" e concluí que estávamos caros
**sem checar o tamanho de nenhum deles**. Ela apontou: *"são tamanhos diferentes, meu
nobre"*. Estava certa.

**Especificação real do nosso** (`B0HBGQNBD4`, via `catalog/2022-04-01` com
`includedData=attributes,dimensions`):

```
cabeça 7,5 x 24,5 cm · 250 g · cabo de madeira · cabeça maciça preta
```

Com isso a comparação **fica ambígua, não conclusiva**:

- **Por peso (250 g):** o comparável é o MTX 225g, a **R$ 15,07 e R$ 17,73** — cerca de
  metade do nosso preço. Sugere que estamos caros.
- **Por cabeça (75 mm):** seríamos o maior de todos (Vonder vai até 50 mm a R$ 34,90).
  Sugere que estamos baratos.

Não dá para resolver sem specs dos concorrentes, que a API não devolve para ASIN de
terceiro.

📌 **Regra:** comparação de preço só vale entre produtos **equivalentes**. Puxar
`competitiveSummary` de uma busca por palavra-chave mistura tamanhos, materiais e
quantidades. Antes de concluir "estamos caros", checar `attributes` e `dimensions` do
nosso e conferir se o concorrente é do mesmo porte — pelo título, no mínimo.

### O que continua verdade, independente do tamanho

- **Zero avaliação.** Martelo de borracha é commodity; sem prova social, perde para marca
  conhecida no empate.
- **Sem marca** (Genérico, por política dela) contra Vonder e MTX, estabelecidas.
- **BSR vazio** — o produto ainda não tem posição de vendas na categoria.
- **Manual com 2,72% de CTR e zero venda em 7 cliques.** O anúncio funciona; a parada é
  na página. Preço é a alavanca que temos; avaliação é o gargalo real.

### O teste

Uma semana em R$ 27,90. Se não vender com CTR de 2,72%, o preço está descartado como
causa e a conversa vira prova social (Vine, ou aceitar prejuízo nas primeiras unidades).

## Mudanças aplicadas em 16/08/2026, ~12h05

Confirmadas por ela e verificadas na tela depois de salvar.

**1. `martelo` → Exata negativa na `Auto - Martelo Borracha`** (`A09902661J0ZF8TYDHJC8`).
A lista de palavras-chave negativas estava **vazia**; agora tem 1. Caminho:
campanha → *Segmentação negativa* → *Adicione palavras-chave negativas* (o tipo
"Exata negativa" já vem selecionado por padrão).

Motivo: o relatório de termos de 15/08 mostrou **R$ 8,90 de R$ 10,94 indo para `martelo`**,
a palavra mais genérica da categoria.

**2. `Auto - Protetor Kit 8` (`A06494282F1XLCQPDJD30`): orçamento R$ 10 → R$ 5/dia.**
Campanha **continua ativa**. Caminho: campanha → *Configurações da campanha* → campo
Orçamento (o texto no cabeçalho não é editável; só o campo da aba de configurações).

### Por que reduzir em vez de pausar — e por que NÃO era a página

Ela perguntou se pausar ajudava. Três medições disseram que não:

- **CTR de 0,76%** — o segundo melhor da conta, mais que o dobro do piso de 0,3%.
  As pessoas clicam.
- **Preço competitivo.** `competitiveSummary` no ASIN `B0H9SFW8KR` contra o topo da busca
  de "protetor de pes de cadeira silicone": somos o **segundo mais barato de seis**
  (R$ 22,11, contra R$ 20,99 do primeiro e R$ 29,90–R$ 83,90 dos outros quatro). Nada a
  ver com a armadilha do martelo, que era 3,4× o concorrente equivalente.
- **21 cliques não condenam.** Com conversão saudável de 10%, sair zero venda tem ~11%
  de chance só por azar. Não é evidência suficiente.

📌 **Regra:** antes de pausar por "não vende", checar CTR e preço. CTR bom + preço no
mercado + amostra pequena = reduzir e continuar medindo, não matar.

### Quando decidir o destino da Auto - Protetor

**~45 cliques.** Nesse ponto, zero venda tem menos de 1% de chance de ser azar — aí é
conclusão. No ritmo atual (21 cliques em 5 dias, agora com metade do orçamento), são
~10 dias.

### Próxima leitura

Filtrar a tabela em **15–16/08** para isolar o efeito da queda de preço do martelo
(R$ 43,22 → R$ 31,90 em 15/08). O CTR vitalício de 0,22% inclui os dias anteriores à
mudança e não responde a pergunta.

## Leitura de 16/08/2026, 22h36 — dia fechado, filtro **só hoje** — ⏳ ESPERAR

Ela aplicou o filtro de data no console (`16 de ago de 2026`), que é o que faltava para
isolar o efeito das duas mudanças do meio-dia. Números abaixo são de **carregamento novo
às 22h36**, com o dia praticamente encerrado.

| Campanha | Impr. | Cliques | CTR | Custo | Status |
|---|---|---|---|---|---|
| **Auto - Martelo Borracha** | **2.056** | 2 | **0,10%** | R$ 2,57 | Em inserção |
| **Manual - Clips 320** | 804 | 1 | **0,12%** | R$ 0,34 | Em inserção |
| Auto - Protetor Kit 8 | 577 | 5 | 0,87% | R$ 5,28 | **Orçamento excedido** |
| Auto - Clips 320 | 481 | 2 | 0,42% | R$ 1,21 | Em inserção |
| Manual - Protetor Kit 8 | 245 | — | — | — | Em inserção |
| **Manual - Martelo Borracha** | 59 | 4 | **6,78%** | R$ 3,23 | Em inserção |
| **Total** | **4.222** | **14** | **0,33%** | **R$ 12,63** | |

**Compras hoje: zero. Vendas hoje: zero.** Confirmado por ela: nenhum produto vendeu
hoje, orgânico incluído — não é buraco de atribuição de um SKU só.

### ⚠️ `get_page_text` lê o DOM, não recarrega a página

Uma leitura anterior no mesmo dia devolveu **os mesmos números até o centavo**. Não era o
dia ter parado — era a aba estar com o render antigo. **Sempre `navigate` na URL antes de
`get_page_text`** quando a aba já estiver aberta há tempo, senão a "leitura de agora" é
uma foto de horas atrás. Depois do `navigate`, a primeira leitura volta `loading`; ler de
novo.

### 🔑 O que fecha com o dia e o que não fecha

Erro meu que ela cobrou ("são 22h36, final do dia sim, não dá pra concluir nada mesmo?").
Eu tinha juntado métricas que fecham em prazos diferentes:

| Fecha com o dia | Não fecha com o dia |
|---|---|
| Impressão, clique, CTR, gasto | **Compras e vendas** |

O rodapé da própria tela diz: *"atribuição de conversão baseada na data do tráfego"*. A
venda é creditada na data do **clique**, com janela de 7 dias. Um clique das 19h de hoje
que converta na terça cai **na linha de hoje**, retroativamente. A linha de 16/08 só para
de mudar em **23/08**.

📌 **Regra:** "o dia acabou" nunca fecha venda no relatório de Ads. Fecha gasto e CTR —
e é sobre esses que dá para concluir no mesmo dia.

### 🔴 Achado novo: a Manual - Clips desabou — e é a campanha que vendeu

```
até 15/08   1.921 impr. / 16 cliques = 0,83%
16/08         804 impr. /  1 clique  = 0,12%
```

Impressões quase dobraram o ritmo diário enquanto o CTR caiu **7×**. Com 804 impressões
está **acima do limiar de 500**, então é conclusão, não ruído.

Mesma assinatura da Auto - Martelo (comprar impressão em consulta errada), mas numa
campanha **manual** — o que aponta para o **grupo de Frase abrindo demais**, já que Exata
não tem como alargar sozinha.

**Próximo passo:** puxar o relatório de termos de busca da `Manual - Clips 320` e achar o
termo que absorveu as 804 impressões, antes de propor negativa. Não mexer em palavra-chave
sem confirmar com ela.

### ✅ A pergunta do preço está respondida: era preço

Trajetória do CTR da **Manual - Martelo**, a única campanha do produto com termos
escolhidos à mão:

```
14/08  R$ 43,22   1,27%
vital. (mistura)  2,53%
16/08  R$ 27,90   6,78%   ← 22× o piso de 0,3% dos benchmarks
```

⚠️ **59 impressões está muito abaixo do limiar de 500** — o número exato não vale. Mas
nenhuma leitura anterior chegou perto disso, e a direção é inequívoca. Preço **descartado
como causa** do problema do martelo.

📌 O que isso fecha: o funil do martelo tem atenção (CTR) e não tem conversão. Com preço,
anúncio e página já testados, **o que sobra é prova social** — zero avaliação num produto
commodity sem marca. A próxima alavanca é Vine, não Ads.

### A negativa ainda não dá para avaliar

`martelo` entrou como exata negativa às ~12h05, então **metade do dia ainda é do
casamento antigo**. A Auto - Martelo fez 2.056 impressões hoje para 2 cliques (0,10%, o
pior da conta) — mesmo produto, mesmo preço, mesma página que a manual de 6,78%. O
contraste de 67× reforça que o problema é o casamento de termos, mas o efeito limpo da
negativa só aparece em **17/08**.

### Zero venda hoje ainda não é sinal

Três motivos para não agir:

1. **14 cliques.** Com conversão saudável de 10%, o esperado é ~1,4 venda; sair zero tem
   ~23% de chance só por azar.
2. **Atribuição de 7 dias.** Venda de hoje pode aparecer amanhã ou depois. Zero de hoje
   nunca é fato no mesmo dia.
3. **O dia não fechou** — leitura de ~17h30.

O gatilho de "15+ cliques e zero venda" é **vitalício** (59 cliques, 4 compras), e esse
já disparou e já foi tratado.

### Orçamento: o corte funcionou

`Auto - Protetor` gastou **R$ 5,28** no teto de R$ 5/dia — bateu no limite, como
desenhado. 5 cliques hoje, acumulando para a decisão dos ~45 cliques.

### Ritmo do crédito

**R$ 12,63 num dia**, contra os R$ 11,80/dia necessários para consumir os R$ 1.060 em 90
dias. Primeiro dia acima do alvo.

## Leitura de 16/08/2026, ~11h50 — 🔴 AGIR

Período: **Vitalício** (desde 12/08). Console voltou depois de ~1h fora do ar (404 em
toda rota). Sem tarja de interrupção — números confiáveis.

| Campanha | Impr. | Topo busca | Cliques | CTR | Custo |
|---|---|---|---|---|---|
| **Auto - Martelo Borracha** | **3.605** | **12,40%** | 8 | **0,22%** | **R$ 15,48** |
| Auto - Protetor Kit 8 | 2.750 | <5% | 21 | 0,76% | R$ 21,99 |
| Manual - Clips 320 | 2.211 | <5% | 16 | 0,72% | R$ 7,08 |
| Auto - Clips 320 | 880 | <5% | 1 | 0,11% | R$ 0,40 |
| **Manual - Martelo Borracha** | 257 | **22,57%** | 7 | **2,72%** | R$ 5,09 |
| Manual - Protetor Kit 8 | 295 | <5% | 1 | 0,34% | R$ 0,90 |
| **Total** | **9.998** | | **54** | **0,54%** | **R$ 50,94** |

**Compras: 4 · Vendas: R$ 88,44** (vitalício, do gráfico). ROAS 1,74 · **ACOS 57,6%** —
no teto da faixa de lançamento.

⚠️ **Não obtive Compras/Vendas por campanha** — a sessão caiu ao rolar a tabela para a
direita. O total é do gráfico de desempenho, não da soma das linhas.

### 🔑 O achado que muda a leitura anterior

**Mesmo produto, mesma página, mesmo preço — CTR 12× diferente:**

```
Manual - Martelo   2,72% CTR   22,57% do topo da busca
Auto  - Martelo    0,22% CTR   12,40% do topo da busca
```

Em 14/08 concluí que "aparece no topo e não é clicado → o problema é a oferta". **Isso
está desmentido.** Quando as palavras são escolhidas à mão, o anúncio é clicado a 2,72%
— quase 10× o piso de 0,3% dos benchmarks. A página converte atenção.

**O problema é o casamento de termos da automática.** Ela compra impressão em consulta
errada: 3.605 impressões (a maior da conta) para 8 cliques, gastando R$ 15,48 — 30% de
todo o gasto — com o pior CTR das seis.

Isso confirma com dado o que o relatório de termos de 15/08 já sugeria: **R$ 8,90 de
R$ 10,94 foram para a palavra `martelo`**, a mais genérica da categoria.

### O preço não dá para isolar ainda

A queda de R$ 43,22 → R$ 31,90 foi em 15/08. Este CTR é **vitalício**, então dilui os
dias anteriores à mudança. Para responder "o preço resolveu?" é preciso filtrar
**15–16/08** na tabela — ficou pendente porque a sessão caiu.

### Conclusão: AGIR — negativar `martelo` em exata na Auto - Martelo

Dispara o gatilho de "termo com 10+ cliques e 0 pedido"? Ainda não pelo termo isolado,
mas o conjunto é mais forte que o gatilho: **maior volume de impressão da conta, pior
CTR, 30% do gasto, e a manual do mesmo produto provando que o problema não é a página.**

Depende de confirmação dela (regra: não mexer em palavra-chave sem confirmar).

### O que melhorou muito

| | 14/08 | 16/08 |
|---|---|---|
| Impressões | 2.213 | **9.998** |
| Cliques | 10 | **54** |
| Gasto | R$ 10,79 | **R$ 50,94** |
| Compras | 1 | **4** |
| Vendas | R$ 22,11 | **R$ 88,44** |

**Ritmo do crédito destravou.** R$ 50,94 em ~5 dias ≈ **R$ 10,19/dia**, contra R$ 3,60/dia
em 14/08. O necessário para os R$ 1.060 em 90 dias é ~R$ 11,80/dia — de 1/3 do alvo para
86% dele. Se o ritmo se mantiver, chega em ~R$ 917; acelerando um pouco, fecha.

### Auto - Clips 320 em observação

880 impressões, **1 clique, 0,11% CTR** — o pior da conta. Mas gastou R$ 0,40, então não
é urgente. A manual do mesmo produto vai bem (0,72%, 16 cliques). Mesmo padrão do martelo:
automática comprando impressão ruim. Vigiar; se passar de R$ 5 sem clique, negativar.

## Leitura de 14/08/2026 — ⚠️ PARCIAL · 🎉 PRIMEIRA VENDA

**A tarja de interrupção nos relatórios continua no ar — segundo dia.** Números ainda
provisórios. Período: 15 jul – 14 ago (na prática, desde o lançamento em 12/08).

| Campanha | Impr. | Topo busca | Cliques | CTR | Custo | CPC | Compras | Vendas | ROAS |
|---|---|---|---|---|---|---|---|---|---|
| Auto - Martelo Borracha | 741 | 7,76% | 2 | 0,27% | R$ 4,75 | R$ 2,38 | 0 | — | — |
| Auto - Protetor Kit 8 | 544 | <5% | 3 | 0,55% | R$ 3,30 | R$ 1,10 | 0 | — | — |
| **Manual - Clips 320** | 512 | <5% | 3 | 0,59% | R$ 1,29 | R$ 0,43 | **1** | **R$ 22,11** | **17,14** |
| Auto - Clips 320 | 169 | <5% | 0 | — | — | — | 0 | — | — |
| Manual - Protetor Kit 8 | 168 | <5% | 1 | 0,60% | R$ 0,90 | R$ 0,90 | 0 | — | — |
| Manual - Martelo Borracha | 79 | 15,89% | 1 | 1,27% | R$ 0,55 | R$ 0,55 | 0 | — | — |
| **Total** | **2.213** | | **10** | **0,45%** | **R$ 10,79** | **R$ 1,08** | **1** | **R$ 22,11** | **2,05** |

ACOS da conta: **48,8%** — dentro da faixa de lançamento (30–60%).

**Conclusão: esperar.** Nenhum gatilho da tabela de decisão dispara.

### O que mudou desde 13/08

Impressões 1.243 → 2.213. Cliques 5 → 10. Gasto R$ 6,12 → R$ 10,79. **Compras 0 → 1.**

### 🔴 Auto - Martelo cruzou o limiar — e a leitura é ruim

**741 impressões** (passou das ~500), CTR **0,27%**. É a primeira campanha em que o CTR
é estatisticamente legítimo, e ele está **abaixo do piso de 0,3%** dos benchmarks 2026.
Consome **R$ 4,75 — 44% de todo o gasto da conta** — e não vendeu.

**E desta vez a posição está descartada com dado, não com vitrine:** a coluna *Parcela de
impressões no topo da pesquisa* apareceu, e o martelo é justamente quem mais aparece no
topo (Auto 7,76%, Manual 15,89%, contra <5% em todas as outras). **Aparece no topo e
mesmo assim não recebe clique** → o problema é a oferta (imagem principal, título, preço
exibido), não o lance nem a posição.

**Contraste que reforça:** mesmo produto, Manual 1,27% de CTR contra Auto 0,27%. As
palavras escolhidas à mão atraem ~5× melhor que o que a automática está casando — indício
de que a automática pega termo ruim. Volume ainda baixo (79 impressões na manual), então
é para **vigiar**, não agir. Matéria da colheita.

### Pergunta em aberto

**R$ 22,11 é ambíguo:** é o preço cheio do `kit-clips-320` **e** o preço do `kitprote-8`.
A campanha era do clips, mas Sponsored Products atribui venda de outros SKUs do vendedor
(*halo*). Resolver no **relatório de Produto comprado** antes de concluir qual produto
vendeu. Se for clips a R$ 22,11, o comprador não resgatou o cupom.

### Ritmo do crédito

R$ 10,79 em ~3 dias ≈ R$ 3,60/dia. Para os R$ 1.060 em 90 dias seriam ~R$ 11,80/dia.
Segue em ~1/3 do necessário.

## Leitura anterior (13/08/2026, noite) — ⚠️ PARCIAL

**O painel estava com a tarja de interrupção nos relatórios.** Estes números podem
estar incompletos; "0 compras" **não é fato**. Reolhar depois que normalizar.

Período do relatório: 14 jul – 13 ago (na prática, desde o lançamento).
Seis campanhas, todas veiculando ("Em inserção"), R$ 70/dia de teto.

| Campanha | Impr. | Cliques | CTR | Custo | CPC | Compras |
|---|---|---|---|---|---|---|
| Auto - Martelo Borracha | 368 | 1 | 0,27% | R$ 2,95 | R$ 2,95 | 0 |
| Auto - Protetor Kit 8 | 289 | 2 | 0,69% | R$ 2,04 | R$ 1,02 | 0 |
| Manual - Clips 320 | 277 | 1 | 0,36% | R$ 0,58 | R$ 0,58 | 0 |
| Auto - Clips 320 | 166 | 0 | — | — | — | 0 |
| Manual - Protetor Kit 8 | 84 | 0 | — | — | — | 0 |
| Manual - Martelo Borracha | 59 | 1 | 1,69% | R$ 0,55 | R$ 0,55 | 0 |
| **Total** | **1.243** | **5** | **0,40%** | **R$ 6,12** | **R$ 1,22** | **0** |

**Conclusão: esperar.** Nada na tabela de decisão dispara. Reolhar em 2 dias, ou antes
se a Amazon avisar que os relatórios normalizaram.

### O que essa leitura já respondeu

**A subida de lance funcionou.** 195 → 1.243 impressões. Era a pergunta em aberto do
estado anterior, e está respondida: o lance de R$ 0,35 é que estava fora do leilão.

### O que ficou em observação (não agir ainda)

- **CTR do Auto - Martelo em 0,27% com 368 impressões.** Abaixo das 500 do limiar, então
  ainda é ruído. **Não pular para "é a página"** — sem o relatório de posicionamento não
  se sabe se o anúncio aparece no topo ou no rodapé da busca, e CTR de rodapé é baixo por
  natureza. Ver a ressalva de posição abaixo.
- **Ritmo do crédito.** R$ 6,12 em ~2 dias ≈ R$ 3/dia. Para destravar os R$ 1.060 em 90
  dias seriam necessários ~R$ 11,80/dia. No ritmo atual chega em ~R$ 275 e cai num degrau
  bem menor. Se em uma semana não acelerar, vira decisão consciente, não acidente.

### ⚠️ Não medir posição de anúncio pelo navegador

Em 13/08 os dois produtos apareceram como **1º card patrocinado** na vitrine
(`martelo-borracha`/B0HBGQNBD4 e `kitprote-8`/B0H9SFW8KR, ASINs cruzados contra o
inventário FBA). **Concluir "visibilidade está boa" a partir disso foi erro.**

Por quê: a sessão estava **logada na conta da própria vendedora**, que visita essas
páginas o tempo todo. O leilão de Sponsored Products usa sinal de usuário — o que se viu
foi provavelmente **retargeting**, não posição de mercado.

O número do próprio painel desmente a leitura: **368 impressões em ~2 dias** (~180/dia)
é pequeno demais para quem estivesse ganhando o topo de um termo com esse volume de
busca.

**Regra:** posição de anúncio não se mede abrindo a vitrine. Se a pergunta for "onde meu
anúncio está aparecendo", usar o **relatório de posicionamento** do console de Ads, que
separa *Topo da busca (primeira página)* de *Restante da busca* e *Páginas de produto* —
e a coluna **Parcela de impressão**, que hoje está em `—` nas seis campanhas.

O que **continua válido** da observação: nos dois termos o produto **não aparece em
nenhum dos 48 resultados orgânicos** da página 1. Ausência do orgânico é observável sem
depender de leilão — o tráfego hoje é comprado.

### Estado anterior (13/08/2026, ~17h) — ponto de partida

| Campanha | ID | Lance | Orçamento |
|---|---|---|---|
| Auto - Martelo Borracha | `A09902661J0ZF8TYDHJC8` | R$ 0,84 | R$ 15 |
| Manual - Martelo Borracha | `A01357752UOKBP340AQ6T` | R$ 0,33–0,90 | R$ 10 |
| Auto - Clips 320 | `A09432513MF2JZKXFKXGB` | R$ 0,61 | R$ 15 |
| Manual - Clips 320 | `A01608831T9MN9I9KPAYF` | R$ 0,33–0,64 | R$ 10 |
| Auto - Protetor Kit 8 | `A06494282F1XLCQPDJD30` | R$ 1,29 | R$ 10 |
| Manual - Protetor Kit 8 | `A06695151U462T3OKRJIU` | R$ 0,33–1,30 | R$ 10 |

Impressões naquele momento: 195 no total, 1 clique, R$ 0,55 gastos. As três manuais
tinham acabado de nascer (13/08 ~17h) e levam até 1 hora para ficarem elegíveis.

`Ajuste de lance para o topo da pesquisa` continua em **0%** nas seis. Só mexer
nisso depois de o CTR provar que o anúncio converte; ele multiplica custo e compra
posição, não aprendizado.

### Ao ler os grupos Frase

Cada manual tem as **mesmas** palavras em exata e em frase. Se a frase gastar e a
exata não, o termo que converte é uma **variação** — pegar o termo real no
relatório de busca e promovê-lo a exata, em vez de subir o lance da frase inteira.

## Crédito de publicidade

Gastar R$ 1.060 em Sponsored Products destrava R$ 1.060 de crédito (degraus fixos —
gastar R$ 1.059 rende só R$ 265). O crédito aparece em até 2 semanas e **expira em
30 dias**. Acompanhar o gasto acumulado e avisar se o ritmo não chega lá dentro da
janela de 90 dias.

## Não fazer

- Não mexer em lance, orçamento ou palavra-chave **sem confirmar com a pessoa**.
- Não concluir sobre CTR com menos de ~500 impressões.
- Não sugerir ajuste de topo de busca antes de haver conversão.
- Não tratar posição baixa como problema em si — a configuração atual pede
  posições baratas de propósito.

## Mudanças aplicadas em 17/08/2026, ~01h00 — 🔴 o lance nunca tinha sido aplicado

Confirmadas na tela após recarregar a página.

### O achado

A `Auto - Martelo Borracha` (`A09902661J0ZF8TYDHJC8`, grupo `A06287301PN7DEPPLOE13`)
estava com **lance de R$ 3,00 nos quatro grupos de segmentação automática**, contra
**R$ 0,33 sugeridos pela Amazon** — 9× a sugestão.

⚠️ **O `docs/amazon-ads.md` dizia que este lance era R$ 0,84 desde 13/08.** Era falso: a
recalibração nunca pegou neste grupo. O grupo nasceu no default alto e ficou lá.

**Como o defeito foi encontrado — vale repetir o método:** calculando o CPC real
(custo ÷ cliques) de cada campanha e comparando com o lance registrado.

| Campanha | CPC real | Lance registrado | |
|---|---|---|---|
| Auto - Protetor | R$ 1,07 | 1,29 | ✅ |
| Manual - Martelo | R$ 0,76 | 0,90 | ✅ |
| Auto - Clips | R$ 0,55 | 0,61 | ✅ |
| Manual - Clips | R$ 0,48 | 0,33–0,50 | ✅ |
| **Auto - Martelo** | **R$ 1,92** | **0,84** | 🔴 2,3× |

Com dinâmico "somente redução" e ajuste de posicionamento em 0%, **o CPC nunca pode passar
do lance**. Cinco campanhas pagavam abaixo; uma pagava o dobro. Isso é sinal de que o lance
real não é o que está anotado — não de que o leilão está caro.

📌 **Regra nova:** conferir CPC real contra lance registrado a cada leitura. É um cálculo de
uma linha e pega divergência que nenhuma métrica de desempenho mostra.

### De onde vinha o tráfego

| Segmentação | Impressões | |
|---|---|---|
| **Substitutos** | **1.799** | 75% — e todo o custo |
| Correspondência aproximada | 575 | |
| Complementos | 9 | |
| Correspondência vaga | 7 | |

**Substitutos** coloca o anúncio na página de produtos **concorrentes**. Não é busca: é
quem já está olhando outro martelo.

Isso fecha o mistério das 7.481 impressões que a negativa de `martelo` (16/08) não
derrubou — **nunca foram de busca**. Também explica o relatório de termos com uma linha só:
segmentação por produto **não gera termo de busca**.

### O que foi aplicado

1. **Os quatro grupos: R$ 3,00 → R$ 0,50.** Sugestão era R$ 0,33; deixamos folga para não
   sair do leilão.
2. **Substitutos: pausado.**

### O que observar

- **CPC deve cair de ~R$ 1,92 para perto de R$ 0,40.**
- **Impressões devem despencar** (eram 43% da conta) — isso é o esperado, não é problema.
- Se a Auto - Martelo ficar com impressão ~zero por 2+ dias, R$ 0,50 ficou abaixo do piso;
  aí subir para dentro da faixa exibida.

### Caminho no console (para repetir nas outras campanhas)

A URL de campanha **não** é `/campaign-manager/campaign/<id>` (isso dá 404). É:

```
/cm/sp/campaigns/<campaignId>/ad-groups/<adGroupId>/targeting?entityId=<entityId>
```

Para achar o link certo sem adivinhar, rodar no console da lista de campanhas:

```js
[...document.querySelectorAll('a')].map(a=>a.textContent.trim()+' => '+a.getAttribute('href'))
```

⚠️ **O editor de lance só abre com `triple_click` na célula**; clique simples apenas
seleciona a linha e o que for digitado se perde em silêncio. Conferir por screenshot antes
de salvar, sempre.

## Auditoria campanha a campanha — 17/08/2026, ~01h30

Ela definiu a regra: **"quando falo pra você analisar, é pra ver as campanhas uma a uma"**.
Tabela agregada não basta — abrir cada campanha, cada grupo, cada lance.

### Lances reais vs. anotados

| Campanha / grupo | Lance real | Anotado | |
|---|---|---|---|
| Auto - Martelo (4 grupos) | R$ 3,00 → **0,50** | 0,84 | 🔴 corrigido |
| Auto - Clips (4 grupos) | R$ 0,61 | 0,61 | ✅ |
| Auto - Protetor | R$ 1,29 | 1,29 | ✅ |
| Manual Martelo · Frase | R$ 0,90 | 0,90 | ✅ |
| Manual Martelo · Exata | **R$ 0,98** | 0,90 | ⚠️ deriva |
| Manual Clips · Exata / Frase | R$ 0,33 / 0,50 | idem | ✅ |
| Manual Protetor · Exata / Frase | R$ 0,85 / 0,60 | idem | ✅ |

### Onde estão as vendas — só duas campanhas vendem

| Campanha | Compras | Vendas | ROAS |
|---|---|---|---|
| **Auto - Protetor Kit 8** | 2 | R$ 88,55 | **15,11** |
| **Manual - Martelo · grupo FRASE** | 1 | R$ 27,90 | **10,90** |
| outras quatro | — | — | — |

Somam exatamente os R$ 116,45 do card de resumo.

🎉 **O martelo vendeu a R$ 27,90** — o teste de preço está respondido. E veio pelo grupo
**Frase**, não pela Exata.

### 🔴 Erro meu: cortar o orçamento da campanha que mais vende

Em 16/08 recomendei baixar o orçamento da `Auto - Protetor` de R$ 10 → R$ 5, com o
argumento "21 cliques e zero venda". **Aqueles cliques estavam convertendo** — a
atribuição só não tinha fechado ainda.

Resultado: a melhor campanha da conta (ROAS 15,11) passou o dia inteiro presa em
"Orçamento excedido", recusando demanda.

📌 **A janela de 7 dias está escrita nesta skill e eu decidi contra ela.** "Zero venda"
numa campanha com cliques recentes **não é dado**: é dado que ainda não chegou. Antes de
cortar por não-conversão, exigir **janela fechada com 3 dias de folga do presente**.

📌 **Segundo aprendizado:** o gatilho de "45 cliques para concluir" mede a chance de azar,
mas **não protege contra atribuição pendente**. Os dois testes precisam passar juntos.

### Aplicado em 17/08 ~01h30

**`Auto - Protetor Kit 8`: orçamento R$ 5 → R$ 15/dia.** Confirmado no cabeçalho após
recarregar (`Orçamento: R$15,00 - Diariamente`). Decisão dela: "sobe pra 15".

Teto total da conta agora: **R$ 75/dia**.

### Caminho para mudar orçamento

```
/cm/sp/campaigns/<campaignId>/settings?entityId=<entityId>
```
Campo Orçamento → editar → **Salvar** (botão aparece ao lado do campo). O texto no
cabeçalho não é editável.

### O que observar amanhã

1. **Auto - Protetor** deve parar de bater no teto e escalar as vendas — é a única com
   ROAS provado.
2. **Auto - Martelo** deve cair de CPC ~R$ 1,92 para ~R$ 0,40, e perder muita impressão.
3. **Manual - Martelo Frase** é onde o martelo converte. A Exata (R$ 0,98) ainda não
   vendeu — candidata a revisão de termos.
4. **Manual - Clips** continua sem vender, com o CTR que desabou em 16/08. Puxar o
   relatório de termos dela.


## Mudança aplicada em 17/08/2026, ~23h50 — lance dos termos que convertem

Descoberto pelo cartão **"Analise os segmentos de melhor desempenho"** da tela de campanhas
(`Ver dados de segmentação filtrados`). Ele entrega o ciclo de colheita pronto: quais
termos venderam e quais gastaram sem vender, nos últimos 14 dias.

📌 **Usar esse cartão toda semana.** É a colheita do capítulo 17 do guia, pré-calculada
pela Amazon — e mostra as colunas de venda que a tabela de campanhas esconde fora da tela.

**Os 2 segmentos com vendas** (período 2–15/08):

| Termo | Grupo | CVR | ROAS | Lance antes | Lance agora |
|---|---|---|---|---|---|
| `clips` | Frase - Clips 320 | **25%** | 12,74 | R$ 0,70 | **R$ 1,50** |
| `clipe` | Frase - Clips 320 | **40%** | 22,00 | R$ 0,68 | **R$ 1,50** |

**Por que subir:** clips vende a R$ 22,11 com custo de R$ 6,82 → margem R$ 15,29.

| | CVR 25% | CVR 40% |
|---|---|---|
| CPC de equilíbrio | R$ 3,82 | R$ 6,12 |
| CPC para ACOS 30% | R$ 1,66 | R$ 2,65 |
| Pagávamos | R$ 0,70 | R$ 0,68 |

Estávamos pagando **menos de um quinto** do que o clique vale. Os dois estavam no lance
sugerido pela Amazon — e **a sugestão dela não conhece a nossa margem**.

📌 **Lição:** "lance sugerido aplicado" não quer dizer "lance certo". A sugestão otimiza o
leilão da Amazon, não o seu lucro. Sempre conferir contra o CPC de equilíbrio
(`node scripts/lance.mjs` na skill `gerenciar-ads`).

**O que observar:** volume deve subir bastante nos dois. Se o CVR se mantiver acima de 20%
com mais volume, dá para subir de novo — ainda há folga até R$ 3,82.

---

## Série consolidada — mudança × resultado (12–18/08/2026)

Ela cobrou, com razão: *"nossas alterações precisam ter embasamento"*. Eu vinha decidindo
sobre **fotos**, sem uma série. Esta tabela é o antídoto — **atualizar a cada leitura**.

### O que foi mudado

| Data | Mudança |
|---|---|
| 12/08 | 4 campanhas no ar, lance R$ 0,35 |
| 13/08 15h30 | Lances R$ 0,35 → sugestão da Amazon (0,61–1,29) |
| 13/08 17h | +2 campanhas manuais (6 no total) |
| 15/08 | Preço martelo R$ 43,22 → 31,90 |
| 16/08 12h05 | Negativa `martelo` na auto · orçamento Auto-Protetor 10 → 5 |
| 16/08 12h20 | Preço martelo 31,90 → **27,90** |
| 17/08 01h00 | Auto-Martelo: 4 grupos R$ 3,00 → **0,50** · Substitutos **pausado** |
| 17/08 01h30 | Orçamento Auto-Protetor 5 → **15** (revertendo erro meu) |
| 17/08 23h50 | `clips` e `clipe` (Frase) R$ 0,70/0,68 → **1,50** |
| 18/08 00h30 | Preços protetores: 16→37,90 · 24→51,90 · 32→59,90 |
| 18/08 ~01h | Campanha **Auto - Protetor Kit 32** criada (R$ 1,20 / R$ 10 dia) |
| 18/08 | kitprote-8 22,11 → **24,90** · back-end do kitprote-8 preenchido |
| 18/08 | `clips` e `clipe` (**Exata**) R$ 0,60/0,59 → **1,20** |

### O que aconteceu

| Dia | Impr | Cliq | CTR | Custo | Compras | Vendas | ACOS |
|---|---|---|---|---|---|---|---|
| 13/08 | 1.065 | 5 | 0,47% | 6,12 | — | — | — |
| 14/08 | 2.868 | 16 | 0,56% | 14,06 | 1 | 22,11 | 63,6% |
| 15/08 | 4.073 | 25 | 0,61% | 22,67 | 3 | 66,33 | 34,2% |
| 16/08 | 4.409 | 15 | 0,34% | 13,31 | — | — | — |
| 17/08 | 4.967 | 13 | 0,26% | 12,80 | 3 | 116,45 | 11,0% |
| 18/08* | 1.992 | 24 | **1,20%** | 25,34 | 2 | 44,22 | — |

\* parcial, atribuição aberta.

### As quatro relações de causa e efeito comprovadas

1. **Subir lance de R$ 0,35 (13/08)** — antes: 134 impressões em 19h. Depois: 1.065 →
   2.868 → 4.073. **Destravou a conta.** Sem isso não havia operação.
2. **Baixar preço do martelo (15–16/08)** — CTR da manual 1,27% → 2,72% → 6,56%.
   **Preço era a causa**, confirmado.
3. **Negativar `martelo` (16/08)** — gasto da Auto-Martelo de ~R$ 3,87/dia → ~R$ 1,22/dia.
4. **Cortar lance da Auto-Martelo (17/08)** — o efeito mais forte. O CTR da conta vinha
   **caindo** (0,61% → 0,34% → 0,26%) porque essa campanha despejava milhares de
   impressões não clicadas. Cortada, o CTR foi a **1,20%** — quatro vezes.

### O que nunca foi tocado (e é onde está o próximo ganho)

`Manual - Protetor 8` · `Manual - Martelo` · `Auto - Clips` — nenhuma ação nossa até hoje.

### 🔑 O padrão descoberto em 18/08: o piso do leilão

Quase toda palavra com lance **abaixo de ~R$ 0,70 não entrega nada**. Prova mais limpa,
as **mesmas 14 palavras** do Clips em dois grupos:

| Grupo | Lance | Impressões (18/08) |
|---|---|---|
| Frase · `clips` e `clipe` | R$ 1,50 | **803** |
| Frase · outras 12 | R$ 0,33–0,70 | 113 |
| Exata · todas as 14 | R$ 0,33–0,63 | **zero** |

Mesma palavra `clips`: a R$ 1,50 fez 659 impressões e 1 venda; a R$ 0,60, **nada**.
Não é a palavra nem a página — **é o piso do leilão**.

⚠️ **Metade da conta está abaixo desse piso**, gastando zero e entregando zero.

### Aplicado em 18/08 — Exata do Clips

`clips` R$ 0,60 → **R$ 1,20** ✅ confirmado na tela após recarga.
`clipe` R$ 0,59 → R$ 1,20 — editado e salvo, **confirmação visual pendente** (o filtro de
busca da tela ficou preso em "clips" e não deixou listar). Reconferir na próxima leitura.

Escolhi só essas duas (não as 14) porque são as únicas com **venda comprovada** no grupo
Frase. Menos aposta, mesma evidência.

### 🖱️ Duas descobertas de operação do console

- **Enter salva o lance** — muito mais confiável que clicar em "Salvar", cujo botão muda
  de posição conforme o popup renderiza. Clique no botão falhou 2×; Enter funcionou 1ª vez.
- ⚠️ **Selecionar as 14 linhas de uma vez CONGELA a página.** Travou o renderizador e
  exigiu fechar a aba. **Editar uma palavra por vez.**
- O filtro de busca da tabela **persiste até depois de recarregar** a página — limpar pelo
  X nem sempre funciona; abrir aba nova é mais rápido.

---

## Colheita aplicada em 18/08/2026 — Auto - Protetor → Manual - Protetor

### O relatório de termos (65 dias) da `Auto - Protetor Kit 8`

| Termo | Custo | Compras | Vendas | ROAS |
|---|---|---|---|---|
| **protetor de pés de cadeiras** | R$ 36,82 | **2** | R$ 88,55 | 2,4 |
| **protetor cadeira pé** | R$ 3,10 | **1** | R$ 44,22 | **14,3** |
| protetor de pe de cadeira silicone (Substitutos) | R$ 3,60 | — | — | — |
| protetor de pe de cadeira silicone (Substitutos) | R$ 2,11 | — | — | — |
| protetor anti impacto | R$ 1,29 | — | — | — |
| protetor de cadeira silicone | R$ 1,29 | — | — | — |
| **protetor de pé de cama** | R$ 1,25 | — | — | produto errado |
| protetor | R$ 1,14 | — | — | — |

📌 **Isso explica a `Manual - Protetor` fazer 1 clique em 6 dias:** os termos que vendem
**não estavam nela**. A automática descobriu; a manual apostava em outras palavras.

### Aplicado

✅ **`protetor de pés de cadeiras` e `protetor cadeira pé` adicionadas ao grupo
`Exata - Protetor Kit 8`** (de 12 para 14 palavras). Confirmado após recarregar.

Lances ficaram nos **sugeridos da Amazon**: R$ 0,82 e R$ 2,08. O alvo era R$ 1,20 nas
duas — **ajuste pendente**, reconferir na próxima leitura.

✅ **Negativas exatas aplicadas na `Auto - Protetor Kit 8`** — a lista estava **vazia**
(mesmo defeito que a Auto - Martelo tinha). Adicionadas 3, confirmado após recarregar:

| Negativa exata | Por quê |
|---|---|
| `protetor de pés de cadeiras` | promovida à manual — impede as duas de leiloarem entre si |
| `protetor cadeira pé` | idem (ROAS 14,3 na manual agora) |
| `protetor de pé de cama` | produto errado; R$ 1,25 gastos sem venda |

📌 **Promover e negativar têm de andar juntos, na mesma sessão.** O intervalo entre as duas
ações é exatamente o período em que se paga mais caro pelo clique que já era seu.

### Modal de negativas — mais simples que o de palavras-chave

`/cm/sp/campaigns/<id>/negative-targeting` → **"Adicione palavras-chave negativas"**.
**"Exata negativa" já vem marcada** por padrão (não precisa desmarcar nada, ao contrário do
modal de segmentação, que vem com Ampla+Frase+Exata). Digitar com Enter entre as palavras,
clicar em ponto neutro, **"Adicione palavras-chave"** → "N/N added" → **Salvar**.

---

## 🖱️ Como operar o console — o que custou 2 horas para descobrir

### ⚠️ A CAUSA DE QUASE TODA FALHA: escala de coordenadas

**O screenshot vem em 1568px de largura; o viewport tem 1920.** Coordenada tirada de
`getBoundingClientRect()` **não** serve direto para `computer.left_click`.

```js
const escala = 1568 / window.innerWidth;   // 0,8167
x_clique = Math.round(rect_x * escala)
```

Sem isso o clique cai em outro elemento — foi o que fechou modal, abriu editor errado e
me fez concluir por três vezes que "o React não aceita automação". **Aceitava; eu é que
clicava no lugar errado.**

📌 Coordenada lida **de um screenshot** já está na escala certa. Só converter as que vêm
do DOM.

### Modal "Adicionar palavras-chave"

1. Abrir → clicar aba **"Inserir lista"**
2. ⚠️ **Desmarcar "Ampla" e "De frase" ANTES de digitar** — os três tipos vêm marcados,
   e digitar antes faz o autocomplete cobrir o botão
3. Clicar na textarea (coordenada convertida) e digitar; **Enter** separa palavras
4. Clicar num ponto neutro do modal para fechar o autocomplete —
   ⛔ **NÃO usar Escape: fecha o modal inteiro**
5. **"Adicione palavras-chave"** → aparece "N/N keywords were added successfully"
6. **"Salvar"** no rodapé

### Editar lance na tabela

- **`triple_click` + digitar + Enter.** Enter salva.
- ⛔ Clicar no botão "Salvar" falha — ele muda de posição conforme o popup renderiza.
- ⛔ **`ctrl+A` seleciona a PÁGINA inteira**, não o campo. Triple-click já seleciona.
- Linha fora da tela: `scrollIntoView({block:'center'})` **e recalcular** a coordenada.

### Outros

- ⛔ **Selecionar várias linhas de uma vez congela a página** — uma por vez.
- O filtro de busca da tabela **persiste após recarregar**; abrir aba nova é mais rápido.
- Período: seletor de data → "Últimos 65 dias" (é o limite do relatório de termos).

---

## Leitura de 19/08/2026, ~meio-dia — dia 18 FECHADO + dia 19 parcial

```
Período: 18/08 via picker "Ontem" (confirmado no botão) · depois "Hoje"
Recarreguei: sim (lista agregada travada em "Loading widget" — li campanha a campanha)
Atribuição do dia 18: ABERTA (~5 dias restantes)
```

### Dia 18 fechado, por campanha

| Campanha | Gasto | Compras | Vendas | ROAS |
|---|---|---|---|---|
| Manual - Clips (Frase) | R$ 24,55 | 2 | R$ 44,22 | 1,80 · **ACOS 55,5%** |
| Auto - Protetor 8 | R$ 11,10 | — | — | |
| Auto - Protetor 32 | R$ 4,45 | — | — | 1º dia |
| Auto - Clips | R$ 1,49 | — | — | |
| **Manual - Martelo (Frase)** | R$ 0,82 | **1** | **R$ 28,90** | **35,24** 🎉 |
| Manual - Protetor | R$ 0,76 | — | — | Exata já com 14 alvos |
| Auto - Martelo | R$ 0 | — | — | **morta (2º dia)** |
| **Total** | **R$ 43,17** | 3 | R$ 73,12 | |

🎉 **A 2ª venda do martelo saiu JÁ NO PREÇO NOVO (R$ 28,90)** — subimos o preço à tarde e
ele vendeu à noite, pela Frase, com CPC de R$ 0,82. A escada de preço funcionou no 1º degrau.

📌 Pedidos reais do dia 18: 3 clips + 1 martelo. Ads atribuiu 2 clips → **1 venda de clips
foi orgânica** (TACOS clips do dia: 24,55 ÷ 66,33 = 37%).

### Dia 19 parcial (~meio-dia)

Gasto total ~R$ 5,45, sem venda atribuída ainda. Manual-Clips a R$ 1,84 — ritmo MUITO menor
que ontem: efeito compensação após o estouro de orçamento de 18/08 (a Amazon entrega menos
no dia seguinte para equilibrar).

### Decisões

1. **Clips Frase 1,50 → 1,20 aplicar** (combinado de ontem: teto ACOS 49% pela margem dela
   de 20%; dia fechou em 55,5%). Corte moderado e não para 1,00 porque a atribuição segue
   aberta e há venda orgânica no dia.
2. **Auto - Martelo: 2º dia morta → regra dos 2 dias dispara.** Lance dos 3 grupos ativos
   0,50 → 0,90 (dentro da faixa sugerida) OU aceitar como morta. Decisão dela.
3. Manual - Protetor: palavras novas ativas, sem entrega ainda — esperar (1º dia completo).
4. **Ads API: 3º teste pendente** (`unknown scope`, 19/08). 2ª solicitação foi 17/08.

### Aplicado 19/08 ~11h30 — Auto - Martelo: lance 0,50 → 0,90

Gatilho: **2 dias com impressão ~zero** (regra "impressões ~zero há 2+ dias = lance abaixo
do piso"). Confirmado após recarregar:

| Grupo | Lance | Status |
|---|---|---|
| Correspondência aproximada | **R$ 0,90** | ativo |
| Complementos | **R$ 0,90** | ativo |
| Correspondência vaga | **R$ 0,90** | ativo |
| Substitutos | R$ 0,50 | **pausado** (mantido) |

Sugestão da Amazon é R$ 0,33 (faixa 0,20–1,96); 0,90 fica bem acima dela e ainda 70% abaixo
dos R$ 3,00 originais. **Se em 2 dias continuar sem impressão, a campanha é morta de fato**
— o inventário dela era Substitutos, não busca.

### ⛔ Corte do clips ADIADO para 22/08 — e por quê

Ela perguntou "vai ter algum ganho?" e a resposta expôs falha no meu próprio gatilho.

Eu combinei "dia 18 fechado acima de 49% → cortar". Fechou em **55,5%** — **mas com
atribuição aberta**: houve **3 pedidos reais de clips no dia 18 e apenas 2 atribuídos**.
Com a 3ª venda, o ACOS do dia cai para **~37%** — abaixo do teto, e R$ 1,50 estaria correto.

📌 **A falha do gatilho:** "dia fechado" ≠ "atribuição fechada". Um gatilho de ACOS só pode
disparar sobre janela com **7 dias + 3 de folga**. Corrigir isso em qualquer regra futura.

Segundo motivo: **não há sangria para estancar hoje**. A Amazon está compensando o estouro
de orçamento de 18/08 sozinha — R$ 1,84 gastos até meio-dia contra R$ 24,55 no dia inteiro
de ontem.

**Decisão: reavaliar 22/08** com a janela do dia 18 fechada. Acima de 49% → 1,50 → 1,20.
Abaixo → mantém. Custo de esperar ≈ R$ 3.

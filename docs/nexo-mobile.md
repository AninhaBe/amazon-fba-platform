# NEXO Mobile — a especificação viva

**Decisão da dona do produto (08/09/2026):** o NEXO terá um aplicativo **nativo
de verdade** (não PWA, não casca de webview). Até ela pedir o início do
desenvolvimento, esta frente é **documental e corre em paralelo ao web**: tudo
o que for definido/fechado no web ganha a seção espelho aqui, com as notas do
que muda no celular. No dia do "vai", o app nasce desta spec — não de
engenharia reversa das telas.

> **Regra de manutenção (vale para todos os agentes):** toda frente de FRONT
> fechada no web atualiza a seção correspondente deste doc no mesmo ciclo.
> Frente web sem espelho mobile aqui está incompleta.

---

## 1. Princípios que o mobile herda por inteiro (não são opcionais)

- **As regras de dado incerto** (AGENTS.md): `null` ≠ `0`; não extrapolar;
  nunca "parcial" — apontar o que falta com número e link; tela sem dado mostra
  o estado real. Valem em qualquer plataforma.
- **Isolamento multi-inquilino**: o app fala só com as APIs do NEXO; nenhuma
  credencial de marketplace vive no dispositivo.
- **Assinatura**: mesma tranca do web (ativa passa; resto vai para assinar;
  garantia de 7 dias). Loja da Apple exige atenção: assinatura vendida FORA do
  app tem regras próprias de exibição — decidir na fase de dev.
- **Design**: o design system é o mesmo (`packages/nexo-ds` + a direção
  "Caminho do Dinheiro" — `G:/sc-temp/design-caminho-do-dinheiro/`). Tokens,
  limiares de margem e a voz do NEXO (MensagemDoNexo) idênticos.
- **Canvas antes de código**, como no web: cada tela mobile terá mockup
  aprovado pela dona antes do desenvolvimento.

## 2. O trabalho do mobile (hipótese a validar com a dona na fase de canvas)

O celular é o lugar do **"sobrou dinheiro hoje?"** em 5 segundos, e do alarme
que chega sozinho. A operação pesada (cadastro em massa, análise longa)
continua melhor no desktop — mas a decisão dela é que o mobile espelhe **tudo
o que for definido no web**, então nada é cortado por padrão; a ordem de
construção é que priorizará o acompanhar.

**Push notifications — o superpoder que o web não tem.** Candidatas (cada uma
vira spec quando a frente web correspondente fechar):
- venda com margem negativa (o caso Capa Para Moto);
- estoque crítico ("acaba em N dias");
- repasse caiu / repasse FALHOU (a novela da Santander provou o valor);
- sincronização com problema que exige ação da pessoa (reconectar conta);
- resumo do dia (a narração do NEXO, opt-in).

## 3. Espelho das telas — estado em 20/09/2026

| Tela web | Estado web | Nota mobile |
|---|---|---|
| Dashboard ML — **v3** | ✅ fechado 11/09 (substitui a faixa de 4 etapas): 7 colunas do período, margem, top produtos, ritmo 7 dias com alternador, pendências, Pedidos a revisar, anúncios com TACOS, Radar do FULL, saldo | As **7 colunas não caibem** no celular: viram lista empilhada com "Lucro" como herói e as quatro parcelas do custo abaixo, cada uma com o "% da venda". O chip de margem sobe para o topo. Alternador de métrica do ritmo = segmented control. |
| Dashboard Amazon — **v3** | ✅ fechado 13/09 (mesma peça do ML): 7 colunas + Margem, Top 8, ritmo 7 dias, pendências, Pedidos (prévia de 5), Anúncios pagos, **Radar do FBA** e **Cai na conta** (repasse). **Oito colunas, não sete** — a Amazon tem Ads no lucro e tarifa estimada marcada. | Mesma regra do ML, com um agravante: **oito** colunas empilham pior que sete. O dia no vermelho desce abaixo da linha no ritmo — no celular isso precisa de altura reservada nos dois sentidos, senão a coluna negativa corta. A marca de tarifa estimada não pode depender de hover. O "Cai na conta" diz a regra **da Amazon** (retém até depois da entrega), não a do ML. |
| Monitor / Estoque / Anúncios da Amazon | ✅ fechados 13/09 no mesmo esqueleto (`8ea1992`): monitor com as abas v3 e a tabela de rentabilidade, radar de estoque em cartão v3, e **Anúncios virou a casa do catálogo e do custo por SKU** — `/amazon/produtos` e `/amazon/catalogo` agora **redirecionam** para lá, como no ML. | A mudança de casa importa mais no app que no web: **deep link e tab bar apontam para `/amazon/anuncios`**, não para uma tela de produtos. Rota antiga continua respondendo (favorito e link publicado não quebram) — o app deve tratar as duas. |
| Dashboards Shopee/TikTok | design atual (réplica pendente, por canal) | Espelham quando a réplica web de cada canal fechar. |
| Central (/) | passagem | No mobile provavelmente morre: o app abre direto no canal principal ou num agregado — decidir em canvas. |
| /reativar + checkout | ✅ no ar (v288, mínima; a bonita vem por canvas) | Fluxo de assinar no mobile depende da decisão de loja (in-app purchase vs web checkout) — registrar na fase dev. |
| Briefing / narração | no ar (Gemini, cache diário) | Candidata forte a push/resumo matinal. |
| Pendências (custo, alíquota) | ✅ padrão consolidado (número + link) | Push + deep link para a tela de resolver. |
| Monitor / Pedidos a revisar | ✅ fechado 11/09 (linguagem v3) | A tabela de 11 colunas vira **um cartão por pedido** (produto, data e as parcelas em pares chave-valor); o chip de margem é a face do cartão. Revisão em massa continua melhor no desktop. |
| Bancadas (`/mercado-livre/bancada*`, `/lab/mercado-livre`, `/lab/amazon`) | ✅ 11/09 as do ML montam a tela real; 12–13/09 a **Amazon ganhou bancada em `/lab/amazon`** — sem ela, "repliquei" era declaração, porque nenhum canal traz dado nesta máquina | **Não existem no app.** Eram atalho de desenvolvimento; no mobile não há URL para colar. ⚠️ Mas o que elas provaram, o app precisa: foi a varredura do **DOM renderizado** da bancada que achou "Produto no FULL" dentro do "Radar do FBA" — grep no fonte não acharia. O equivalente no app é inspecionar a árvore renderizada, não o código. |
| Faixa "Sincronização atrasada" (os 4 canais) | ❌ **removida em 13/09** por ordem dela — sincronização alarma para NÓS (vigia do `/api/health` + Grafana), não para a vendedora | **Não desenhar no app.** Nem a faixa de atraso, nem a linha "Sincronizado há X min": estado normal não é notícia. O que sobra para o celular é o push de **falha que exige ação dela** (reconectar conta), que já está na lista de candidatas acima. |

## 3.1 O que o v3 do ML fixou — e o app herda sem negociar

Cinco regras ganharam **lugar concreto** na tela no fechamento de 11/09. No
mobile elas não mudam de valor, só de forma — e a forma é a parte que costuma
cair na tradução para telas estreitas:

- **A margem nunca aparece sozinha.** A linha sob o número diz a base do cálculo
  ou o que falta ("falta 26 unidade(s) sem custo"). No celular ela é a primeira
  coisa que o layout tenta cortar por falta de espaço — ela não é cortável.
- **O lucro só sai verde com as quatro parcelas fechadas**, e prejuízo sai
  vermelho. Cor é estado: no app, o mesmo par verde/vermelho, nunca o verde de
  "tem número".
- **Lista recortada diz que é recorte.** "Pedidos a revisar" mostra cinco linhas
  debaixo de totais do período inteiro e a frase de escopo explica isso. No
  mobile a lista é ainda mais curta — a frase fica mais necessária, não menos.
- **Estimativa marcada junto do número** (ADR-027), na face do cartão, não no
  detalhe que abre. Tooltip não existe no celular: a marca tem de ser visível.
- **Dia sem apuração fechada** fica só com o contorno da barra e não entra na
  média. Em tela pequena, a tentação é desenhar zero para a barra "não ficar
  vazia" — zero numa série temporal lê como queda, não como ausência.

## 3.2 O que a réplica da Amazon ensinou — e o app herda como regra

A segunda tela a montar o esqueleto v3 expôs o que a primeira não podia expor.
São regras de **peça compartilhada**, e o app terá o mesmo problema desde o
primeiro dia, porque ele nasce com quatro canais.

- **A peça do esqueleto é cega ao canal; a palavra vem do contrato.** Enquanto
  só o ML renderizava a lista de pedidos, ela dizia "Tarifa ML" — e ficou
  semanas dizendo isso na tela da Amazon. Depois foi "Radar do FULL" no canal do
  FBA, e depois "Produto no FULL" **dentro** de um bloco já intitulado "Radar do
  FBA": três vezes a mesma família em dois dias. No web isso virou `CanalV3`
  (`src/lib/canalV3.ts`), com campos **obrigatórios** — campo opcional deixa o
  segundo sítio esquecer em silêncio. **O app copia o contrato, não as strings.**
- **E um dos campos não é palavra, é fato.** `anuncioNoLucro` decide uma
  *afirmação*: no ML o bloco "Anúncios pagos" diz que aquele gasto **não** está
  descontado do lucro acima (lá ele sai no fechamento); na Amazon ele **já está**
  — é a oitava coluna da faixa. Copiar a frase junto com o bloco teria posto na
  tela dela uma afirmação falsa sobre o próprio dinheiro.
- **O contador de apuração não inventa fração.** A faixa diz "N pedidos
  apurados" quando o período fechou, e "faltam apurar M de N pedidos" quando
  não. Nunca "X de Y" com X e Y de universos diferentes — foi o "41 de 11" que
  o print dela pegou em 12/09. No celular a frase é ainda mais curta; encurtar
  não pode virar fração de novo.
- **Prévia curta + frase de escopo andam juntas.** O bloco "Pedidos" mostra
  **5 linhas** e a lista inteira mora no monitor. Desde 13/09 o corte é do
  **servidor** (o dashboard recebe só as 5), e o escopo continua calculado sobre
  o período inteiro — ou a frase mentiria. Para o app isso é presente de
  aniversário: a tela do celular pede a mesma view enxuta e paga ~28 KB em vez
  de 595 KB.

## 4. O que o mobile NÃO herda (diferenças estruturais a especificar)

- **Navegação**: sem barra lateral — tab bar inferior (candidatos: Hoje ·
  Canais · Pendências · Mais). Definir em canvas.
- **Sessão**: login por e-mail/senha do Supabase + biometria local depois do
  primeiro login.
- **Densidade**: as tabelas densas do web viram listas de cartões (o padrão
  <768px já implementado no ML é a referência).

## 5. Stack — recomendação registrada, decisão só na fase dev

"Nativo de verdade" comporta dois caminhos; a escolha fica para o dia do "vai",
com esta nota de partida: **React Native/Expo** entrega app nativo nas duas
lojas com uma base só e reaproveita o conhecimento de React/TS da casa;
**Swift + Kotlin** (duas bases) maximiza fidelidade de plataforma ao custo de
duplicar toda tela. A doutrina "correção vale para todos" pesa contra manter
três front-ends (web + iOS + Android) — trazer essa conta feita para a decisão.

## Changelog do espelho

- 20/09/2026 — **fechamento da réplica da Amazon e a limpeza que veio com ela.**
  O que o espelho não cobria e agora cobre: (a) o canal Amazon fechou INTEIRO no
  esqueleto v3, não só o dashboard — monitor, radar de estoque e anúncios
  entraram em 13/09, e **catálogo e custo por SKU mudaram de casa** para
  `/amazon/anuncios` (as rotas antigas redirecionam), o que muda deep link e tab
  bar do app; (b) o dashboard da Amazon ganhou **Anúncios pagos**, **Radar do
  FBA** e a etapa **Cai na conta**, com a regra de repasse da Amazon (retém até
  depois da entrega), e não a do Mercado Pago; (c) a faixa **"Sincronização
  atrasada" foi removida dos quatro canais** — o app não a desenha, nem a linha
  "Sincronizado há X min"; (d) a seção 3.2 registra as três lições de peça
  compartilhada (contrato de canal, `anuncioNoLucro` como fato e não palavra,
  contador de apuração sem fração inventada), que o app herda desde o primeiro
  dia porque nasce com quatro canais; (e) a prévia de 5 linhas passou a ser
  cortada no servidor — a mesma view enxuta serve o celular.
  ⚠️ Shopee e TikTok continuam no desenho anterior: a réplica é por canal, e
  cada uma espera ordem dela.

- 12/09/2026 — espelho do **v3 da Amazon** (ordem dela: *"replicar a mesma
  estrutura do mercado livre na amazon"*). A Amazon passa a montar a MESMA peça do
  ML (`PainelV3`), então o app herda um desenho só para os dois canais — o que o
  mobile precisa especificar é a **diferença**: oito colunas em vez de sete, dia
  de lucro negativo descendo abaixo da linha, e a marca de tarifa estimada
  (ADR-027) visível sem hover. Saíram da tela da Amazon, registrados como
  reversíveis em `docs/amazon-v3-leva-12-09.md`: ticket médio, canceladas, cupom
  resgatado, "Vendas (com canceladas)", seta de tendência e o painel de
  repasses — nenhum deles deve ser desenhado para o app antes de ela decidir se
  volta ao web. ⚠️ Shopee e TikTok seguem no desenho anterior.

- 11/09/2026 — espelho do **redesign v3 do Mercado Livre** (dashboard, monitor,
  anúncios, auditoria): as 7 colunas do período, o cartão-por-pedido e a seção
  3.1 com as cinco regras que ganharam lugar na tela. As bancadas entram como
  "não existem no app". ⚠️ O espelho cobre **só o Mercado Livre**: Amazon,
  Shopee e TikTok seguem no desenho anterior, e a casca compartilhada (sidebar,
  tema, marca) ficou FORA desta leva por decisão dela — quando ela subir, esta
  seção precisa de outra passada, porque a navegação do app sai da casca.
- 08/09/2026 — doc criado com a decisão da dona (nativo; documental até ordem
  de dev; paralelo ao web) e o espelho do estado atual do web (v289).

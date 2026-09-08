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

## 3. Espelho das telas — estado em 08/09/2026

| Tela web | Estado web | Nota mobile |
|---|---|---|
| Dashboard ML — Caminho do Dinheiro | ✅ no ar (v289): faixa de 4 etapas, alertas, 3 cards de tabela, ritmo 7 dias, anúncios com TACOS, estoque crítico | A faixa vira a tela inicial do app: 4 etapas empilhadas, "Sobrou" como herói. Tabelas já têm forma-cartão definida (responsivo <768px do web é o rascunho do mobile). Alternadores viram segmented control. |
| Dashboards Amazon/Shopee/TikTok | design atual (réplica do Caminho do Dinheiro pendente, por canal) | Espelham quando a réplica web de cada canal fechar. |
| Central (/) | passagem | No mobile provavelmente morre: o app abre direto no canal principal ou num agregado — decidir em canvas. |
| /reativar + checkout | ✅ no ar (v288, mínima; a bonita vem por canvas) | Fluxo de assinar no mobile depende da decisão de loja (in-app purchase vs web checkout) — registrar na fase dev. |
| Briefing / narração | no ar (Gemini, cache diário) | Candidata forte a push/resumo matinal. |
| Pendências (custo, alíquota) | ✅ padrão consolidado (número + link) | Push + deep link para a tela de resolver. |
| Monitor / Pedidos a revisar | no ar | Leitura ok no celular; revisão em massa fica melhor no desktop. |

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

- 08/09/2026 — doc criado com a decisão da dona (nativo; documental até ordem
  de dev; paralelo ao web) e o espelho do estado atual do web (v289).

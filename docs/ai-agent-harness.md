# Ideia: AI Agent Harness no SellerCore

> **Status:** ideia / backlog. Não implementar agora — anotado para quando fizer sentido.
> Registrado em 2026-07-12.

## Estado em 22/08/2026 — a FASE 1 está no ar

O NEXO já fala na tela (resumo do canal, Visão geral e aba Briefing) usando o
**Gemini** (`gemini-3.6-flash`, pré-pago via `GEMINI_API_KEY` como secret do Fly).
Arquivos: `src/lib/centralBriefing.ts` (prompt e modos), `src/lib/centralDiagnostico.ts`
(candidatos a causa), rota `/api/central/briefing`.

**O que ele faz hoje:** recebe números prontos + **fatos do banco que explicam esses
números**, e escreve. O servidor é quem consulta; o modelo nunca toca no banco.

O pedido dela que originou isso, em 22/08: *"legal que o faturamento do ML caiu, mas
ele não sabe dizer mt o pq"*. A resposta estava no banco — a conta de Mercado Livre
dela tem **14 anúncios e ZERO ativos** — e ninguém entregava esse fato ao modelo.

```
ANTES   "o Mercado Livre caiu 100% na semana. Vamos ver?"
AGORA   "o Mercado Livre caiu 100% PORQUE não há nenhum dos 14 anúncios
         ativos no canal. Isso derrubou o faturamento geral em 27,3%."
```

Sinais coletados hoje (`coletarSinaisDeCausa`): canal sem anúncio ativo, canal com
menos de 25% ativos, produto que vendia 3+ vezes e parou há 5+ dias, e produto com
estoque zero que vendeu no último mês.

### FASE 2 — pendente: o modelo consultando de verdade (tool use)

O que a fase 1 **não** resolve: pergunta aberta. *"E se eu baixar o preço do martelo
em 10%, ainda tenho margem?"* ou *"qual SKU teve a pior margem e por quê?"* exigem que
o modelo **decida** o que consultar, itere e responda — não dá para pré-calcular todas
as perguntas possíveis.

Isso é o harness deste documento, e o Gemini suporta **function calling**. As
ferramentas seriam as funções que já existem (a lista da seção abaixo).

⚠️ **O que precisa ser resolvido antes de ligar:**

1. **Guarda-corpo de alucinação em consulta.** Na fase 1, todo número vem de SQL nosso.
   Com tool use, o modelo escolhe os argumentos — e período/filtro errado devolve
   número verdadeiro respondendo a pergunta errada. O `connection_id` é o caso crítico:
   o banco tem três contas Amazon e uma delas é do colega (ver
   `.claude/skills/monitorar-ads/SKILL.md`, "Contaminação de dados").
2. **Custo e latência.** Cada rodada é uma chamada; uma pergunta pode custar 3–5.
   A fase 1 é uma por dia, cacheada.
3. **Escopo de workspace nas tools.** Toda ferramenta tem de herdar o workspace do
   contexto e nunca aceitá-lo como argumento do modelo.
4. **Onde a conversa mora.** Hoje não há chat na tela; a fase 2 pede uma superfície nova.

📌 **Regra que vale nas duas fases:** o modelo só afirma o que recebeu. Na fase 1 isso é
garantido pelo prompt e pelo snapshot; na fase 2 precisa ser garantido pelas tools —
elas retornam dado estruturado, e o prompt proíbe extrapolar além do retorno.

## Resumo

Um **AI Agent Harness** é um LLM (Claude) equipado com **ferramentas** + um **loop de
raciocínio** que decide sozinho quais ferramentas chamar, encadeia passos, e ou responde
uma pergunta ou executa uma ação (com guarda-corpos).

O ponto-chave: **a parte difícil já está pronta**. As "ferramentas" do agente seriam
exatamente os nossos `src/lib/*.ts` e as rotas `/api/*` — funções que já abstraem as
APIs da Amazon, Mercado Livre, TikTok Shop e Shopee. O agente é só uma camada por cima; ele não precisa saber
falar com a Amazon, ele chama nossas funções. E como essas funções já normalizam os dados,
o agente enxerga "vendas / lucro / estoque" como uma coisa só, independente do marketplace.

## Ferramentas que já temos (viram tools do agente)

- `getFinanceSummary(period)` — lucro real (Finances)
- `getSalesVelocity(period)` / `getDailySales(period)` — vendas e velocidade
- `getStockRadar()` — radar de estoque (FBA Inventory + velocidade)
- `getFeesEstimate(asin)` / cálculo FBA/FBM/DBA da calculadora
- `getCompetitivePricingBatch()` — preços/concorrência
- `searchProducts()` — pesquisa de mercado (lançamento, BSR, preço, nº de vendedores)
- `costStore` — custos cadastrados por SKU/ASIN
- `topProducts`, `products`, `listings` — catálogo/produtos da conta

## Onde encaixa (do mais seguro ao mais autônomo)

### 1. Copiloto conversacional — "Pergunte à sua operação" *(começar por aqui)*
Chat no dashboard, em português:
- "Qual SKU teve a pior margem esse mês e por quê?"
- "Se eu baixar o preço do ASIN X em 10%, ainda tenho 20% de margem?"
- "Quais produtos vão faltar antes do fim do mês?"
- "Por que meu lucro caiu essa semana?"

O agente decide sozinho: chama `getFinanceSummary`, cruza com `getFeesEstimate`, olha o
`radar`, e responde número + explicação. **Read-only → seguro.** Reaproveita 100% do que
já existe. Maior valor com menor risco, e é a fundação técnica dos itens 2–4 (mesmo
conjunto de ferramentas, só muda o gatilho).

### 2. Insights e alertas proativos (agente em loop / agendado)
Roda periodicamente (cron), vasculha os dados e **empurra** o que importa:
- "Sua margem no SKU Y caiu 5% — a taxa de storage subiu."
- "Estoque do SKU Z acaba em 4 dias no ritmo atual."
- "Entrou um vendedor novo no seu nicho a R$ X."

### 3. Advisor / recomendações acionáveis
Em vez de só descrever, calcula e **recomenda**:
- "Reprecificar SKU X para R$ Y (recupera Buy Box mantendo 20% de margem)."
- Scanner de oportunidade na `/pesquisa`: "Vale a pena vender este produto?" — roda
  catálogo + fees + pricing + concorrentes e dá um veredito com raciocínio.

Humano aprova; agente ainda não age sozinho.

### 4. Ações autônomas com aprovação humana (com guarda-corpo)
Repricer automático dentro de regras de margem, pedido de restock, rascunho de resposta a
comprador. **Tudo que é irreversível/externo passa por aprovação humana.** Deixar por último.

### 5. Geração de conteúdo
Título/descrição/bullets otimizados para anúncios (força natural do LLM). Fácil e vendável.

## Como construir (referência técnica)

- **Ferramentas = nossas funções.** Cada `lib/*.ts` vira uma tool com schema (nome,
  descrição, params).
- **Tool Runner do Anthropic SDK** (`@anthropic-ai/sdk` → `client.beta.messages.toolRunner`
  com `betaZodTool` + Zod) roda o loop: Claude pede a tool → nosso código executa a função
  → resultado volta → repete até responder. **Não escrevemos o loop na mão.**
- **Modelo:** `claude-opus-4-8` (default) para o raciocínio; `claude-haiku-4-5` nas
  tarefas baratas/rápidas (classificar alerta, resumir).
- **Onde roda:** uma rota Next tipo `/api/copilot`, que herda o `withAccountContext` — o
  agente opera automaticamente na conta ativa, com o cache e o namespacing que já temos.
  Zero infra nova.
- **UI:** painel de chat no dashboard (copiloto) + alertas proativos como cards.
- **Segurança:** leitura é livre; qualquer ação com efeito colateral (mudar preço, mandar
  mensagem) passa por confirmação humana — o Tool Runner permite gatear isso dentro da
  própria função da tool.

## Recomendação

Começar pelo **Copiloto (nº 1)**: read-only, reaproveita tudo, entrega valor imediato e
demonstra o diferencial do SellerCore — não é só um dashboard, é uma operação com a qual
você conversa. Os itens 2–4 vêm depois, reusando as mesmas ferramentas.

## Relação com Shopee/TikTok

A integração Shopee já está implementada e testada em sandbox (`lib/shopee.ts`), então o
agente ganha esses dados **de graça** — ele fala com nossas funções normalizadas, não com as
APIs. A validação Live segue bloqueada externamente pela aprovação do Go Live, pelas
credenciais de produção e pela autorização de uma loja real. Multi-marketplace fica
transparente para o agente.

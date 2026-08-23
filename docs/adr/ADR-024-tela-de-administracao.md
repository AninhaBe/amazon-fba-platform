# ADR-024: Tela de administração — leitura entre workspaces

- **Status:** Aceito
- **Data:** 2026-08-23

## Contexto

Todo o NEXO é construído sobre **isolamento por workspace**: cada consulta filtra
por `workspace_id`, o contexto vem do login, e existe teste de arquitetura que
reprova módulo consultando canal fora do lugar. É essa disciplina que garante que
a conta de um vendedor nunca apareça na tela de outro — e ela já falhou uma vez
(cache de módulo vazando entre contas, corrigido em 22/08/2026).

A operação, porém, precisa de perguntas que **só existem atravessando** esse
isolamento: quantos workspaces existem, qual canal é mais conectado, quantas
conexões estão em erro, se a adoção de custo cadastrado cresce.

Pedido dela em 23/08/2026: *"uma tela de admin, só pra mim e pro Lucas, onde
consigo ver métricas do NEXO — telas mais acessadas, funcionalidades mais usadas,
integrações mais usadas e afins"*.

Levantamento do que existia antes de decidir:

| | |
|---|---|
| `src/lib/metricas.ts` | telemetria **operacional** (Prometheus, porta 9091): idade do sync, pedidos presos. Nada de uso de produto. |
| Navegação / uso de tela | **não existe registro nenhum** |
| Conceito de admin | **não existe** |

## Decisão

**1. Existe UMA rota que lê entre workspaces, e ela é explícita.**
`/admin` e `/api/admin/*`. Nenhum outro caminho do produto ganha essa permissão,
e a exceção fica nomeada aqui em vez de virar hábito.

**2. O portão é allowlist de e-mail, no servidor, por variável de ambiente.**
`ADMIN_EMAILS`, conferida contra o e-mail autenticado a cada requisição. Não em
tabela (editável por quem tiver acesso ao banco), não em claim do token
(precisaria de custom claims), não em link escondido.

**3. Quem não está na lista recebe 404, não 403.**
403 confirma que a tela existe. Para quem não é admin, ela não existe.

**4. Só AGREGADO. Nunca identidade ao lado de dinheiro.**
Contagens e distribuições. É **proibido** exibir nome ou e-mail de vendedor ao
lado do faturamento dele. Para suporte, identificar por `workspace_id`.

**5. Entrega em duas fases.**
- **Fase 1 (esta):** só o que o banco já responde — workspaces, integrações por
  canal, volume, adoção. Zero instrumentação, dado histórico completo.
- **Fase 2 (depois):** captura de navegação no `src/proxy.ts` numa tabela de
  eventos com retenção. Só então "telas mais acessadas".

## O que subiu na fase 1 (23/08/2026)

| Peça | Arquivo |
|---|---|
| Política de quem é admin (pura, testável) | `src/lib/adminAllowlist.ts` |
| Ligação com a requisição | `src/lib/admin.ts` — `comAdmin()` |
| Consultas agregadas | `src/lib/integrations/…` → `src/lib/adminMetricas.ts` |
| Rota de dados | `/api/admin/metricas` |
| "Sou admin?" para a interface | `/api/admin/eu` |
| Tela | `/admin` |
| Link na barra lateral | `src/app/components/useEhAdmin.ts` |
| Testes do portão | `tests/admin.test.mjs` (6 casos) |

### Duas barreiras independentes, e elas fazem coisas diferentes

| | Para quem NÃO está na allowlist |
|---|---|
| **O link** | não aparece — `/api/admin/eu` responde 404 |
| **Os dados** | `/api/admin/*` responde **404**, mesmo digitando a URL |

⚠️ **Esconder o link não é controle de acesso.** Quem digitar `/admin` chega na
página; o que ele não recebe é dado, porque a rota recusa. O link existe para não
oferecer à pessoa uma porta que vai bater na cara dela — a proteção é o servidor.
Quem adicionar a próxima função de admin precisa fazer **as duas**, e a de dados
é a obrigatória.

### O erro que quase entrou

A primeira versão contava conexões a partir de `workspace_integrations`. Medido no
mesmo dia: aquela tabela só tinha Mercado Livre real — a Amazon autentica por LWA
na conta e não se registra lá. A tela teria mostrado **"Amazon: 0 conexões"** com
três contas sincronizando. A fonte correta é `workspace_marketplace_syncs`, a
única onde todo canal aparece.

## Consequências

**A favor**

- A pergunta "qual canal é mais usado?" passa a ter resposta, hoje, sem código novo
  de coleta.
- A exceção ao isolamento fica em **um** lugar auditável. Procurar por `/api/admin`
  encontra tudo que atravessa workspace.
- Fase 1 não cria linha nova no banco: custo zero de armazenamento.

**Contra, e assumido**

- ⚠️ **É uma brecha real no isolamento.** Se `ADMIN_EMAILS` vazar ou for mal
  configurada, um usuário comum vê agregado de todos. Mitigado pelo 404 e por
  não haver dado identificável junto de valor — mas a brecha existe por desenho.
- A tela nasce quase vazia: hoje são **três workspaces** (dela, do colega e o de
  demonstração). Por isso a fase 1 é deliberadamente simples — investir em
  dashboard elaborado para três linhas é trabalho que se refaz.
- Fase 2 terá custo recorrente de banco e precisa nascer com retenção. Decidir o
  prazo só com o volume medido, não por palpite.

## Alternativas descartadas

- **Role no banco (`is_admin`).** Quem tem acesso ao banco se promove. A variável
  de ambiente exige acesso ao deploy, que é um degrau a mais.
- **Reaproveitar o endpoint Prometheus.** Ele é operacional e não tem autenticação
  de usuário — serve para alarme, não para tela.
- **Fazer as duas fases juntas.** A fase 2 começa sem histórico e só fica útil
  depois de dias acumulando; juntar atrasaria a fase 1 sem adiantar a 2.

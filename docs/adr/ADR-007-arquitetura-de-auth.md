# ADR-007: Arquitetura de autenticação e autorização (Better Auth)

- **Status:** Proposto
- **Data:** 2026-07
- **Relacionado:** [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) (migração self-hosted)

## Contexto

A migração (ADR-006) troca o Supabase Auth pelo **Better Auth**. Auth deixa de ser
detalhe de infra e vira **pilar do produto** — por isso ganha ADR própria.

Dois problemas do modelo atual a corrigir agora (janela sem usuários):
1. **Identidade acoplada ao Supabase** (`@supabase/ssr`, `getClaims`).
2. **`workspace_id = sub` do usuário** — mistura *pessoa* e *organização*. Impede
   time, múltiplas contas por operação e um usuário em mais de uma empresa.

E a distinção que mais causa vazamento em SaaS: **autenticação ≠ autorização**. Saber
*quem é* o usuário não protege as tabelas de pedidos/produtos/marketplaces — o
isolamento por workspace continua responsabilidade do SellerCore.

## Decisão

### Identidade e sessão
- **Better Auth** roda dentro do Next.js, tabelas no mesmo Postgres. Sessão em cookie
  `httpOnly`, resolvida **sempre no servidor**.
- E-mail/senha + **confirmação e reset** via provedor transacional (ver ADR-006).

### Modelo de dados (desacoplado)
```
users             (Better Auth)     id, email, ...
workspaces        id, name, created_at
workspace_members workspace_id, user_id, role   -- role: owner | admin | member
```
As tabelas de negócio referenciam **`workspace_id`** (nunca `user_id`). Usa-se o
**plugin de organizations do Better Auth** como espinha de membership
(organization ≡ workspace).

### Autorização (a parte crítica)
Toda rota autenticada, no servidor, obrigatoriamente:
1. obtém o `workspace` a partir da **sessão** (não de query/body/header do cliente);
2. valida que o usuário **pertence** àquele workspace (`workspace_members`);
3. aplica `workspace_id = $1` em **toda** query;
4. **bloqueia** acesso cruzado — nenhum `workspace_id` vindo do browser é confiável.

Na prática: reconstruir sobre a sessão do Better Auth a garantia que hoje o
`withAuthenticatedWorkspace` + `runWithWorkspace` dão, e **auditar rota por rota**.

### Escopo v1 (YAGNI na superfície de time)
- No cadastro, cria-se **um** workspace e o usuário entra como **owner**.
- O schema já suporta `admin`/`member`, mas **não** há UI de convite/papéis ainda —
  entra quando houver necessidade real.

### Teste obrigatório
- **Isolamento cruzado automatizado**: com dois usuários/workspaces, provar que um não
  acessa dado do outro em **nenhuma** rota. É critério de aceite, não opcional.

## Alternativas consideradas
- **Manter GoTrue self-hosted:** rejeitado (ADR-006) — mais serviços para operar.
- **NextAuth/Auth.js puro:** o Better Auth hoje mantém o Auth.js; escolhido pela
  multi-tenancy (organizations) nativa e por ser database-agnostic sobre o nosso `pg`.

## Consequências
- ➕ Modelo de tenancy correto desde já; pronto para times sem repintar depois.
- ➕ Isolamento vira **requisito explícito e testado**, não implícito.
- ➖ Rework real: identidade + sessão + workspace + middleware + reset + e-mail +
  reautorização de todas as rotas. Feito na melhor janela (sem clientes).
- ➖ Recomeço limpo de dados (recriar owner, re-OAuth dos marketplaces) — aceitável agora.

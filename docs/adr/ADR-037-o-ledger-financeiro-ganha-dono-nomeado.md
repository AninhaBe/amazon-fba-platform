# ADR-037: O ledger financeiro passa a ter uma role nomeada, em vez de nenhuma

- **Status:** **Proposto** em 01/09/2026. Emenda o contrato da [ADR-012](./ADR-012-contrato-0005-sem-runtime-role.md) e desbloqueia a etapa 3 da [ADR-036](./ADR-036-barreira-de-inquilino-no-banco.md).
- **Data:** 2026-09-01

> ⚠️ **Isto NÃO é um afrouxamento, e quem ler rápido vai achar que é.** A frase
> que resume está na seção "O que muda de verdade": hoje o ledger está
> **inalcançável para quem não importa e aberto para quem importa**. Esta ADR
> inverte isso.

## Como o conflito apareceu

Não por análise: por um defeito meu, em produção.

A migration `0024` (etapa 1 da ADR-036) criou a role `nexo_runtime` e concedeu
DML "em todas as tabelas exceto a contabilidade de migration". Nesse *todas*
entraram as três tabelas do ledger 0005 — `workspace_financial_payments`,
`workspace_financial_sync_checkpoints`, `workspace_financial_transactions`. O
contrato 0005 exige ACL **fechada** nessas tabelas, então `acl_tables_closed`
virou `false` e **nenhuma migration nova pôde ser planejada nem aplicada** até o
`REVOKE`.

📌 O erro de método, registrado porque é o que se repete: eu escrevi "menor
privilégio" no comentário da 0024 e excluí a lista de tabelas que **imaginei**,
em vez de perguntar ao banco quais tinham contrato de ACL. A informação estava a
uma consulta de distância. **Comentário que afirma um rigor que não houve é pior
que comentário nenhum** — quem lê passa a confiar numa apuração que não
aconteceu.

O conserto foi feito de modo a não depender de conferência: `REVOKE` dentro de
uma transação com a verificação do contrato rodando **dentro dela**, e rollback
automático se `acl_tables_closed` não voltasse a `true`.

## O conflito, dito por extenso

| | exige |
|---|---|
| Contrato 0005 (ADR-012) | ACL **fechada** nas três tabelas do ledger — nenhuma role com DML |
| ADR-036, etapa 3 | a aplicação conecta como `nexo_runtime`, que **precisa** ler e escrever o ledger |

Os dois não podem valer ao mesmo tempo. Enquanto não se decidir, **a etapa 3 da
ADR-036 está bloqueada**.

## Alternativas descartadas

- **(b) O ledger continua acessado por outro caminho.** Adia sem resolver, e cria
  dois caminhos de acesso ao dado mais sensível — que é como se perde a conta de
  quem entra.
- **(c) A etapa 3 exclui o ledger, que fica em `postgres`.** Deixaria o **dado
  financeiro** — o mais sensível que temos — na única role com `bypassrls`, que é
  exatamente o buraco que a ADR-036 existe para fechar. Seria proteger tudo,
  menos o que mais importa.

## Decisão

**O contrato 0005 passa a NOMEAR `nexo_runtime` como a única role de aplicação
autorizada no ledger, e a exigir policy de RLS por workspace nas três tabelas.**

A verificação do contrato deixa de perguntar *"não há grants?"* e passa a
perguntar *"os grants são exatamente estes, e existe policy?"*:

| antes | passa a ser |
|---|---|
| `acl_tables_closed` — nenhuma role com DML | DML **somente** para `nexo_runtime`; `PUBLIC`, `anon`, `authenticated` e `service_role` seguem sem nada |
| `no_policies` — RLS ligada e nenhuma policy | policy por workspace **obrigatória** nas três tabelas, com `USING` **e** `WITH CHECK` |
| — | `nexo_runtime` verificada como `NOBYPASSRLS` e **não dona** de nenhuma das três |

### O que muda de verdade

Hoje "ACL fechada" protege contra outras roles — mas a aplicação entra como
`postgres`, que é dona das tabelas e tem `bypassrls`, e **pula tudo**. Ou seja: o
ledger está *inalcançável para quem não importa* e *aberto para quem importa*.

Depois desta ADR ele passa a ter **uma role nomeada, sem bypass, com policy por
workspace**. Isso é estritamente mais forte que o estado atual — o número de
caminhos privilegiados cai de "um, irrestrito e invisível" para "um, nomeado e
filtrado".

## A condição que impede isto de virar carimbo

⚠️ **A verificação nova tem de REPROVAR o estado de hoje.** Se ela passar com
`postgres` acessando o ledger sem policy, ela não está verificando nada — está
descrevendo o que já existe e chamando de contrato.

Isso é requisito de implementação, e o teste correspondente precisa ser visto
vermelho antes de contar (`AGENTS.md`): rodar a verificação nova contra o banco
**como ele está agora** deve dar `BLOCKED`. Só depois de a policy e a role
estarem no lugar é que ela pode passar.

É o mesmo padrão de `tests-integracao/barreiraDeInquilinoNoBanco.test.mjs`, que
afirma o estado sem barreira antes de afirmar o estado com barreira — porque um
teste que só prova o estado bom não distingue "a barreira funciona" de "não havia
nada para barrar".

## Consequências

**A favor:** o dado mais sensível deixa de ser a única exceção da barreira; o
contrato passa a descrever uma intenção verificável em vez de uma ausência; e o
conflito entre ADR-012 e ADR-036 sai do implícito.

**Contra, e assumido:** o contrato 0005 é o mais rígido do repositório e mexer
nele tem custo próprio — toda mudança futura no ledger passa a ter de manter
role, grants e policy coerentes, e errar qualquer um dos três derruba o portão de
migration inteiro, como aconteceu hoje.

## Pendente antes de implementar

1. Portão do cérebro sobre esta ADR.
2. Escrever a verificação nova e **vê-la reprovar o estado atual** antes de
   qualquer outra coisa.
3. Só então a etapa 3 da ADR-036 sai do bloqueio.

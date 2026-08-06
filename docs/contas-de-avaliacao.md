# Contas de avaliação (trial)

Acesso ao SellerCore com prazo, para alguém testar o produto por um período
combinado. Cada conta é um workspace isolado: quem testa não vê dado de ninguém,
e ninguém vê o dele.

## Como funciona

O prazo fica em `workspace_settings`, chave `trial` — tabela que já existia, sem
migration. O módulo é `src/lib/trial.ts`.

Ao **vencer**, `withAuthenticatedWorkspace` passa a responder **HTTP 403** com
`errorInfo.code = TRIAL_EXPIRED` e a conta deixa de abrir.

**Vencer não apaga nada.** A decisão é deliberada: bloquear é reversível
(estender a data devolve o acesso na hora), apagar não é. Excluir de fato é uma
ação separada e explícita — nunca automática por data.

## O que a pessoa vê

- **Modal** com "Você tem N dias de teste", datas e a nota. Traz uma caixa
  **"Entendi, não mostrar novamente"**:
  - fechar **sem marcar** → volta a aparecer na próxima sessão do navegador
    (controle por `sessionStorage`);
  - **marcando** → não aparece mais. A preferência é gravada no **servidor**
    (`acknowledgedAt` no mesmo registro), então vale em qualquer dispositivo;
  - período **vencido** ignora as duas coisas e mostra sempre — o aviso passa a
    ser a explicação de por que a conta parou de abrir, e a caixa some.
  - `setTrial` (novo período ou nota nova) **limpa** o "não mostrar": informação
    diferente merece ser lida de novo.
- **Faixa fixa no topo** com a contagem regressiva e a data limite; no último
  dia vira "Último dia de avaliação".
- Depois de vencido, o modal explica que o período terminou.

Componente: `src/app/components/TrialNotice.tsx`, montado no `AppShell`. Contas
normais não recebem nada — a rota `/api/trial` devolve `{ trial: null }`.

## Comandos

Todos com o prefixo:

```
node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/trial-account.mjs
```

| Ação | Variáveis |
|---|---|
| Criar | `ACTION=create EMAIL=... DAYS=20 [PASSWORD=...] [NOTE=...]` |
| Consultar | `ACTION=status EMAIL=...` |
| Trocar a nota | `ACTION=note EMAIL=... NOTE="..."` |
| Estender | `ACTION=extend EMAIL=... DAYS=10` |
| Excluir | `ACTION=delete EMAIL=... CONFIRM=SIM` |

`note` existe separado de `extend` porque `extend` **reinicia o período** a partir
de agora — não serve para ajustar só o texto.

A `NOTE` aparece dentro do modal para quem está testando; escrever em nome da
**equipe SellerCore**, não de uma pessoa.

Sem `PASSWORD`, o script gera uma senha forte e a imprime uma vez — repassar por
canal seguro, nunca em grupo ou chat aberto.

`delete` remove o usuário **e todos os dados do workspace** (tabelas listadas em
`TABLES_BY_WORKSPACE` no script). Exige `CONFIRM=SIM`; sem isso, recusa.

## Contas ativas

Ver [`estado-atual.md`](./estado-atual.md) — a lista com prazos vive lá, para não
duplicar informação que muda.

## Cuidado ao mexer

`withAuthenticatedWorkspace` aceita `{ allowExpiredTrial: true }` para as rotas
que **precisam** responder com o trial vencido — hoje só `/api/trial`, que é o
que permite a tela explicar o motivo em vez de simplesmente quebrar. Ao criar
uma rota nova nessa categoria (ex.: logout, cobrança), lembre desse parâmetro.

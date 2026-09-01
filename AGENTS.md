<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# O produto se chama NEXO

**SellerCore é o nome antigo.** Em qualquer texto que uma pessoa lê — tela, doc novo,
mensagem, commit — o produto é **NEXO**.

⚠️ **Isso NÃO autoriza um find-and-replace.** O identificador `sellercore` continua vivo
de propósito em três lugares que quebram se você mexer:

| Onde | Por que não trocar |
|---|---|
| `sellercore.onrender.com` | Segue cadastrada **na Amazon (SP-API) e no Mercado Livre**, onde o endereço novo entrou *ao lado* do antigo. Remover de lá **quebra o OAuth** desses dois. ⚠️ **Na Shopee e no TikTok já foi substituído** em 19–20/08 (campo único) — ver `docs/estado-atual.md` → "Domínio e OAuth". O host em si está **morto** (503): serve de identificador cadastrado, nunca de endereço para apontar algo novo. |
| `admin@sellercore.test`, `admin2@sellercore.test` | Contas reais no banco de produção. |
| Nomes de variável, arquivo e tabela | Renomear é churn sem ganho e conflita com tudo em andamento. |

A renomeação de verdade precisa de plano próprio (qual allowlist atualizar, em que ordem)
e **não foi pedida**. Está registrada em `TODO.md` → "Marca NEXO". Até lá: **texto novo diz
NEXO, identificador existente fica quieto.**

# Comece por aqui

**`docs/estado-atual.md`** — foto de onde cada frente parou, o passo exato para
retomar o que está no meio do caminho e o que está bloqueado esperando terceiros.
Leia antes de propor trabalho: metade do que parece "faltando" já está feito, e
parte do que parece pronto está esperando aprovação de marketplace.

Depois, `docs/README.md` para o mapa completo da documentação.

# Qualidade e segurança vêm antes de "só entregar"

Você não é só um desenvolvedor de features — é um dev responsável também por
**qualidade de software** e **segurança/vulnerabilidades**. Antes de fazer
qualquer coisa, bata o que vai fazer contra estes requisitos e só entregue
quando os cumprir:

- **Requisitos primeiro.** Entenda o que o pedido realmente exige (funcional e
  não-funcional) antes de codar. Se algo estiver ambíguo ou faltando, esclareça —
  não saia implementando por cima de suposição.
- **Qualidade por padrão.** Legibilidade, consistência com o padrão do código já
  existente, casos de borda, tratamento de erro e validação. Nada de meia-feature,
  gambiarra ou código morto. Ao terminar, revise se está limpo e coerente.
- **Segurança por padrão.** Não exponha segredos, valide entrada não-confiável,
  cubra rotas com auth, respeite RLS/menor privilégio e nunca deixe nada "aberto".
  Ao mexer em algo sensível (auth, tokens, storage, dados de conta), revise o
  impacto de segurança **antes** de concluir e sinalize qualquer brecha.

Regra prática: antes de dar por pronto, confirme os três — **funciona, está limpo,
não abre brecha**. Só então entregue.

# Arquitetura e decisões — leia antes de implementar

A arquitetura é **fonte de verdade no repo**. O mapa completo da documentação está em
`docs/README.md`. Antes de implementar algo que toque dados, sync, cache, auth ou um
canal, leia o(s) doc(s) relevante(s) — não re-deduza:

- Visão geral, contexto e mapa de arquivos: `docs/architecture/overview.md`
- Modelo canônico: `docs/architecture/canonical-model.md` (+ `docs/canonical-schema.md`)
- Ingestão e cron: `docs/architecture/sync-engine.md`
- Leitura por SQL e cache: `docs/architecture/read-and-cache.md`
- Decisões e trade-offs (o **porquê**): `docs/adr/`

**Não mude uma decisão arquitetural enquanto implementa.** Se uma feature exigir
mudar, **pare, explique e proponha um novo ADR** (`docs/adr/`) antes de codar.

# APIs dos marketplaces

**Cada API tem seus próprios endpoints e seu próprio calendário de dados — não
assuma a regra de um marketplace como se fosse global.** Regra da dona do
produto, 02/09/2026, verbatim: *"as apis tem seus proprios endpoints e nao faz
sentido fazer alterações globais, exemplo a amazon, ela nao disponibiliza o
faturamento na hora, mas shopee sim, nao assuma regras de outros marketplaces
como se fosse algo global"*.

Na prática: replicar uma correção entre canais é replicar a **garantia** (ex.:
"lucro não some por dado que ainda não chegou"), nunca o **mecanismo** — e antes
de portar qualquer mecanismo, **meça o que a API daquele canal realmente entrega
e quando**. A Amazon precisa de tarifa estimada porque publica preço e tarifa
tarde; um canal que publica na hora pode não precisar de estimativa nenhuma — e
implantá-la lá seria resolver um problema que o canal não tem.

Antes de mexer em qualquer integração, leia a documentação interna — ela registra os endpoints usados e as pegadinhas já pagas caro (semântica de PATCH da Amazon, regra de faturamento do ML, etc.):

- `docs/api-amazon-sp-api.md` — SP-API: endpoints, selectors do PATCH, orderMetrics vs Transactions, FNSKU/FBA
- `docs/api-mercado-livre.md` — ML: endpoints, regra do faturamento (aprovadas+canceladas, sem frete), webhooks
- `docs/api-shopee.md` — Shopee Open Platform v2 (**implementada; aguardando Go Live para conectar loja real**): assinatura HMAC validada em sandbox, OAuth, escrow, limites reais (janela de 15 dias, 50 pedidos por detalhe), App Types
- `docs/amazon-ads.md` — **Amazon Ads API** (aprovada 25/08/2026): endpoints, o corpo do relatório assíncrono, e o "Changelog observado" com o que a API faz de verdade — inclusive que ela **entrega o dia corrente**, ao contrário do que já foi afirmado aqui
- `docs/conexoes-que-expiram.md` — por que a autorização de cada canal cai e como evitar

Cada doc de API termina num **"Changelog observado"** (datado, mais recente primeiro).
Os marketplaces mudam comportamento sem aviso — ao esbarrar numa mudança nova, registre
lá na hora.

# Teste novo só conta depois de ter falhado

**Quebre o código de propósito, veja o teste ficar vermelho, desfaça.** Teste que
nunca foi visto vermelho é decoração: ele passa desde o primeiro dia e ninguém
sabe se passa porque o código está certo ou porque a asserção não toca o código.

⚠️ **Isto não é zelo — é a correção de um erro que aconteceu três vezes em
31/08/2026, sempre com a mesma forma:**

| onde | o teste garantia | e não garantia |
|---|---|---|
| declaração da base da margem | que a **frase existia** | que ela fosse **lida** (estava num tooltip) |
| `from`/`to` na rota da Shopee | que a **string** `searchParams.get("from")` existisse | que o valor fosse **usado** (o bloco foi apagado e o teste ficou verde) |
| itens do pedido pendente | — | que o banco vazio vinha da **nossa** consulta, não da API |

A família toda é a mesma: **casar a existência de um símbolo não prova
comportamento nenhum.** Um `assert.match(fonte, /nomeDaFuncao/)` continua verde
depois de alguém apagar a chamada e deixar o import.

**Na prática:**

- ao escrever o teste, **desfaça a correção** (ou apague a linha que importa) e
  rode. Se não ficar vermelho, o teste não cobre o que você acha que cobre;
- prefira asserção sobre **comportamento** (chamar a função e conferir a saída) a
  asserção sobre **texto do fonte**. Quando só der para olhar o fonte — porque o
  alvo é JSX ou uma rota —, case a **ramificação**, não o identificador:
  `if (fromValue || toValue)` prova uso; `searchParams.get("from")` não prova
  nada;
- **casar texto do fonte pega o COMENTÁRIO também.** Quando só der para olhar o
  fonte, ancore a asserção **dentro da chamada**, nunca numa frase solta.
  Aconteceu em 31/08/2026, e o teste era justamente o que reprovava esta
  família: `assert.match(fonte, /filaDeFundo: false/)` ficava verde depois de
  apagar a propriedade, porque a frase existia no comentário logo acima da
  chamada. O que reprova é a chamada inteira —
  `usePrefetchDePeriodos({ … filaDeFundo: false, });` —, não o par
  `chave: valor` avulso. E só apareceu porque as quebras foram rodadas uma a
  uma: **confiar no verde é como o teste decorativo sobrevive.**
- **Asserção que PROÍBE uma string tem de olhar o fonte SEM COMENTÁRIOS** —
  sempre, sem exceção. Isto não é zelo: em 01/09/2026 a mesma armadilha pegou
  quatro vezes em dois dias, com a regra acima já escrita. O motivo é
  estrutural, e por isso não adianta lembrar-se dela: **o comentário que explica
  por que algo é proibido cita a coisa proibida.** `assert.ok(!/useSearchParams/)`
  reprova o texto que documenta a remoção do `useSearchParams`; `!/janelaDeDias/`
  reprova a nota que conta por que o arquivo foi apagado. O mínimo obrigatório é
  uma linha:

  ```js
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ```

  Asserção que EXIGE uma string pode casar o fonte cru — comentário a mais nunca
  fez `assert.match` passar indevidamente. É só a proibição que precisa da
  limpeza.
- e diga no próprio teste **qual defeito ele reprova**, com o número que ele teve
  no mundo real. Teste sem essa frase vira o primeiro a ser afrouxado quando
  ficar vermelho por outro motivo.

**Casar o nome de uma variável não prova de onde ela vem.** Guarda que confere
que o cálculo usa `faturamentoDaTela` continua verde quando alguém troca a
FONTE dessa variável uma linha acima — o nome não muda, a origem sim
(02/09/2026, ticket médio). Ancore a asserção na **definição** (de onde o valor
nasce), não no uso. E o padrão que gera esses defeitos, medido três vezes em
dois dias: **nome plausível + tipo que não distingue + falha silenciosa** —
TypeScript feliz, SQL sem erro, e só a medição do EFEITO (linhas atualizadas,
divisão conferida) denuncia.

**Dado que não exercita a regra não testa a regra.** Quando a amostra real fica
inteira de UM lado de uma fronteira (teto de faixa, kg adicional, limite de
paginação), a fronteira nunca é exercida — e o teste que só usa dados reais fica
verde com a regra errada dos dois lados. Aconteceu em 01/09/2026: a faixa de
comissão foi implementada como alíquota única quando a página diz marginal
("15% até R$ 100; 10% **no excedente**" — progressiva, como imposto de renda);
todos os produtos da conta custam R$ 14–38, abaixo do teto, onde as duas
leituras coincidem — o defeito nasceria calado no primeiro produto caro. É o
irmão do "desconfie de zero": ali o número não aparecia, aqui o CASO não
aparecia. **Teste de regra com fronteira usa valores fabricados dos dois lados
da fronteira**, não só os dados que a conta tem hoje.

**Teste vermelho por motivo que não é o produto** — formatação, corte de string,
uma janela de `slice` fixa — ensina a ignorar teste vermelho, e é tão ruim quanto
teste que nunca falha. Conserte a fragilidade, não o sintoma.

# Recusa temporária morre junto com a limitação que a justificou

Salvaguarda escrita para contornar um limite — *"este canal ainda não aceita X,
então não peça"* — é **dívida com prazo**, não desenho. Quando o limite cai,
ela precisa cair junto. Enquanto sobrevive, ela deixa de proteger e passa a
**mentir**.

⚠️ **Aconteceu em 31/08/2026, com 4 horas de distância entre as duas pontas.** A
rota da Shopee passou a aceitar período personalizado (`4c1cc18`) e a central
continuou recusando, com a frase na tela:

> *"a Shopee ainda não aceita período personalizado; escolha Hoje, 7, 15 ou 30
> dias para ver este canal"*

A frase era verdadeira de manhã e falsa à tarde. Ela **escondia um canal que já
sabia responder** — e o pior não foi a frase:

**O TESTE QUE GUARDAVA A RECUSA PASSOU A DEFENDER O DEFEITO.** Ele exigia que a
recusa existisse. Quem removesse a mentira quebraria a suíte, e o vermelho diria
que a *correção* estava errada.

**Na prática:**

- ao escrever uma recusa temporária, diga no comentário **o que precisa
  acontecer para ela morrer** — o commit, a rota, a capacidade;
- ao remover uma limitação, **procure quem a contornava**. `grep` pela frase que
  aparece na tela é o caminho mais curto;
- ao escrever o teste de uma recusa, escreva-o sabendo que ele será invertido:
  registre a intenção anterior no próprio teste quando ela mudar, como já se faz
  com os testes que mudaram de intenção duas vezes;
- **divergência sem mentira é dívida; divergência com mentira é defeito** e sobe
  na fila na hora. (Critério do cérebro, 31/08/2026. Exemplo de dívida: as rotas
  de ABC lerem só `days` enquanto a tela do ABC não oferece "Personalizado" —
  ninguém é enganado. Exemplo de defeito: a central acima.)

# O que subiu é o que está no commit, não o que o HTTP responde

Para provar o que foi publicado, leia a **árvore do commit**:

```
git ls-tree -r <commit> --name-only | grep <caminho>
```

⚠️ **Probe HTTP não distingue rota ausente de rota presente** neste app. Medido
em 31/08/2026 contra produção: `/api/qualquer-coisa-inexistente` devolve **401**
(o middleware de auth responde antes do roteador) e `/qualquer-pagina` devolve
**307** para o login. Testar `/ads` e receber 307 não prova que a aba de Ads não
subiu — prova só que existe middleware.

É a mesma família de **"ausência de escrita não é ausência de tentativa"**: um
sintoma compatível com a hipótese não é prova dela.

# Migration que muda ONDE o dado mora: "quem lê isso agora?" ANTES do apply

Toda migration que **move** dado — tabela nova, view nova, coluna que troca de
lugar, linhas apagadas — passa por uma pergunta antes de ser aplicada:

> **Quem lê isso hoje, e esse leitor já sabe ler no lugar novo?**

Se a resposta for "ainda não", o apply e a troca do leitor são **um passo só**,
não dois — mesmo que estejam em commits diferentes, precisam entrar na mesma
janela, com o leitor pronto antes.

⚠️ **O ESTADO QUE ISSO EVITA JÁ ACONTECEU (01/09/2026, `migrations/0022`).** A
migration criou `workspace_channel_order_fee_estimates` e apagou as 552 linhas
de `workspace_channel_order_fees` com `fee_type = 'estimated'`. O leitor da tela
ainda apontava para as linhas apagadas. Resultado, em produção, entre o apply e
a correção: **as Taxas da Amazon ficaram subestimadas** — a estimativa existia no
banco e não entrava em nenhuma conta.

Ninguém errou uma decisão: a migration estava certa, o leitor estava certo para o
mundo anterior, e o portão de migration confere *árvore limpa e plano assinado*,
não *coerência entre schema e leitor*. **É um estado que nenhuma das duas
revisões pega sozinha**, e por isso vira passo explícito.

**Na prática, antes de autorizar o apply:**

1. liste o que a migration **remove ou move** (não o que ela cria — criar é
   aditivo e não quebra ninguém);
2. `grep` por cada nome removido em `src/` — tabela, coluna, valor de enum. O
   `fee_type = 'estimated'` deste caso aparecia em três lugares;
3. para cada ocorrência, decida: **troca junto** ou **por que pode esperar**;
4. se a troca for junto, combine a ordem na janela — normalmente
   *apply → leitor → reprocessamento* — e diga qual é o **estado intermediário
   visível** e quanto ele dura. No caso da 0022 era "Tarifas não postadas" no
   pendente, que é o modo de falha correto da ADR-027, mas é visível para a
   vendedora;
5. e diga o que **NÃO** pode aparecer nesse intervalo. Ali era `R$ 0,00`:
   desconhecido é ausência de linha, zero é fato da fonte.

📌 O corolário, que vale além de migration: **quando o dado muda de casa, o
silêncio do leitor antigo não é erro — ele lê o lugar certo, que ficou vazio.**
Nada fica vermelho. Só a tela fica errada.


# Isolamento entre inquilinos — as duas garantias que sustentam tudo

O NEXO é multi-inquilino, e a pergunta da dona do produto em 31/08/2026 é o
critério: *"Integrações diferentes não podem misturar dados umas com as outras.
**Nossos futuros clientes não podem ter esse problema.**"*

Duas propriedades do código respondem por isso. Quem mexer em qualquer uma
precisa saber o que está desfazendo:

**1. `currentWorkspaceId()` LANÇA quando não há escopo — e não tem default.**
Escrever ou ler fora de um `runWithWorkspace` **quebra**, em vez de gravar no
lugar errado ou devolver o banco inteiro. É o modo de falha certo: **falhar alto
em vez de falhar silencioso.** Um `?? "default"` ali dentro transformaria toda
leitura fora de contexto num vazamento — e nada ficaria vermelho para avisar.

É o oposto exato da lista negra que este projeto matou em 31/08/2026
(`fee_type NOT IN (...)`), onde o desconhecido entrava por padrão. Aqui o
desconhecido **para tudo**.

**2. `connection_id` vindo do cliente é filtro ADICIONAL, nunca substituto.**
Três rotas aceitam `connection_id` por query string (`shopee/settings`,
`tiktok/overview`, `sync-estado`). As três são seguras porque o valor pedido só
**escolhe dentro** de uma lista que já nasceu filtrada por `workspace_id`, ou
entra como `AND` sobre um `WHERE workspace_id` que sempre existe. Pedir a conexão
de outro inquilino devolve **vazio**, nunca o dado dele.

⚠️ A regra que isso vira: **parâmetro do cliente pode ESTREITAR o escopo, nunca
defini-lo.** No dia em que alguém usar um id vindo da requisição como chave
primária de busca sem o `workspace_id` ao lado, a porta abre.

**Nenhuma rota aceita `workspace_id` por parâmetro, header ou body.** O workspace
vem só de `claims.sub` (`workspaceContext.ts`). Isso não é acidente e não pode
virar conveniência de debug.

## Os portões que provam isso, e o que cada um NÃO prova

| portão | prova | não prova |
|---|---|---|
| `tests/workspaceIdNaoDependeDeLembranca` | que todo SQL de `src/` **escreve** o filtro | que ele **acontece** |
| `tests/workspaceScope` | que dois escopos concorrentes não se misturam | nada sobre SQL |
| `tests-integracao/isolamentoEntreInquilinos` | **comportamento**, contra Postgres: dois inquilinos na mesma conexão, e a leitura de um nunca alcança o outro | — |

⚠️ **Ao escrever teste de isolamento, monte o cenário em que o `workspace_id` é a
ÚNICA coisa que separa os dois inquilinos.** A primeira versão do teste de
integração deu `connection_id` diferente a cada um e ficou **verde com os 13
filtros de `workspace_id` neutralizados** — quem separava era o `connection_id`.
Se qualquer outra coluna distingue os inquilinos, o teste mede essa outra coluna.


# Script de cura itera inquilinos por padrão

**Todo script que CURA dado — backfill, re-sync, reprocessamento, correção em
massa — varre todas as conexões do canal, em todos os workspaces.** Rodar numa
conta só é a **exceção**, exige um parâmetro explícito (`--conexao <id>`) e um
motivo escrito. Nunca o contrário.

⚠️ **A regra nasceu de um erro real, em 01/09/2026.** Os backfills daquele dia
nasceram com `workspace_id` e `seller_id` **fixos no código**, porque o defeito
apareceu numa conta. A conta da própria dona do produto vive em **outro
workspace** — e ficou de fora de todas as curas do dia. Nada ficou vermelho: os
scripts rodaram, disseram "concluído", e cobriram uma fração.

A doutrina dela é de 23/08/2026 e não mudou: *"o app é multi-inquilino; curar
dado é na tabela inteira, não só na conta dela"*. Constante de workspace num
script de cura viola isso **em silêncio**.

**Na prática:**

- o alvo sai de uma **consulta**, não de uma constante:
  `SELECT DISTINCT workspace_id, connection_id FROM workspace_channel_orders
   WHERE provider = $1`;
- o relatório final diz **quantas conexões existem e quantas foram
  processadas** — as duas, para que cobrir uma de três seja visível;
- e **conta de demonstração fica de fora** por nome, não por acaso: ela não tem
  token e falharia no meio do laço.

📌 E o corolário que vale além do script: **o defeito aparece numa conta; a
causa mora no código.** Se a correção é de código, ela já é global — mas o dado
que o defeito produziu enquanto existia está em todas as contas que passaram
por ele.

⚠️ **Duas vias de credencial convivem, e ignorar isso quebra a conta dona.**
Conexão com token guardado em `workspace_accounts` usa o par do app-dash, dentro
de `runWithAccount`. A conta dona é atendida pelo par do `.env`, e
`getAccessToken` só cai nesse caminho quando `currentAccount()` é **nulo** — ou
seja, **fora** de `runWithAccount`. Envolver as duas do mesmo jeito estoura em
`conta.refreshToken` de `undefined`.

# Como este projeto trata dado incerto

Três regras que atravessam o código todo e não são negociáveis sem ADR:

- **`null` ≠ `0`.** Taxa, frete ou custo desconhecido é `null`; zero é um fato
  ("não houve frete"). Confundir os dois corrompe lucro, margem e a cobertura
  que o dashboard exibe.
- **Não extrapolar.** Enquanto tarifas e fretes não estiverem completos, o painel
  mostra só o que foi capturado — nunca projeta o resto. **Exceção nomeada
  ([ADR-027](docs/adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md)):** número
  **publicado pela própria fonte** (a tabela de tarifas da Amazon, via Product
  Fees API) pode ocupar o lugar do oficial enquanto ele não chega, **marcado na
  tela** e substituído na liquidação. Média histórica calculada por nós continua
  proibida — é isso que a regra sempre quis impedir.
- **Nunca escrever "parcial" na tela.** A palavra explica ao vendedor uma coisa que
  ele já sabe (o que ele cadastrou e o que não cadastrou) e não diz o que fazer.
  Diga **o que falta, com número e link**: "3 unidades sem custo cadastrado →",
  "2 pedidos sem repasse postado", "falta a alíquota de imposto". Correção dela em
  23/08/2026: *"não precisa mostrar que é parcial […] o user sabe o que está
  cadastrado; se tem venda e não tem custo, fica apontado lá que o custo não está
  cadastrado"*. Vale para "parcial", "incompleto" e qualquer adjetivo que se
  desculpe em vez de apontar.
- **Tela sem dado mostra o estado real** ("conecte uma loja", "sincronização
  pendente"), nunca zeros que pareçam "não vendeu nada".

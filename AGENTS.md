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
- e diga no próprio teste **qual defeito ele reprova**, com o número que ele teve
  no mundo real. Teste sem essa frase vira o primeiro a ser afrouxado quando
  ficar vermelho por outro motivo.

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

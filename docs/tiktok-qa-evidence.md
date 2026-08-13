# QA local da TikTok Shop real

Este procedimento valida, sem mutacao e sem expor dados sensiveis, a cadeia
TikTok Shop -> banco canonico -> overview -> API interna. O script nunca imprime
workspace, loja, pedido, token, cookie, payload ou PII e recusa renovar token.

## Evidencia agregada

```powershell
node --experimental-strip-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/tiktok-qa-evidence.mjs
```

A janela termina no `covered_to` da conexao com ownership global exclusivo, para
comparar a mesma foto em todas as camadas sem confundir pedidos novos ainda nao
sincronizados. Antes de ler tokens ou consultar a origem, o harness verifica que
a identidade externa pertence a exatamente um workspace. Duplicidade bloqueia
com `OWNERSHIP_CONFLICT`; ela nunca e tratada como replica de QA nem filtrada para
fazer o teste passar. A saida informa somente a janela exata, quantidade de
paginas/pedidos retornada pela origem, contagem/receita do banco, o contrato
`historicalCheckpoint` fechado no checkpoint e o agregado sanitizado
`currentWindow` ate agora. `currentWindow` contem somente `orders`, `revenue` e
`coverage.revenue`: nao inclui IDs, payloads nem detalhes financeiros ou sensiveis.
A contagem da origem deve ser comparada a `allOrders`; o overview usa apenas os
status de receita e deve ser comparado a `revenueOrders`.

**Evidencia historica, nao um PASS atual:** em 11/08/2026, uma leitura paginada
somente leitura respondeu com sucesso:
48 paginas e 2.393 linhas/pedidos unicos na janela iniciada em 27/07/2026
00:00 BRT e fechada no checkpoint comum. Como a
origem e paginada enquanto pedidos podem mudar, o harness tambem deduplica os
identificadores em memoria e informa `uniqueOrders`/`duplicateRows` sem revelar
nenhum identificador. Cada uma das duas copias entao existentes tinha 1.945
pedidos elegiveis para receita e R$ 34.186,88;
o overview repetiu esses agregados. Em `historicalCheckpoint`, a receita da
janela fechada no checkpoint estava `complete`; em `currentWindow` (ate agora),
estava `partial`. Taxas
estavam `pending`, e taxas/lucro/margem/ROI permaneceram `null` no
`historicalCheckpoint`, nunca zero. Esses campos da janela corrente sao
deliberadamente omitidos da evidencia minima; o harness nao os converte em zero.

As duas copias revelam um conflito legado real com a regra atual de ownership
global. Enquanto ele existir, leitura de loja, rotas TikTok e scheduler ficam
corretamente fail-closed, e este harness deve encerrar antes da chamada externa.
A remediacao exige escolher o workspace owner e reconciliar os registros
dependentes; isso e mutacao remota de fronteira de tenant e nao faz parte deste
procedimento somente leitura.

## API e UI autenticadas no localhost

O projeto nao possui bypass de autenticacao. Com uma sessao local ja autenticada,
passe o cookie somente no ambiente do processo:

```powershell
$env:SELLERCORE_HEALTH_COOKIE = '<cookie completo da sessao local>'
node --experimental-strip-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/tiktok-qa-evidence.mjs
Remove-Item Env:SELLERCORE_HEALTH_COOKIE
```

Nao grave o cookie em arquivo, issue ou log. A saida deve mostrar
`api.status=PASS`, HTTP 200, os mesmos agregados e estados de cobertura. Abra
`/tiktok` na mesma sessao: Faturamento deve ser numerico; Taxas, Lucro, Margem e
ROI devem mostrar travessao e contexto de dado pendente/parcial.

Sem sessao local existente, a etapa fica corretamente bloqueada. Criar cookie
sintetico, usar chave administrativa ou afrouxar o middleware nao e aceitavel.

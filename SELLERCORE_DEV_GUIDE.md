# SellerCore — guia de desenvolvimento

Antes de iniciar ou retomar uma frente, leia [`docs/estado-atual.md`](./docs/estado-atual.md)
e o mapa em [`docs/README.md`](./docs/README.md). As decisões de arquitetura e as
regras de dados do repositório continuam sendo a fonte de verdade.

## Gate contínuo de saúde

Trabalho paralelo não termina quando os testes isolados de cada frente passam. Sempre
que duas ou mais frentes forem integradas no mesmo working tree — por merge, rebase,
cherry-pick, aplicação de patch ou edição concorrente sobre arquivos compartilhados — o
responsável pela integração deve executar o **gate integrado real** descrito em
[`docs/gate-continuo-de-saude.md`](./docs/gate-continuo-de-saude.md).

O mínimo obrigatório é validar a aplicação integrada em `localhost:3000`: compilação,
runtime, imports/exports, rotas, APIs internas e a interação entre as mudanças. Para
TikTok Shop e Shopee, as páginas devem carregar e os fluxos de leitura devem consumir os
dados reais que estiverem legitimamente disponíveis, sem provocar mutação externa e sem
registrar ou expor PII, tokens, cookies, headers de autorização ou outros segredos.

Um produto quebrado é regressão bloqueante imediata: o gate fica `FAIL`, a entrega ou
nova integração para, e a correção recebe responsável explícito antes da retomada. O
gate contínuo reduz regressões durante o desenvolvimento, mas **não substitui o QA
independente final**.

Todo relato deve distinguir o alcance comprovado: validação local, local autenticada,
marketplace real, produção e banco remoto. Não declare uma camada como validada por
inferência a partir de outra.

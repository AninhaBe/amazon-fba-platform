<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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

# APIs dos marketplaces

Antes de mexer em qualquer integração, leia a documentação interna — ela registra os endpoints usados e as pegadinhas já pagas caro (semântica de PATCH da Amazon, regra de faturamento do ML, etc.):

- `docs/api-amazon-sp-api.md` — SP-API: endpoints, selectors do PATCH, orderMetrics vs Transactions, FNSKU/FBA
- `docs/api-mercado-livre.md` — ML: endpoints, regra do faturamento (aprovadas+canceladas, sem frete), webhooks

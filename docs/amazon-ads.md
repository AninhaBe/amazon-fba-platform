# Amazon Ads — o que se aplica à conta NEXAHUB BR

Levantado em **02/08/2026**. O help hub do Seller Central **não documenta Ads**: o artigo
`G200663330` só redireciona para o suporte do Amazon Ads. As fontes reais são
`advertising.amazon.com/pt-br`.

## O que a conta pode usar hoje

| Formato | Requisito | Disponível para ela? |
| --- | --- | --- |
| **Sponsored Products** | Vendedor profissional; produto não pode ser adulto, usado, recondicionado ou de categoria fechada | ✅ **sim** |
| **Sponsored Brands** | "vendedores profissionais **inscritos no Registro de Marcas**" | ❌ não — produtos são Genérico |
| **Sponsored Display / Stores** | Proprietário de marca registrada | ❌ não |

**Consequência prática: só existe Sponsored Products.** Todo o resto depende de Brand
Registry, e os anúncios dela são Genérico por decisão de negócio (ver
`anuncios-sempre-generico` na memória). Não perder tempo estudando Sponsored Brands.

## Mecânica

- **Leilão de CPC**: paga só no clique, e o lance é escolhido por você.
- **Orçamento diário mínimo no Brasil: R$ 50** (guia oficial de conceitos básicos).
- **Segmentação automática**: a Amazon casa o anúncio com as buscas usando os dados do
  próprio anúncio. É por isso que **título, marcadores e termos de busca alimentam o Ads** —
  anúncio mal preenchido segmenta mal.
- **Segmentação manual**: o guia recomenda **no mínimo 30 palavras-chave**, começando em
  correspondência **ampla** e refinando depois para **frase** e **exata**.

## Pré-condições que a documentação assume e ninguém avisa

1. **Estoque comprável.** Oferta sem estoque não é a Oferta em destaque, e sem Oferta em
   destaque o Sponsored Products não veicula. Com os 6 SKUs zerados, campanha ligada hoje
   não entrega nada.
2. **Anúncio em conformidade.** Anúncio suprimido não aparece nem organicamente. Corrigir
   **título (75 caracteres)** e **capa (fundo branco, sem texto)** antes de pagar por
   clique — ver [amazon-politicas.md](./amazon-politicas.md).
3. **Oferta em destaque**: "os vendedores devem atender aos requisitos baseados em
   desempenho para se qualificarem". Em ASIN Genérico exclusivo dela não há disputa, mas a
   oferta precisa estar comprável.

## Roteiro recomendado (ordem importa)

1. **Repor estoque.** Sem isso, nada do resto importa.
2. **Corrigir título e capa** dos SKUs que vão ser anunciados.
3. **Uma campanha automática**, lance baixo, um grupo por produto. Deixar rodar **2 a 3
   semanas** sem mexer — é coleta de dados, não performance.
4. **Colher os termos de busca** no relatório: o que converteu vira campanha manual em
   correspondência **exata**; o que gastou sem converter vira **palavra-chave negativa**.
5. **Comparar ACOS com a margem real** — o custo já está cadastrado no SellerCore, então a
   margem por SKU é conhecida. ACOS acima da margem = prejuízo por clique.
6. **Não anunciar os 6 de uma vez.** Começar pelo de melhor margem e maior estoque.

## Ligações com o SellerCore

- **Margem por produto** (`/produtos` + curva ABC) é o teto do ACOS aceitável.
- **Histórico de ranking** (ADR-009/011) mostra o efeito do anúncio no BSR — a campanha
  deveria empurrar a posição para baixo (melhor) em poucos dias.
- **Histórico de oferta** (ADR-010) explica queda de veiculação por ruptura de estoque.

## Fontes

- [Sponsored Products](https://advertising.amazon.com/pt-br/solutions/products/sponsored-products)
- [Sponsored Brands](https://advertising.amazon.com/pt-br/solutions/products/sponsored-brands)
- [Guia de conceitos básicos para anúncios patrocinados](https://advertising.amazon.com/pt-br/library/guides/getting-started-with-sponsored-ads)
- [Guia de Sponsored Products para novos anunciantes](https://advertising.amazon.com/pt-br/library/guides/new-advertiser-success-guide)
- [Políticas de anúncios patrocinados](https://advertising.amazon.com/pt-br/resources/ad-policy/sponsored-ads-policies)
- Seller Central `G200663330` (só redireciona)

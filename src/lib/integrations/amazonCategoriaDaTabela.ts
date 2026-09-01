/**
 * O MAPEAMENTO da classificação do catálogo da Amazon para a categoria da
 * tabela de comissão. **É a parte com juízo, e por isso é explícita.**
 *
 * A Catalog Items devolve uma árvore de navegação (`Mouse Pads` → `Acessórios` →
 * … → `Computadores e Informática`). A tabela de preços usa outro vocabulário,
 * mais curto. Os dois não coincidem, e a tradução é uma decisão nossa — não um
 * dado da Amazon.
 *
 * ⚠️ **CLASSIFICAÇÃO SEM MAPEAMENTO NÃO CAI EM "Demais categorias".** Fica SEM
 * estimativa, e a tela aponta. O motivo é aritmético: "Demais categorias" é 15%,
 * e aplicá-lo a uma categoria que na verdade é 10% **infla a tarifa em 50%** —
 * com cara de número oficial, que é o pior desfecho possível para uma feature
 * cuja razão de ser é procedência.
 *
 * "Demais categorias" existe para a categoria que a TABELA não cobre, nunca para
 * o mapeamento que NÓS não fizemos. Confundir as duas transforma uma lacuna
 * nossa numa afirmação sobre a Amazon.
 */
import { TABELA_DE_COMISSAO_AMAZON_BR, type CategoriaDaTabela } from "./amazonTabelaDeComissao";

/**
 * Por RAIZ da árvore. Cobre o caso comum, em que a raiz já determina a tarifa.
 *
 * As chaves são exatamente como a Catalog Items escreve — medidas nos 76 ASINs
 * capturados em 01–02/09/2026, não inventadas.
 */
const POR_RAIZ: Record<string, string> = {
  "Automotivo": "Peças automotivas",
  "Beleza": "Beleza",
  "Brinquedos e Jogos": "Brinquedos e jogos",
  "Casa": "Casa",
  "Cozinha": "Cozinha",
  "Ferramentas e Materiais de Construção": "Ferramentas e Construção",
  "Jardim e Piscina": "Jardim e Piscina",
  "Moda": "Roupas e acessórios",
  "Papelaria e Escritório": "Papelaria e Escritório",
  "Pet Shop": "Pets",
  "Saúde e Bem-Estar": "Saúde e cuidados pessoais",
  // ⚠️ "Computadores e Informática" NÃO está aqui, e a ausência é deliberada.
  //
  // A raiz é ambígua entre duas linhas da tabela com tarifas MUITO diferentes:
  // "PC" é 12% fixo, e "Acessórios para eletrônicos e PC" é 15% até R$ 100 e 10%
  // acima. Um notebook e um mouse pad moram na mesma raiz e pagam tarifas
  // distintas. Mapear a raiz escolheria uma das duas para todo mundo.
  //
  // A folha resolve, e as folhas conhecidas estão em POR_FOLHA. Folha nova nessa
  // raiz fica sem estimativa até alguém decidir — que é o comportamento certo:
  // a dúvida aparece na tela em vez de virar número.
};

/**
 * Por FOLHA, para quando a raiz não decide. Tem precedência sobre a raiz.
 */
const POR_FOLHA: Record<string, string> = {
  // Medido: o mouse pad sai a 15% no Gestor Seller, coerente com a faixa até
  // R$ 100 de "Acessórios para eletrônicos e PC".
  "Mouse Pads": "Acessórios para eletrônicos e PC",
  "Bolsas Organizadoras de Cabo": "Acessórios para eletrônicos e PC",
};

export interface CategoriaResolvida {
  categoria: CategoriaDaTabela;
  /** De onde veio a decisão, para a tela poder dizer. */
  por: "folha" | "raiz";
  /** O nome da classificação que casou. */
  classificacao: string;
}

/**
 * Resolve a categoria da tabela. `null` = não mapeado — e `null` é uma resposta
 * legítima, não uma falha a ser contornada.
 */
export function categoriaDaTabela(
  folha: string | null | undefined,
  raiz: string | null | undefined,
): CategoriaResolvida | null {
  if (folha && POR_FOLHA[folha]) {
    return { categoria: TABELA_DE_COMISSAO_AMAZON_BR[POR_FOLHA[folha]], por: "folha", classificacao: folha };
  }
  if (raiz && POR_RAIZ[raiz]) {
    return { categoria: TABELA_DE_COMISSAO_AMAZON_BR[POR_RAIZ[raiz]], por: "raiz", classificacao: raiz };
  }
  return null;
}

/** As raízes que ainda não têm mapeamento, para a tela apontar o que falta. */
export function raizMapeada(raiz: string | null | undefined): boolean {
  return Boolean(raiz && POR_RAIZ[raiz]);
}

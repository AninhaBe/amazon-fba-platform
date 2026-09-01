/**
 * A TABELA DE COMISSÃO DA AMAZON BRASIL — publicada pela própria Amazon.
 *
 * **Fonte:** https://venda.amazon.com.br/precos — página pública de preços para
 * vendedores, não área logada, não raspagem.
 * **Capturada em:** 31/08/2026.
 *
 * (A data e a da CAPTURA DA PAGINA, nao a da escrita deste arquivo — foram
 * dias diferentes, e a que prova alguma coisa e a primeira.)
 *
 * ⚠️ **ESTA TABELA NÃO É AUTORIDADE PRÓPRIA — ELA É UMA CÓPIA COM DATA.** A
 * Amazon muda percentual sem aviso, e no dia em que mudar esta constante passa a
 * mentir com cara de número oficial. Quem for revisar: abra a URL acima, compare
 * linha a linha, e **atualize a data** mesmo que nada tenha mudado — data velha
 * é o único sinal de que ninguém conferiu.
 *
 * 📌 Por que uma tabela e não a Product Fees API: a decisão é da dona do produto
 * (02/09/2026). A API responde por ASIN e exige chamada por produto; a tabela
 * responde por categoria, é instantânea, e cobre o **ASIN que nunca vendeu** —
 * que é justamente o caso em que não há tarifa observada para copiar.
 *
 * 📌 E ela BATE com o que medimos de forma independente, o que é a razão de
 * confiar nela: 12% nos kits de casa e cozinha (Gestor Seller), 14% no cadarço
 * (Roupas e acessórios) e 15% no mouse pad (Acessórios para eletrônicos e PC,
 * abaixo de R$ 100).
 *
 * ⚠️ **DUAS CAPTURAS DA MESMA PÁGINA DIVERGIRAM, E A MEDIÇÃO DESEMPATOU
 * (01/09/2026).** `docs/tarifas-amazon-br.md` (capturado 31/08) e a leitura
 * trazida ao chat no mesmo dia discordam em várias linhas. Medi a comissão
 * EFETIVA por categoria no nosso próprio extrato — só linhas `Commission`
 * decompostas, pedidos de uma linha só, preço conhecido:
 *
 * | categoria | medido | doc | chat |
 * |---|---|---|---|
 * | Papelaria e Escritório | 12,03% (1.274 pedidos) | 12% ok | 13% ERRADO |
 * | Beleza | 12,01% (103) | 12% ok | 13% ERRADO |
 * | Roupas e acessórios (Moda) | 14,03% (701) | 15% ERRADO | 14% ok |
 * | Cozinha | 12,04% (422) | 12% ok | 12% ok |
 * | Saúde | 12,01% (149) | 12% ok | 12% ok |
 * | Jardim e Piscina | 12,01% (124) | — | 12% ok |
 * | Pets | 12,02% (31) | 12% ok | 12% ok |
 * | Brinquedos | 12,01% (11) | 12% ok | 12% ok |
 *
 * **Nenhuma das duas capturas está inteiramente certa.** Esta constante segue a
 * MEDIÇÃO onde ela é forte. Isso não faz do nosso extrato a autoridade — faz
 * dele o árbitro quando duas leituras da mesma página se contradizem.
 *
 * ⚠️ **AINDA EM ABERTO, e não afeta nenhum pedido de hoje:** o teto da faixa de
 * "Acessórios para eletrônicos e PC" (R$ 100 no chat, R$ 750 no doc) e o de
 * "Móveis" (R$ 200 contra R$ 1.500). Os tickets medidos ficam entre R$ 14 e
 * R$ 38, muito abaixo dos dois tetos, então a divergência não muda número
 * nenhum hoje — mas muda no primeiro produto caro, e por isso está escrita aqui
 * em vez de escondida.
 *
 * ⚠️ E DUAS CATEGORIAS MEDIRAM ENTRE OS DOIS VALORES, sem desempate:
 * Ferramentas e Construção deu 11,56% (283 pedidos) contra 11% no chat e 12% no
 * doc, e Casa deu 11,19% com apenas 15 pedidos. As duas raízes provavelmente
 * misturam folhas de categorias diferentes — número intermediário é média de
 * duas tarifas, não uma tarifa. Ficam como estão até alguém abrir a página.
 */

/** Uma faixa de preço com percentual próprio. `ate` em reais, `null` = sem teto. */
interface FaixaDeComissao {
  ate: number | null;
  percentual: number;
}

export interface CategoriaDaTabela {
  /** O nome como a Amazon escreve na página. */
  nome: string;
  /**
   * Faixas em ordem crescente de teto. Categoria de percentual único tem uma
   * faixa só, com `ate: null`.
   */
  faixas: FaixaDeComissao[];
  /** Mínimo por item, em reais. A comissão é `max(percentual × preço, mínimo)`. */
  minimoPorItem: number;
}

const pct = (nome: string, percentual: number, minimoPorItem: number): CategoriaDaTabela => ({
  nome,
  faixas: [{ ate: null, percentual }],
  minimoPorItem,
});

/**
 * A tabela, na ordem em que a Amazon publica. As chaves são os nomes dela.
 */
export const TABELA_DE_COMISSAO_AMAZON_BR: Record<string, CategoriaDaTabela> = {
  // 10%
  "Comidas e bebidas": pct("Comidas e bebidas", 0.10, 1),
  "Pneus e rodas": pct("Pneus e rodas", 0.10, 1),
  "TV, áudio e cinema em casa": pct("TV, áudio e cinema em casa", 0.10, 2),
  // 11%
  "Eletrodomésticos linha branca": pct("Eletrodomésticos linha branca", 0.11, 1),
  "Bebidas alcoólicas": pct("Bebidas alcoólicas", 0.11, 1),
  "Celulares": pct("Celulares", 0.11, 2),
  "Câmera e fotografia": pct("Câmera e fotografia", 0.11, 2),
  "Videogames e consoles": pct("Videogames e consoles", 0.11, 2),
  "Ferramentas e Construção": pct("Ferramentas e Construção", 0.11, 2),
  // 12%
  "Saúde e cuidados pessoais": pct("Saúde e cuidados pessoais", 0.12, 1),
  "Indústria e Ciência": pct("Indústria e Ciência", 0.12, 2),
  "Bebês": pct("Bebês", 0.12, 2),
  "Pets": pct("Pets", 0.12, 2),
  "Eletroportáteis de cuidado pessoal": pct("Eletroportáteis de cuidado pessoal", 0.12, 2),
  "Cozinha": pct("Cozinha", 0.12, 2),
  "Jardim e Piscina": pct("Jardim e Piscina", 0.12, 2),
  "Brinquedos e jogos": pct("Brinquedos e jogos", 0.12, 2),
  "PC": pct("PC", 0.12, 2),
  "Peças automotivas": pct("Peças automotivas", 0.12, 2),
  "Casa": pct("Casa", 0.12, 2),
  "Esportes, aventura e lazer": pct("Esportes, aventura e lazer", 0.12, 2),
  "Instrumentos musicais": pct("Instrumentos musicais", 0.12, 2),
  // 13%
  // ⚠️ 13%, VERBATIM DA PAGINA — e o extrato mede 12,01% em 103 pedidos.
  // A divergencia esta aberta e registrada em docs/tarifas-amazon-br.md; o que
  // manda aqui e a pagina, porque esta constante existe para ser a COPIA dela.
  // Quem tem historico usa a observada (12% real) pela ordem de preferencia.
  "Beleza": pct("Beleza", 0.13, 2),
  "Eletrônicos portáteis": pct("Eletrônicos portáteis", 0.13, 2),
  // ⚠️ 13%, VERBATIM DA PAGINA — e o extrato mede 12,03% em 1.274 pedidos, a
  // maior amostra que temos. Mesma divergencia aberta da Beleza.
  "Papelaria e Escritório": pct("Papelaria e Escritório", 0.13, 2),
  "Relógios": pct("Relógios", 0.13, 2),
  // 14%
  "Beleza de luxo": pct("Beleza de luxo", 0.14, 2),
  "Bagagem e viagem": pct("Bagagem e viagem", 0.14, 2),
  "Roupas e acessórios": pct("Roupas e acessórios", 0.14, 2),
  "Calçados, bolsas e óculos": pct("Calçados, bolsas e óculos", 0.14, 2),
  "Joias": pct("Joias", 0.14, 2),
  // 15%
  "Livros": pct("Livros", 0.15, 2),
  "Vídeo e DVD": pct("Vídeo e DVD", 0.15, 2),
  "Música": pct("Música", 0.15, 2),
  "Demais categorias": pct("Demais categorias", 0.15, 2),
  // Por faixa de preço
  "Acessórios para eletrônicos e PC": {
    nome: "Acessórios para eletrônicos e PC",
    faixas: [{ ate: 100, percentual: 0.15 }, { ate: null, percentual: 0.10 }],
    minimoPorItem: 2,
  },
  "Móveis": {
    nome: "Móveis",
    faixas: [{ ate: 200, percentual: 0.15 }, { ate: null, percentual: 0.10 }],
    minimoPorItem: 2,
  },
};

/**
 * A comissão de UMA unidade, pela tabela.
 *
 * Devolve `null` — nunca um número — quando a categoria tem faixas e o preço é
 * desconhecido. **É o caso do pedido pendente**, cujo valor a Amazon ainda não
 * publicou: sem preço não dá para saber em que faixa ele cai, e escolher uma
 * seria inventar. A logística observada continua valendo nesses casos.
 */
export function comissaoPelaTabela(
  categoria: CategoriaDaTabela,
  precoUnitario: number | null,
): { valor: number; percentual: number } | null {
  if (precoUnitario == null || precoUnitario <= 0) {
    // Percentual único ainda é conhecido, mas o VALOR depende do preço — e o
    // mínimo por item também. Sem preço não há valor.
    return null;
  }
  /**
   * ⚠️ A FAIXA É MARGINAL, NÃO UMA ALÍQUOTA ÚNICA POR BANDA (01/09/2026).
   *
   * A página escreve "15% até R$ 100,00; **10% no excedente**" — como imposto de
   * renda, não como faixa de frete. Um acessório de R$ 150 paga
   * `0,15 × 100 + 0,10 × 50 = R$ 20,00`, e não `0,10 × 150 = R$ 15,00`.
   *
   * A primeira versão desta função lia a banda e aplicava o percentual dela ao
   * preço inteiro: errava para MENOS em tudo acima do teto, e errava mais quanto
   * mais caro o produto. Não apareceu em teste porque os produtos medidos custam
   * de R$ 14 a R$ 38 — abaixo do teto, as duas leituras coincidem, e o defeito
   * só nasceria no primeiro produto caro.
   */
  let restante = precoUnitario;
  let anterior = 0;
  let valorBruto = 0;
  for (const faixa of categoria.faixas) {
    if (restante <= 0) break;
    const teto = faixa.ate == null ? Infinity : faixa.ate;
    const nestaFaixa = Math.min(restante, teto - anterior);
    valorBruto += nestaFaixa * faixa.percentual;
    restante -= nestaFaixa;
    anterior = teto;
  }
  // O MÍNIMO POR ITEM É PISO, não acréscimo: a Amazon cobra o maior entre o
  // percentual e o mínimo. Somar os dois inflaria toda venda barata.
  const valor = Math.max(valorBruto, categoria.minimoPorItem);
  // O percentual DECLARADO é o efetivo sobre o preço — é o que a tela mostra, e
  // é o único que faz sentido quando há mais de uma faixa.
  const percentual = +(valorBruto / precoUnitario).toFixed(4);
  return { valor: +valor.toFixed(2), percentual };
}

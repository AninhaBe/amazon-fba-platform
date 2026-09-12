"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";
import { readJson } from "../../lib/readJson";

/**
 * Capital parado no Full do Mercado Livre — o item do resumo do topo e a tabela
 * por produto.
 *
 * A regra de contagem é do backend (`src/lib/integrations/mercadoLivreFullStock.ts`);
 * aqui só se RENDERIZA o que a rota devolve. Três coisas a tela não pode desfazer:
 *
 * 1. `custoUnitario: null` é custo NÃO CADASTRADO, nunca "R$ 0,00". O item continua
 *    na lista, com custo e subtotal em travessão, fora do total, e vira pendência
 *    com número e link.
 * 2. `total: null` (nenhum item com custo) também é travessão: não é "zero parado no
 *    Full", é "ainda não dá para dizer".
 * 3. Estoque dividido por mais de um anúncio (`ofertas.length > 1`) aparece uma vez
 *    só. A tela diz em quantos anúncios ele está e NÃO soma nada por isso.
 */

const PRODUTOS_HREF = "/mercado-livre/anuncios";

export type EstadoDoFull = "sem_conexao" | "sem_banco" | "sync_pendente" | "sem_itens_no_full" | "ok";

interface ItemDoFull {
  produto: string;
  sku: string | null;
  qtyFull: number;
  /** `null` = custo não cadastrado. */
  custoUnitario: number | null;
  /** `null` sempre que `custoUnitario` for `null`. */
  subtotal: number | null;
  /** Preço de venda do anúncio representante; `null` = a fonte não informou. */
  precoUnitario: number | null;
  /** `null` sempre que `precoUnitario` for `null`. */
  subtotalVenda: number | null;
  ofertas: string[];
  agrupadoPor: "user_product" | "sku" | "oferta";
}

interface CustoNoFull {
  estado: EstadoDoFull;
  sincronizadoEm: string | null;
  moeda: string;
  itens: ItemDoFull[];
  /** Soma só dos itens com custo; `null` quando nenhum tem. */
  total: number | null;
  /** Soma dos itens com preço — quanto a mercadoria devolve se vender hoje. */
  totalVenda: number | null;
  unidades: number;
  unidadesComCusto: number;
  unidadesSemCusto: number;
  itensSemCusto: number;
}

export type LeituraDoFull =
  | { fase: "carregando" }
  | { fase: "erro" }
  | { fase: "pronto"; dados: CustoNoFull };

function money(valor: number, moeda = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
}

const inteiro = (valor: number) => valor.toLocaleString("pt-BR");

/**
 * `2 itens` / `1 item` — plural de verdade.
 *
 * ⚠️ O `item(ns)` QUE ISTO SUBSTITUI ERA CODIGO VAZANDO PARA A
 * TELA. Parentese de plural resolve o problema de quem escreve, nao o de quem
 * le — e numa tela que fala de dinheiro, texto desleixado tira a confianca do
 * numero ao lado. Ela apontou em 10/09/2026.
 */
const plural = (n: number, singular: string, plural: string) =>
  `${inteiro(n)} ${n === 1 ? singular : plural}`;

/**
 * Normaliza a resposta: `sem_conexao` (404) e `sem_banco` (503) chegam só com
 * `estado`, sem os contadores. Campo ausente não pode virar `NaN` na tela.
 */
function normalizar(corpo: unknown): CustoNoFull | null {
  const bruto = corpo as Partial<CustoNoFull> | null;
  if (!bruto?.estado) return null;
  return {
    estado: bruto.estado,
    sincronizadoEm: bruto.sincronizadoEm ?? null,
    moeda: bruto.moeda ?? "BRL",
    itens: Array.isArray(bruto.itens) ? bruto.itens : [],
    total: bruto.total ?? null,
    totalVenda: bruto.totalVenda ?? null,
    unidades: bruto.unidades ?? 0,
    unidadesComCusto: bruto.unidadesComCusto ?? 0,
    unidadesSemCusto: bruto.unidadesSemCusto ?? 0,
    itensSemCusto: bruto.itensSemCusto ?? 0,
  };
}

export function useCustoNoFull(connectionId?: string): LeituraDoFull {
  // A leitura guarda de QUAL conexão ela veio. Trocar de conta volta a "carregando"
  // por derivação, sem um setState no corpo do efeito — e sem exibir por um frame
  // o capital da conta anterior como se fosse o da nova.
  const [resultado, setResultado] = useState<{ conexao?: string; leitura: LeituraDoFull } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
    fetch(`/api/integrations/mercado-livre/full${query}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJson(response))
      .then((corpo) => {
        // 404 e 503 também trazem `estado`: são estados da tela, não falhas.
        const dados = normalizar(corpo);
        setResultado({ conexao: connectionId, leitura: dados ? { fase: "pronto", dados } : { fase: "erro" } });
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setResultado({ conexao: connectionId, leitura: { fase: "erro" } });
      });
    return () => controller.abort();
  }, [connectionId]);

  return resultado && resultado.conexao === connectionId ? resultado.leitura : { fase: "carregando" };
}

/** `N item(ns) sem custo cadastrado →` — a pendência no padrão da casa. */
/**
 * `N item(ns) sem custo cadastrado →` — a pendencia no padrao da casa.
 *
 * ⚠️ TEM VERSAO CURTA, e ela existe por um motivo de layout com
 * consequencia real: dentro da faixa de numeros a frase inteira quebrava em
 * DUAS LINHAS e, como as colunas se esticam juntas, os cinco cartoes ficavam
 * 16px mais altos que os do dashboard. Ela apontou em 10/09/2026: *"os
 * quadrados aqui estao bem grandes, padronize com o dash principal"*.
 *
 * A frase completa nao se perdeu — ela continua embaixo da tabela, com o numero
 * de unidades junto. Aqui basta o gancho: numero, o que falta e para onde ir.
 */
function PendenciaDeCusto({ itensSemCusto, curta }: { itensSemCusto: number; curta?: boolean }) {
  return (
    <Link href={PRODUTOS_HREF} className="full-pendencia-link">
      {/* ⚠️ SEM SETA E SEM SUBLINHADO — nem em repouso, nem no
          hover. Ela reprovou os dois duas vezes (10/09/2026); eu tinha so
          suavizado a seta e tirado o sublinhado do repouso, o que nao era o
          pedido. O que anuncia clique agora e a FORMA: uma pastilha, igual aos
          chips que ja existem na tela. Affordance por forma nao precisa de
          adorno e nao cria uma linha torta no meio de numeros alinhados. */}
      {curta ? `${inteiro(itensSemCusto)} sem custo` : `${plural(itensSemCusto, "item", "itens")} sem custo cadastrado`}
    </Link>
  );
}

function resumoDoFull(leitura: LeituraDoFull): { valor: string; nota: React.ReactNode } {
  if (leitura.fase === "carregando") return { valor: "—", nota: "consultando o Full" };
  if (leitura.fase === "erro") return { valor: "—", nota: "não foi possível consultar o Full" };

  const { estado, total, moeda, unidades, itensSemCusto } = leitura.dados;
  if (estado === "sem_conexao") {
    return {
      valor: "—",
      nota: <Link href="/integracoes" className="full-pendencia-link">Conectar o Mercado Livre <span aria-hidden="true">→</span></Link>,
    };
  }
  if (estado === "sem_banco") return { valor: "—", nota: "dados indisponíveis neste ambiente" };
  // "Nada no Full" seria mentira: o catálogo ainda não foi lido.
  if (estado === "sync_pendente") return { valor: "—", nota: "sincronização de produtos pendente" };
  // Aqui zero é fato: não há mercadoria no Full, logo não há capital parado.
  if (estado === "sem_itens_no_full") return { valor: money(0, moeda), nota: "nenhum item com estoque no Full" };
  // `total: null` = nenhum item tem custo. Travessão, nunca R$ 0,00.
  const valor = total == null ? "—" : money(total, moeda);
  return {
    valor,
    nota: itensSemCusto > 0 ? <PendenciaDeCusto curta itensSemCusto={itensSemCusto} /> : `${inteiro(unidades)} unidade(s) no Full`,
  };
}

/** O item do resumo do topo. Vai DENTRO da `listing-summary-band`. */
export function ResumoDoCustoNoFull({ leitura }: { leitura: LeituraDoFull }) {
  const { valor, nota } = resumoDoFull(leitura);
  const pendencia = leitura.fase === "pronto" && leitura.dados.itensSemCusto > 0
    ? leitura.dados.itensSemCusto
    : 0;
  return (
    <div className={`v3-coluna is-ultima${pendencia ? " is-tom-ambar" : ""}`}>
      {/* ⚠️ O SELO FICA FORA DO QUADRADO, sobre a borda de cima.
          Pedido dela duas vezes (10/09/2026) — na primeira eu discordei e
          ofereci tres variantes DENTRO do cartao, o que nao era o pedido.

          O argumento dela venceu pelo que se ve: o cartao ja e ambar por causa
          da pendencia, entao repetir o aviso la dentro e dizer a mesma coisa
          duas vezes. Fora, o selo vira uma etiqueta colada na caixa — quem olha
          a faixa inteira acha o cartao que pede acao sem ler nenhum dos seis.

          A terceira linha volta a ser a NOTA DE METODO, igual aos vizinhos, e
          os seis cartoes voltam a ter a mesma anatomia. */}
      {pendencia > 0 ? (
        <Link href={PRODUTOS_HREF} className="full-pendencia-selo">
          {plural(pendencia, "item", "itens")} sem custo
          {/* ⚠️ CHEVRON EM SVG, NAO A SETA `→` DE TEXTO. A seta
              em texto herda o peso da fonte e fica desproporcional — foi o que
              ela reprovou antes. Um `path` tem espessura propria, independente
              do tipo, e some do leitor de tela pelo `aria-hidden`. */}
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ) : null}
      <p className="v3-coluna-rotulo">Valor em estoque no Full</p>
      <strong className="v3-coluna-valor">{valor}</strong>
      <span className="v3-coluna-share">{pendencia > 0 ? "custo × quantidade" : nota}</span>
    </div>
  );
}

/**
 * Quanto a mercadoria parada no Full devolve se for vendida pelo preço de hoje.
 *
 * ⚠️ IRMAO DO "Valor em estoque no Full", E OS DOIS PRECISAM SER
 * LIDOS JUNTOS. Um diz quanto custou pôr a mercadoria lá (custo × quantidade),
 * o outro quanto ela volta (preço × quantidade). Pedido dela em 10/09/2026.
 *
 * ⚠️ ISTO NAO E LUCRO, e o rótulo evita a palavra de propósito:
 * daqui ainda saem tarifa do ML, frete e imposto. Chamar de lucro seria a
 * mesma extrapolação que a regra do projeto proíbe — a diferença entre os dois
 * cartões é margem BRUTA, não o que sobra.
 */
export function ValorDeVendaNoFull({ leitura }: { leitura: LeituraDoFull }) {
  const pronto = leitura.fase === "pronto" ? leitura.dados : null;
  const valor = pronto?.totalVenda == null ? "—" : money(pronto.totalVenda, pronto.moeda);
  /* Itens sem preço lido ficam fora do total — a nota diz quantos, no padrão da
     casa: número e o que falta, nunca um total que esconde a ausência. */
  const semPreco = pronto ? pronto.itens.filter((item) => item.subtotalVenda == null).length : 0;
  return (
    <div className="v3-coluna is-tom-verde">
      <p className="v3-coluna-rotulo">Valor de venda no Full</p>
      <strong className="v3-coluna-valor">{valor}</strong>
      <span className="v3-coluna-share">
        {pronto == null
          ? "consultando o Full"
          : semPreco > 0
            ? `${plural(semPreco, "item", "itens")} sem preço lido`
            /* "preço de venda", nao "preço de hoje": o cartao ao lado fala de
               CUSTO, e a nota precisa dizer qual dos dois precos entrou na
               conta. "De hoje" respondia outra pergunta (quando), nao a que a
               pessoa faz aqui (qual). Correcao dela, 10/09/2026. */
            : "preço de venda × quantidade"}
      </span>
    </div>
  );
}

/** A tabela por item, irmã da tabela de cobertura da mesma tela. */
/**
 * A moldura do bloco.
 *
 * ⚠️ ELA MORA AQUI E NAO EM VOLTA DO CORPO, e isso e o que
 * permite o cartao FECHAR NO TOTAL. Pedido dela em 10/09/2026, com desenho: a
 * paginacao e a pendencia saem para fora da moldura, soltas embaixo.
 *
 * Enquanto a moldura embrulhava o corpo inteiro, qualquer coisa depois da
 * tabela ficava presa dentro dela — e o resultado era um vao branco entre o
 * total e a borda de baixo, com os botoes flutuando no meio dele.
 */
function CartaoDoFull({ sincronizadoEm, children }: { sincronizadoEm: string | null; children: React.ReactNode }) {
  return (
    <section className="v3-card is-fecha-com-tabela" aria-labelledby="ml-full-title">
      <div className="v3-card-cab">
        <h2 id="ml-full-title">Custo do estoque no Full</h2>
        <span className="v3-meta">
          Capital parado{sincronizadoEm ? ` · catálogo sincronizado em ${brDate(sincronizadoEm)}` : ""}
        </span>
      </div>
      {children}
    </section>
  );
}

export function TabelaDoCustoNoFull({ leitura }: { leitura: LeituraDoFull }) {
  const sincronizadoEm = leitura.fase === "pronto" ? leitura.dados.sincronizadoEm : null;
  return <CorpoDoCustoNoFull leitura={leitura} sincronizadoEm={sincronizadoEm} />;
}

/**
 * Quantos itens a tabela mostra por pagina.
 *
 * ⚠️ ISTO JA FOI UM "TOPO + VER O RESTO" E VIROU PAGINACAO
 * (decisao dela, 10/09/2026: *"deixa aparecer de 15 em 15, ai coloca botao pra
 * passar"*). A diferenca nao e so de controle: com "ver os outros N" a cauda so
 * abria de uma vez, e numa conta de 50 itens isso despejava 35 linhas no meio
 * de uma tela cujo assunto principal e cobertura de estoque. Paginando, o
 * cartao tem altura PREVISIVEL.
 *
 * Quinze porque a linha ficou em ~29px depois de duas rodadas de compactacao:
 * quinze linhas dao ~435px, tamanho de um bloco de apoio sem virar o assunto
 * da tela. A ultima pagina mostra o resto — 22 itens dao 15 e 7 —, e isso nao e
 * defeito: e o que "de 15 em 15" significa quando o total nao e multiplo de 15.
 */
const ITENS_POR_PAGINA = 15;

function CorpoDoCustoNoFull({ leitura, sincronizadoEm }: { leitura: LeituraDoFull; sincronizadoEm: string | null }) {
  /* ⚠️ O HOOK VEM ANTES DOS `return` CONDICIONAIS abaixo
     (carregando, erro, sem_conexao...). Chamar `useState` depois de um return
     quebraria a ordem dos hooks entre renders — o erro classico de React que so
     aparece quando a tela muda de estado. */
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState("");
  /**
   * ⚠️ "MAIOR CAPITAL" CONTINUA SENDO O PADRAO, e as ordens por
   * quantidade entram ao lado (pedido dela, 10/09/2026). Trocar o padrao para
   * quantidade mudaria a pergunta que o cartao responde: ele se chama "capital
   * parado", e o item que mais prende dinheiro nem sempre e o que tem mais
   * unidades — 9 luminarias de R$ 11,40 pesam mais que 33 prendedores de R$ 1,90.
   */
  const [ordem, setOrdem] = useState<"capital" | "mais" | "menos">("capital");
  if (leitura.fase === "carregando") {
    return <CartaoDoFull sincronizadoEm={sincronizadoEm}><p className="v3-nota" role="status">Consultando o estoque no Full.</p></CartaoDoFull>;
  }
  if (leitura.fase === "erro") {
    return <CartaoDoFull sincronizadoEm={sincronizadoEm}><EmptyState compact title="Não foi possível consultar o estoque no Full" description="Atualize a página para consultar de novo." /></CartaoDoFull>;
  }

  const { estado, itens, total, moeda, unidadesSemCusto, itensSemCusto } = leitura.dados;

  if (estado === "sem_conexao") {
    return (
      <CartaoDoFull sincronizadoEm={sincronizadoEm}>
      <EmptyState
        compact
        title="Conecte sua conta do Mercado Livre"
        description="Sem a conta autorizada o NEXO não enxerga o que está no Full."
        action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>}
      />
      </CartaoDoFull>
    );
  }
  if (estado === "sem_banco") {
    return <CartaoDoFull sincronizadoEm={sincronizadoEm}><EmptyState compact title="Dados indisponíveis neste ambiente" description="O banco do NEXO não está acessível aqui." /></CartaoDoFull>;
  }
  if (estado === "sync_pendente") {
    return (
      <CartaoDoFull sincronizadoEm={sincronizadoEm}>
      <EmptyState
        compact
        title="Sincronização de produtos pendente"
        description="O catálogo desta conta ainda não foi lido. O capital parado no Full aparece aqui assim que a primeira sincronização terminar."
      />
      </CartaoDoFull>
    );
  }
  if (estado === "sem_itens_no_full") {
    return <CartaoDoFull sincronizadoEm={sincronizadoEm}><EmptyState compact title="Nenhum item com estoque no Full" description="Nenhum anúncio desta conta tem saldo no Full hoje." /></CartaoDoFull>;
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = itens.filter((item) =>
    termo === "" ||
    `${item.produto} ${item.sku ?? ""} ${item.ofertas.join(" ")}`.toLowerCase().includes(termo),
  );
  /* ⚠️ A ORDEM PADRAO NAO E REORDENADA: `itens` ja chega do
     servidor por capital decrescente (`mercadoLivreFullStock.ts`). Reordenar de
     novo aqui daria dois lugares decidindo a mesma coisa, e eles divergem no dia
     em que o criterio do servidor mudar. */
  const ordenados = ordem === "capital"
    ? filtrados
    : [...filtrados].sort((a, b) => ordem === "mais" ? b.qtyFull - a.qtyFull : a.qtyFull - b.qtyFull);

  const paginas = Math.max(1, Math.ceil(ordenados.length / ITENS_POR_PAGINA));
  /* ⚠️ A PAGINA ATUAL E DERIVADA, NAO SO GUARDADA. Filtrar a
     lista encurta o total de paginas, e um `pagina` guardado em 4 deixaria a
     tabela VAZIA sem nada explicando por que — o defeito classico de paginacao
     com busca. Prendendo ao maximo disponivel, a tela sempre mostra algo. */
  const paginaAtual = Math.min(pagina, paginas);
  const visiveis = ordenados.slice((paginaAtual - 1) * ITENS_POR_PAGINA, paginaAtual * ITENS_POR_PAGINA);

  /* ⚠️ COM BUSCA ATIVA, O TOTAL E DO QUE ESTA LISTADO. O `total`
     que vem do servidor e o da conta inteira; mante-lo no rodape enquanto a
     tabela mostra tres itens faria o numero nao ser explicavel pela tabela —
     que e a forma mais silenciosa de um painel mentir. O rotulo muda junto,
     senao os dois numeros se parecem. */
  const filtrando = termo !== "";
  const totalExibido = filtrando
    ? (filtrados.some((item) => item.subtotal != null)
        ? filtrados.reduce((soma, item) => soma + (item.subtotal ?? 0), 0)
        : null)
    : total;

  return (
    <>
      <CartaoDoFull sincronizadoEm={sincronizadoEm}>
      <p className="v3-nota">
        Quantidade no Full × custo vigente hoje. Estoque dividido por mais de um anúncio conta
        uma vez só, e anúncio fechado com saldo continua na lista — a mercadoria segue parada lá.
      </p>
      <div className="v3-filtros v3-filtros-full" role="search" aria-label="Filtros do estoque no Full">
        <label className="v3-busca">
          <span className="sr-only">Buscar produto ou SKU no Full</span>
          <input
            value={busca}
            onChange={(evento) => { setBusca(evento.target.value); setPagina(1); }}
            placeholder="Buscar produto ou SKU"
          />
        </label>
        <select
          value={ordem}
          onChange={(evento) => { setOrdem(evento.target.value as typeof ordem); setPagina(1); }}
          aria-label="Ordenar o estoque no Full"
        >
          <option value="capital">Maior capital</option>
          <option value="mais">Maior quantidade</option>
          <option value="menos">Menor quantidade</option>
        </select>
      </div>

      {ordenados.length === 0 ? (
        <p className="v3-nota">Nenhum item do Full corresponde a “{busca.trim()}”.</p>
      ) : (
      <div className="v3-tabela v3-tabela-full">
        <div className="v3-full-cab">
          <span>Produto</span>
          <span>Quantidade no Full</span>
          <span>Custo unitário</span>
          <span>Subtotal</span>
        </div>
        {visiveis.map((item) => (
          <div
            className={`v3-full-linha${item.subtotal == null ? " is-sem-custo" : ""}`}
            key={item.ofertas.join("|")}
          >
            <span className="v3-cel-nome">
              <span className="v3-margem-titulo" title={item.produto}>{item.produto}</span>
              <span className="v3-cel-sub">
                {item.sku || item.ofertas[0]}
                {/* Mesmo estoque fisico visto por varios anuncios: informa, nao soma. */}
                {item.ofertas.length > 1 ? ` · em ${inteiro(item.ofertas.length)} anúncios` : ""}
              </span>
            </span>
            <span className="v3-cel-num">{inteiro(item.qtyFull)}</span>
            {/* ⚠️ CUSTO AUSENTE E "—" COM TOM APAGADO, nunca zero: o
                produto existe no Full, o que falta e o cadastro do custo. */}
            <span className={`v3-cel-num${item.custoUnitario == null ? " is-vazio" : ""}`}>
              {item.custoUnitario == null ? <span title="Custo não cadastrado">—</span> : money(item.custoUnitario, moeda)}
            </span>
            <span className={`v3-cel-num${item.subtotal == null ? " is-vazio" : ""}`}>
              {item.subtotal == null ? <span title="Custo não cadastrado">—</span> : money(item.subtotal, moeda)}
            </span>
          </div>
        ))}
        <div className="v3-full-linha is-total">
          <span className="v3-cel-nome">
            <strong>{filtrando ? "Total dos itens encontrados" : "Total em capital"}</strong>
          </span>
          <span className="v3-cel-num" />
          <span className="v3-cel-num" />
          <span className="v3-cel-num"><strong>{totalExibido == null ? "—" : money(totalExibido, moeda)}</strong></span>
        </div>
      </div>
      )}
      </CartaoDoFull>

      {/* ⚠️ FORA DA MOLDURA, de proposito. Paginacao e pendencia
          nao sao conteudo da tabela: uma diz onde voce esta na lista, a outra
          aponta um cadastro que falta em outra tela. Dentro do cartao elas
          criavam um vao branco entre o total e a borda; fora, o cartao fecha no
          numero que ele existe para dar. */}
      <div className="v3-rodape-solto">
      {itensSemCusto > 0 && (
        <p className="v3-nota v3-nota-pendencia">
          <PendenciaDeCusto itensSemCusto={itensSemCusto} />
          <span>{plural(unidadesSemCusto, "unidade fica", "unidades ficam")} fora do total até o custo ser cadastrado.</span>
        </p>
      )}
      {paginas > 1 ? (
        <div className="v3-paginacao">
          <Pagination
            page={paginaAtual}
            pageCount={paginas}
            total={ordenados.length}
            pageSize={ITENS_POR_PAGINA}
            onPage={setPagina}
          />
        </div>
      ) : null}
      </div>
    </>
  );
}

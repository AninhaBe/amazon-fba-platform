"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";
import { EmptyState } from "./EmptyState";
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

const PRODUTOS_HREF = "/mercado-livre/produtos";

export type EstadoDoFull = "sem_conexao" | "sem_banco" | "sync_pendente" | "sem_itens_no_full" | "ok";

interface ItemDoFull {
  produto: string;
  sku: string | null;
  qtyFull: number;
  /** `null` = custo não cadastrado. */
  custoUnitario: number | null;
  /** `null` sempre que `custoUnitario` for `null`. */
  subtotal: number | null;
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
function PendenciaDeCusto({ itensSemCusto }: { itensSemCusto: number }) {
  return (
    <Link href={PRODUTOS_HREF} className="full-pendencia-link">
      {inteiro(itensSemCusto)} item(ns) sem custo cadastrado <span aria-hidden="true">→</span>
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
    nota: itensSemCusto > 0 ? <PendenciaDeCusto itensSemCusto={itensSemCusto} /> : `${inteiro(unidades)} unidade(s) no Full`,
  };
}

/** O item do resumo do topo. Vai DENTRO da `listing-summary-band`. */
export function ResumoDoCustoNoFull({ leitura }: { leitura: LeituraDoFull }) {
  const { valor, nota } = resumoDoFull(leitura);
  return (
    <div>
      <span>Valor em estoque no Full</span>
      <strong>{valor}</strong>
      <small>{nota}</small>
    </div>
  );
}

/** A tabela por item, irmã da tabela de cobertura da mesma tela. */
export function TabelaDoCustoNoFull({ leitura }: { leitura: LeituraDoFull }) {
  const sincronizadoEm = leitura.fase === "pronto" ? leitura.dados.sincronizadoEm : null;
  return (
    <section className="listing-table-shell inventory-table-shell full-stock-shell" aria-labelledby="ml-full-title">
      <header>
        <div>
          <p className="section-kicker">Capital parado</p>
          <h2 id="ml-full-title">Custo do estoque no Full</h2>
        </div>
        {sincronizadoEm ? <p>Catálogo sincronizado em {brDate(sincronizadoEm)}</p> : null}
      </header>
      <CorpoDoCustoNoFull leitura={leitura} />
    </section>
  );
}

function CorpoDoCustoNoFull({ leitura }: { leitura: LeituraDoFull }) {
  if (leitura.fase === "carregando") {
    return <p className="full-stock-note" role="status">Consultando o estoque no Full.</p>;
  }
  if (leitura.fase === "erro") {
    return <EmptyState compact title="Não foi possível consultar o estoque no Full" description="Atualize a página para consultar de novo." />;
  }

  const { estado, itens, total, moeda, unidadesSemCusto, itensSemCusto } = leitura.dados;

  if (estado === "sem_conexao") {
    return (
      <EmptyState
        compact
        title="Conecte sua conta do Mercado Livre"
        description="Sem a conta autorizada o NEXO não enxerga o que está no Full."
        action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>}
      />
    );
  }
  if (estado === "sem_banco") {
    return <EmptyState compact title="Dados indisponíveis neste ambiente" description="O banco do NEXO não está acessível aqui." />;
  }
  if (estado === "sync_pendente") {
    return (
      <EmptyState
        compact
        title="Sincronização de produtos pendente"
        description="O catálogo desta conta ainda não foi lido. O capital parado no Full aparece aqui assim que a primeira sincronização terminar."
      />
    );
  }
  if (estado === "sem_itens_no_full") {
    return <EmptyState compact title="Nenhum item com estoque no Full" description="Nenhum anúncio desta conta tem saldo no Full hoje." />;
  }

  return (
    <>
      <aside className="inventory-method-strip" aria-label="Como o custo do estoque no Full é calculado">
        <strong>Como calculamos</strong>
        <span>
          Quantidade no Full × custo vigente hoje. Estoque dividido por mais de um anúncio conta
          uma vez só, e anúncio fechado com saldo continua na lista — a mercadoria segue parada lá.
        </span>
      </aside>
      <div className="overflow-x-auto">
        <table className="inventory-table listing-table">
          <caption className="sr-only">Custo do estoque no Full por produto, do maior capital para o menor</caption>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Quantidade no Full</th>
              <th>Custo unitário</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.ofertas.join("|")} className={item.subtotal == null ? "is-sem-custo" : undefined}>
                <td>
                  <div className="listing-product">
                    <span className="listing-image-fallback" aria-hidden="true">ML</span>
                    <div>
                      <strong className="block max-w-[320px] truncate" title={item.produto}>{item.produto}</strong>
                      <small>
                        <span className="font-mono">{item.sku || item.ofertas[0]}</span>
                        {/* Mesmo estoque físico visto por vários anúncios: informa, não soma. */}
                        {item.ofertas.length > 1 ? ` · em ${inteiro(item.ofertas.length)} anúncios` : ""}
                      </small>
                    </div>
                  </div>
                </td>
                <td className="tabular-nums">{inteiro(item.qtyFull)}</td>
                <td className="tabular-nums">{item.custoUnitario == null ? <span title="Custo não cadastrado">—</span> : money(item.custoUnitario, moeda)}</td>
                <td className="tabular-nums">{item.subtotal == null ? <span title="Custo não cadastrado">—</span> : money(item.subtotal, moeda)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>Total em capital</th>
              <td className="tabular-nums">{total == null ? "—" : money(total, moeda)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {itensSemCusto > 0 && (
        <p className="full-stock-note">
          <PendenciaDeCusto itensSemCusto={itensSemCusto} />
          <span>{inteiro(unidadesSemCusto)} unidade(s) ficam fora do total até o custo ser cadastrado.</span>
        </p>
      )}
    </>
  );
}

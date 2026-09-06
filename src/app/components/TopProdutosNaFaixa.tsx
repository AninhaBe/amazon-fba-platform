import Link from "next/link";
import { marginStateClass } from "@/lib/marginTone";

/**
 * TOP PRODUTOS no lado direito da faixa do ML — Opção A da prancheta,
 * aprovada em 06/09/2026.
 *
 * Ela substitui a conta escrita, e o motivo é da própria dona: *"Quero tirar
 * essa tela de Repasses, taxas e lucro, porque a tela da esquerda já mostra
 * literalmente isso."* Estava certa — a cascata e a legenda da esquerda listam
 * as mesmas quatro parcelas e o mesmo lucro. Duas leituras do mesmo número
 * ocupando as duas metades da faixa é espaço gasto para não dizer nada novo.
 *
 * ⚠️ ESTA PEÇA NÃO CALCULA NEM ORDENA. A lista chega pronta, na ordem que o
 * produtor já emitiu (faturamento decrescente, oito produtos) — a MESMA que o
 * bloco "Desempenho do período" consome mais abaixo. Ordenar aqui criaria dois
 * rankings do mesmo período na mesma página, e o dia em que eles discordassem
 * ninguém veria nada vermelho.
 *
 * ⚠️ O LIMIAR DA MARGEM VEM DE `marginStateClass`, a regra visual global — a
 * mesma que a tabela de baixo usa. Copiar os números daqui (12% / 15%) faria
 * o mesmo produto sair âmbar em cima e verde embaixo no dia em que alguém
 * mexesse num dos dois.
 */
export function TopProdutosNaFaixa({
  titulo,
  produtos,
  href,
  vazio,
}: {
  titulo: string;
  produtos: Array<{
    id: string;
    titulo: string;
    /** "30 un." — pronto, porque plural e locale são do chamador. */
    unidades: string;
    /** Faturamento já formatado: moeda é do chamador, como no resto da faixa. */
    faturamento: string;
    /** `null` = custo não cadastrado. Vira "—", nunca 0%. */
    marginPct: number | null;
  }>;
  href: string;
  /** O que dizer quando não há produto — estado real, nunca uma lista vazia muda. */
  vazio: string;
}) {
  return (
    <section className="top-faixa" aria-label={titulo}>
      <header className="top-faixa-cabecalho">
        <p className="cockpit-kicker">{titulo}</p>
        <p className="top-faixa-meta">
          {produtos.length} produto{produtos.length === 1 ? "" : "s"}
          {" · "}
          <Link href={href}>Ver produtos <span aria-hidden="true">→</span></Link>
        </p>
      </header>

      {produtos.length === 0 ? (
        <p className="top-faixa-vazio">{vazio}</p>
      ) : (
        <>
          <ol className="top-faixa-lista">
            {produtos.map((produto, indice) => (
              <li key={produto.id}>
                <span className="top-faixa-rank" aria-hidden="true">{indice + 1}</span>
                {/* ⚠️ UMA LINHA COM RETICÊNCIAS, e o título completo no
                    atributo: a coluna tem 400px e um título de anúncio do ML
                    tem 60 caracteres. Deixá-lo quebrar empurraria a lista para
                    fora da faixa; cortá-lo sem o texto inteiro em algum lugar
                    esconderia qual produto é. */}
                <span className="top-faixa-titulo" title={produto.titulo}>{produto.titulo}</span>
                <span className="top-faixa-unidades">{produto.unidades}</span>
                <strong className="top-faixa-valor">{produto.faturamento}</strong>
                <span className={`top-faixa-margem ${marginStateClass(produto.marginPct)}`}>
                  {produto.marginPct == null
                    ? "—"
                    : `${produto.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                </span>
              </li>
            ))}
          </ol>
          {/* A nota diz O QUE falta e para onde ir, sem adjetivo que se
              desculpe: o traço é ausência de custo cadastrado, não margem zero. */}
          <p className="top-faixa-nota">Margem depende do custo cadastrado; valor desconhecido continua “—”.</p>
        </>
      )}
    </section>
  );
}

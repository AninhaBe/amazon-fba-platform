"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

export interface RankedProduct {
  sku: string;
  title?: string;
  units: number;
  revenue: number;
  marginPct: number | null;
}

type RankingMetric = "revenue" | "units";

function marginClass(marginPct: number | null) {
  if (marginPct == null) return "is-unknown";
  if (marginPct >= 18) return "is-positive";
  if (marginPct >= 12) return "is-warning";
  return "is-negative";
}

export function TopProductsRanking({
  products,
  currency,
  productsHref,
}: {
  products: RankedProduct[];
  currency: string;
  productsHref: string;
}) {
  const [metric, setMetric] = useState<RankingMetric>("revenue");
  const [showAll, setShowAll] = useState(false);
  const money = useMemo(
    () => new Intl.NumberFormat("pt-BR", { style: "currency", currency }),
    [currency],
  );
  const ranked = useMemo(
    () => [...products].sort((a, b) => b[metric] - a[metric]),
    [metric, products],
  );
  const maximum = Math.max(1, ...ranked.map((product) => product[metric]));
  const visibleProducts = showAll ? ranked : ranked.slice(0, 8);

  return (
    <section className="top-products-ranking" aria-labelledby="top-products-title">
      <header className="top-products-heading">
        <div>
          <p className="section-kicker">Desempenho do período</p>
          <h2 id="top-products-title">Top produtos</h2>
          <p>Compare rapidamente a concentração de vendas sem perder unidades e margem.</p>
        </div>
        <Link href={productsHref}>Ver produtos <span aria-hidden>↗</span></Link>
      </header>

      <div className="top-products-toolbar">
        <div className="top-products-tabs" role="tablist" aria-label="Ordenar top produtos por">
          <button
            type="button"
            role="tab"
            aria-selected={metric === "revenue"}
            tabIndex={metric === "revenue" ? 0 : -1}
            onClick={() => setMetric("revenue")}
          >
            Faturamento
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === "units"}
            tabIndex={metric === "units" ? 0 : -1}
            onClick={() => setMetric("units")}
          >
            Unidades
          </button>
        </div>
        <span>{ranked.length} produto{ranked.length === 1 ? "" : "s"}</span>
      </div>

      <ol className="top-products-list" aria-live="polite">
        {visibleProducts.map((product, index) => {
          const share = Math.max(4, (product[metric] / maximum) * 100);
          const primary = metric === "revenue"
            ? money.format(product.revenue)
            : product.units.toLocaleString("pt-BR");
          const secondary = metric === "revenue"
            ? `${product.units.toLocaleString("pt-BR")} un.`
            : money.format(product.revenue);

          return (
            <li
              key={product.sku}
              className="top-products-row is-dense"
              style={{ "--ranking-bar": `${share}%` } as CSSProperties}
            >
              <span className="top-products-bar" aria-hidden />
              <span className="top-products-rank" aria-hidden>{index + 1}</span>
              <span className="top-products-name">
                <strong title={product.title || product.sku}>{product.title || product.sku}</strong>
                <small className="sr-only">SKU {product.sku}</small>
              </span>
              <span className="top-products-secondary">{secondary}</span>
              <strong className="top-products-primary">{primary}</strong>
              <span className={`top-products-margin ${marginClass(product.marginPct)}`}>
                {product.marginPct == null ? "Margem —" : `${product.marginPct.toFixed(1)}% margem`}
              </span>
            </li>
          );
        })}
      </ol>

      <footer className="top-products-note is-compact">
        <span>Margem depende do custo cadastrado; valor desconhecido continua “—”.</span>
        {ranked.length > 8 && (
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Mostrar top 8" : `Mostrar ${ranked.length}`}
          </button>
        )}
      </footer>
    </section>
  );
}

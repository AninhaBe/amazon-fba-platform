type ChannelModuleKind = "monitor" | "finance" | "catalog" | "inventory" | "costs" | "abc";

interface ChannelModuleSummaryProps {
  kind: ChannelModuleKind;
  rows: Record<string, unknown>[];
  total?: number | null;
}

interface SummaryMetric {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "warning" | "danger";
}

const number = (value: unknown) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function firstNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = number(row[key]);
    if (value != null) return value;
  }
  return null;
}

function sumKnown(rows: Record<string, unknown>[], keys: string[]) {
  let count = 0;
  let value = 0;
  for (const row of rows) {
    const current = firstNumber(row, keys);
    if (current == null) continue;
    count += 1;
    value += current;
  }
  return { count, value };
}

const integer = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function ChannelModuleSummary({ kind, rows, total }: ChannelModuleSummaryProps) {
  const resultCount = total ?? rows.length;
  let metrics: SummaryMetric[];

  if (kind === "monitor") {
    const gross = sumKnown(rows, ["gross", "revenue"]);
    const fees = sumKnown(rows, ["marketplaceFees", "fees"]);
    const contribution = sumKnown(rows, ["contribution", "profit"]);
    metrics = [
      { label: "Pedidos", value: integer(resultCount), note: total == null ? "nesta página" : "no conjunto filtrado" },
      { label: "Receita conhecida", value: gross.count ? money(gross.value) : "—", note: `${gross.count} de ${rows.length} com valor` },
      { label: "Taxas conhecidas", value: fees.count ? money(fees.value) : "—", note: `${fees.count} de ${rows.length} conciliados`, tone: fees.value > 0 ? "danger" : undefined },
      { label: "Resultado conhecido", value: contribution.count ? money(contribution.value) : "—", note: `${contribution.count} de ${rows.length} calculados`, tone: contribution.count ? (contribution.value < 0 ? "danger" : "positive") : undefined },
    ];
  } else if (kind === "finance") {
    const revenue = sumKnown(rows, ["revenue"]);
    const adjustments = sumKnown(rows, ["adjustment"]);
    const balanceKnown = revenue.count + adjustments.count > 0;
    const balance = revenue.value + adjustments.value;
    metrics = [
      { label: "Transações", value: integer(resultCount), note: total == null ? "nesta página" : "no conjunto filtrado" },
      { label: "Receita final", value: revenue.count ? money(revenue.value) : "—", note: `${revenue.count} registros conhecidos` },
      { label: "Ajustes", value: adjustments.count ? money(adjustments.value) : "—", note: `${adjustments.count} registros conhecidos`, tone: adjustments.value < 0 ? "danger" : undefined },
      { label: "Saldo conhecido", value: balanceKnown ? money(balance) : "—", note: "sem estimar registros ausentes", tone: balanceKnown ? (balance < 0 ? "danger" : "positive") : undefined },
    ];
  } else if (kind === "catalog") {
    const active = rows.filter((row) => ["active", "activated", "live", "enabled"].includes(String(row.status ?? "").toLowerCase())).length;
    const available = sumKnown(rows, ["availableQty"]);
    const prices = sumKnown(rows, ["price"]);
    metrics = [
      { label: "Anúncios", value: integer(resultCount), note: total == null ? "nesta página" : "no catálogo" },
      { label: "Ativos", value: integer(active), note: `${rows.length - active} em outros estados`, tone: active ? "positive" : undefined },
      { label: "Unidades disponíveis", value: available.count ? integer(available.value) : "—", note: `${available.count} de ${rows.length} com estoque` },
      { label: "Preço disponível", value: `${prices.count} / ${rows.length}`, note: "anúncios com valor conhecido" },
    ];
  } else if (kind === "inventory") {
    const withoutStock = rows.filter((row) => number(row.availableQty) === 0).length;
    const low = rows.filter((row) => {
      const days = number(row.daysRemaining);
      return days != null && days > 0 && days <= 7;
    }).length;
    const withoutSales = rows.filter((row) => row.daysRemaining == null).length;
    metrics = [
      { label: "Produtos", value: integer(resultCount), note: total == null ? "nesta página" : "no conjunto filtrado" },
      { label: "Sem estoque", value: integer(withoutStock), note: "disponibilidade igual a zero", tone: withoutStock ? "danger" : undefined },
      { label: "Até 7 dias", value: integer(low), note: "com base de venda conhecida", tone: low ? "warning" : undefined },
      { label: "Sem base de venda", value: integer(withoutSales), note: "sem projeção artificial" },
    ];
  } else if (kind === "costs") {
    const known = rows.filter((row) => number(row.cost) != null).length;
    const missing = Math.max(0, rows.length - known);
    const coverage = rows.length ? (known / rows.length) * 100 : null;
    metrics = [
      { label: "Produtos", value: integer(resultCount), note: total == null ? "nesta página" : "no conjunto filtrado" },
      { label: "Com custo", value: integer(known), note: "valor conhecido", tone: known ? "positive" : undefined },
      { label: "Sem custo", value: integer(missing), note: "lucro permanece indisponível", tone: missing ? "warning" : undefined },
      { label: "Cobertura da página", value: coverage == null ? "—" : `${coverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, note: "zero continua sendo um fato" },
    ];
  } else {
    const classA = rows.filter((row) => String(row.class ?? "").toUpperCase() === "A").length;
    const revenue = sumKnown(rows, ["revenue"]);
    const profit = sumKnown(rows, ["profit"]);
    metrics = [
      { label: "Produtos", value: integer(resultCount), note: total == null ? "nesta página" : "no conjunto filtrado" },
      { label: "Classe A", value: integer(classA), note: "maior contribuição de receita" },
      { label: "Receita conhecida", value: revenue.count ? money(revenue.value) : "—", note: `${revenue.count} produtos com valor` },
      { label: "Lucro conhecido", value: profit.count ? money(profit.value) : "—", note: `${profit.count} produtos calculados`, tone: profit.count ? (profit.value < 0 ? "danger" : "positive") : undefined },
    ];
  }

  return (
    <section className="listing-summary-band is-4 channel-module-summary" aria-label="Resumo do módulo">
      {metrics.map((metric) => (
        <div key={metric.label} className={metric.tone ? `is-${metric.tone}` : undefined}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.note}</small>
        </div>
      ))}
    </section>
  );
}

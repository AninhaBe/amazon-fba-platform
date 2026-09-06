/**
 * CHIP DE MARGEM — a regra visual global de margem do NEXO.
 *
 * ⚠️ OS LIMIARES SAO O COMPONENTE. Abaixo de 12% exige acao, de 12% a 15% pede
 * atencao, acima de 15% e saudavel. Eles vivem em `src/lib/marginTone.ts` no app
 * e estao copiados aqui porque este pacote nao pode importar do app — mas o
 * numero e o mesmo, e divergir dele e o defeito que este chip existe para
 * evitar: o MESMO produto sair ambar numa tela e verde na outra.
 *
 * ⚠️ `null` NAO E ZERO. Custo nao cadastrado e ausencia, e ausencia vira o
 * traco num chip neutro — nunca 0% num chip vermelho, que acusaria de prejuizo
 * um produto sobre o qual nada se sabe.
 */
export type TomDeMargem = "is-negative" | "is-warning" | "is-positive" | "is-unknown";

export function tomDaMargem(margemPct: number | null | undefined): TomDeMargem {
  if (margemPct == null || !Number.isFinite(margemPct)) return "is-unknown";
  if (margemPct < 12) return "is-negative";
  if (margemPct <= 15) return "is-warning";
  return "is-positive";
}

export interface ChipDeMargemProps {
  /** Margem em pontos percentuais (11.9 = 11,9%). `null` = custo nao cadastrado. */
  margemPct: number | null;
}

export function ChipDeMargem({ margemPct }: ChipDeMargemProps) {
  return (
    <span className={`top-faixa-margem ${tomDaMargem(margemPct)}`}>
      {margemPct == null
        ? "—"
        : `${margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}

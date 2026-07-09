// Cálculo interno da tarifa mensal de armazenagem FBA (Amazon Brasil).
// Fonte: tabela oficial de tarifas de armazenagem de inventário.
//
// A tarifa é determinística: volume (m³) × taxa por m³, definida por faixa de tamanho.
// A Revenue Calculator da Amazon rateia esse valor pelo tempo médio que o item fica
// em estoque (depende da velocidade de venda). Aqui expomos os dois: o custo mensal
// cheio (padrão) e, opcionalmente, o rateio por "dias em estoque".

// R$/m³/mês por faixa de volume do produto (embalado).
export const STORAGE_RATE_SMALL = 75; // < 10.000 cm³
export const STORAGE_RATE_LARGE = 37.5; // >= 10.000 cm³
export const SIZE_THRESHOLD_CM3 = 10_000;

export interface StorageEstimate {
  volumeCm3: number;
  volumeM3: number;
  tier: "small" | "large";
  ratePerM3: number;
  monthlyFee: number; // custo cheio de 1 unidade por 1 mês
  proratedFee: number; // rateado por daysInStock (= monthlyFee se daysInStock >= 30)
  daysInStock: number;
}

/**
 * Estima a tarifa de armazenagem a partir das dimensões (em cm).
 * @param daysInStock dias médios em estoque para ratear (padrão 30 = mês cheio).
 */
export function estimateStorage(
  dims: { length: number; width: number; height: number },
  daysInStock = 30
): StorageEstimate {
  const volumeCm3 = dims.length * dims.width * dims.height;
  const volumeM3 = volumeCm3 / 1_000_000;

  const tier = volumeCm3 < SIZE_THRESHOLD_CM3 ? "small" : "large";
  const ratePerM3 = tier === "small" ? STORAGE_RATE_SMALL : STORAGE_RATE_LARGE;

  const monthlyFee = volumeM3 * ratePerM3;
  const clampedDays = Math.max(0, Math.min(30, daysInStock));
  const proratedFee = monthlyFee * (clampedDays / 30);

  return {
    volumeCm3: +volumeCm3.toFixed(1),
    volumeM3: +volumeM3.toFixed(5),
    tier,
    ratePerM3,
    monthlyFee: +monthlyFee.toFixed(2),
    proratedFee: +proratedFee.toFixed(2),
    daysInStock: clampedDays,
  };
}

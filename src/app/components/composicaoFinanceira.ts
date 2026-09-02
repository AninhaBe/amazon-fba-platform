// ⚠️ LOGICA PURA EM `.ts`, NAO EM `.tsx`, DE PROPOSITO — mesmo motivo de
// `procedenciaDaEstimativa.ts`: o runner de `npm test`
// (`node --experimental-strip-types`) nao carrega `.tsx`, e esta funcao precisa
// ser testada pelo COMPORTAMENTO — chamando e conferindo a saida — e nao por
// casamento no fonte, que e a familia de teste decorativo que o AGENTS.md
// proibe. Enquanto ela morava no painel, so dava para olhar o texto do arquivo.
import type { CompositionSlice } from "./CompositionDonut";

export type { CompositionSlice };

interface KnownCost {
  id: string;
  label: string;
  value: number | null | undefined;
}

/**
 * Monta a mesma leitura de composição em todos os canais sem transformar
 * lacuna contábil em zero. Quando o resultado ainda não fechou, o saldo entre
 * receita e custos conhecidos vira "Composição pendente", nunca lucro.
 */
export function buildFinancialComposition({
  total,
  costs,
  result,
  resultLabel = "Lucro estimado",
  pendencias,
}: {
  total: number;
  costs: KnownCost[];
  result: number | null | undefined;
  resultLabel?: string;
  /**
   * ⚠️ A pendência DECOMPOSTA em partes nomeadas. Opcional: sem ela o
   * painel segue exibindo a fatia única, e as telas que não passam nada não
   * mudam de aparência.
   */
  pendencias?: Array<{ rotulo: string; valor?: number | null }>;
}): CompositionSlice[] {
  const known = costs
    .filter((cost): cost is KnownCost & { value: number } => cost.value != null && Math.abs(cost.value) > 0)
    .map((cost) => ({ id: cost.id, label: cost.label, value: Math.abs(cost.value) }));

  if (result != null) {
    return [
      ...known,
      {
        id: "result",
        label: result < 0 ? "Prejuízo" : resultLabel,
        value: Math.abs(result),
        isRemainder: true,
        isLoss: result < 0,
      },
    ];
  }

  const knownTotal = known.reduce((sum, cost) => sum + cost.value, 0);
  const pending = Math.max(total - knownTotal, 0);
  if (pending <= 0) return known;

  /**
   * ⚠️ "COMPOSIÇÃO PENDENTE" SOZINHA É UM BALAIO, e a vendedora disse
   * isso com todas as letras (02/09/2026): *"redundante e mal formatada"*. Ela
   * via `Composição pendente R$ 192.280,57` sem nada explicando O QUE falta —
   * exatamente o que o AGENTS.md proíbe: a pendência tem de dizer o que falta,
   * com número e link, em vez de se anunciar como um bloco.
   *
   * Quem chama pode DECOMPOR essa fatia em partes nomeadas. É opcional de
   * propósito: as outras quatro telas que usam este painel continuam como
   * estão, e nenhuma delas muda de aparência por causa desta.
   */
  if (pendencias?.length) {
    const soma = pendencias.reduce((total2, parte) => total2 + (parte.valor ?? 0), 0);
    const resto = Math.max(pending - soma, 0);
    return [
      ...known,
      ...pendencias.map((parte, indice) => ({
        id: `pendente-${indice}`,
        label: parte.rotulo,
        value: parte.valor ?? 0,
        isPending: true,
      })),
      // O que sobra depois das partes nomeadas continua aparecendo: some do
      // nome, não do total. Esconder o resto faria a soma não fechar.
      ...(resto > 0.01 ? [{ id: "pending", label: "Ainda sem classificação", value: resto, isPending: true }] : []),
    ];
  }
  return [...known, { id: "pending", label: "Composição pendente", value: pending, isPending: true }];
}

/**
 * SELETOR DE PERIODO — os presets rapidos do topo dos dashboards.
 *
 * ⚠️ CADA TELA DECLARA O QUE OFERECE, e isso nao e detalhe. Quando a Curva ABC
 * ganhou um segundo seletor escrito a mao, ela divergiu do compartilhado em duas
 * coisas de uma vez: o padrao virou "Hoje" (uma curva ABC de um dia classifica
 * produto por uma amostra de um dia) e apareceu "Personalizado" numa tela cujas
 * rotas so leem `days` — o botao marcado exibindo outro periodo.
 *
 * Por isso a lista de opcoes entra por prop, e a peca nao tem padrao proprio.
 */
export interface OpcaoDePeriodo {
  value: string;
  label: string;
}

export interface SeletorDePeriodoProps {
  opcoes: OpcaoDePeriodo[];
  selecionado: string;
  onSelecionar: (value: string) => void;
  /** Aquecimento: chamado na intencao (foco/hover), antes do clique. */
  onIntencao?: (value: string) => void;
}

export function SeletorDePeriodo({ opcoes, selecionado, onSelecionar, onIntencao }: SeletorDePeriodoProps) {
  return (
    <div className="dashboard-period-presets" role="group" aria-label="Períodos rápidos">
      {opcoes.map((opcao) => (
        <button
          key={opcao.value}
          type="button"
          aria-pressed={selecionado === opcao.value}
          className={selecionado === opcao.value ? "is-active" : ""}
          onClick={() => onSelecionar(opcao.value)}
          onPointerEnter={() => onIntencao?.(opcao.value)}
          onFocus={() => onIntencao?.(opcao.value)}
        >
          {opcao.label}
        </button>
      ))}
    </div>
  );
}

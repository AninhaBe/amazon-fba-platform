import type { ReactNode } from "react";

/**
 * LINHA DE RENTABILIDADE — VENDA − CUSTOS = MARGEM, uma venda por linha.
 *
 * ⚠️ A EQUACAO E LITERAL NA TELA, com os sinais, e nao tres colunas soltas.
 * A vendedora confere o resultado contra outra ferramenta; ver a conta escrita
 * e o que permite discordar de um numero especifico em vez de do total.
 *
 * ⚠️ VALOR DESCONHECIDO E "—", NAO 0,00. Venda sem repasse postado, custo nao
 * cadastrado e imposto sem aliquota sao ausencias — zero seria um fato que
 * ninguem apurou.
 *
 * ⚠️ LOGISTICA E STATUS SAO FATOS DISTINTOS e aparecem os dois. Mostrar so um
 * escondia que o pedido estava pendente.
 *
 * ⚠️ A LINHA E UM CONTAINER (`container-type: inline-size` no CSS): quando ela
 * recebe menos largura — porque a tela a pos numa coluna de metade — a equacao
 * desce para uma linha propria em vez de a pilula de margem sair cortada. A
 * adaptacao olha o espaco recebido, nao qual tela renderiza.
 */
export interface LinhaDeRentabilidadeProps {
  produto: string;
  sku?: string;
  pedidoId: string;
  /** Ja formatada ("02/09/2026"). */
  data: string;
  logistica?: string;
  status: string;
  /** `true` quando o repasse ainda nao foi postado — o status sai em tom de atencao. */
  statusPendente?: boolean;
  /** "3 unidades × R$ 42,80" — montado por quem chama. */
  quantidade: string;
  /** Ja formatados; "—" quando desconhecido. */
  venda: string;
  custos: string;
  /** O selo de margem (use `ChipDeMargem`) ou "—". */
  margem: ReactNode;
  expandido?: boolean;
  onAlternar?: () => void;
}

export function LinhaDeRentabilidade({
  produto, sku, pedidoId, data, logistica, status, statusPendente,
  quantidade, venda, custos, margem, expandido = false, onAlternar,
}: LinhaDeRentabilidadeProps) {
  return (
    <article className={`profit-sale${expandido ? " is-expanded" : ""}`}>
      <div className="profit-sale-main">
        <div className="profit-sale-product">
          <strong title={produto}>{produto}</strong>
          <span className="profit-sale-sku">{sku || "Sem SKU"}</span>
          <small>Pedido #{pedidoId}</small>
        </div>
        <div className="profit-sale-meta" aria-label="Informações da venda">
          <span>{data}</span>
          {logistica && <span>{logistica}</span>}
          <span className={statusPendente ? "is-pendente" : undefined}>{status}</span>
          <span>{quantidade}</span>
        </div>
        <div className="profit-equation" aria-label="Resumo financeiro da venda">
          <div><span>Venda</span><strong>{venda}</strong></div>
          <i aria-hidden="true">−</i>
          <div className="is-cost"><span>Custos</span><strong>{custos}</strong></div>
          <i aria-hidden="true">=</i>
          <div className="is-margin"><span>Margem</span>{margem}</div>
        </div>
        <button
          type="button"
          className="profit-expand"
          aria-label={`${expandido ? "Ocultar" : "Mostrar"} composição da venda`}
          aria-expanded={expandido}
          onClick={onAlternar}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      </div>
    </article>
  );
}

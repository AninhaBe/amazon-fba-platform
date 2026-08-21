"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * A abertura do painel de canal — a frase que diz o que aconteceu, e o que
 * exige ação logo abaixo dela.
 *
 * ## O problema que ela resolve
 *
 * A intenção da tela é: a pessoa abre o NEXO de manhã e sabe o que aconteceu
 * com a operação dela ontem. O que existia no lugar era um subtítulo fixo —
 * "O que entrou, saiu e ainda depende de conciliação no período selecionado".
 * Isso descreve a própria tela, não o período. Ele é o mesmo texto num dia de
 * recorde e num dia de prejuízo.
 *
 * Aqui a frase é **calculada**. Muda com o dado, e é a única coisa da tela em
 * 20px — que é o tamanho que a referência reserva para a única frase que
 * carrega o peso (`docs/peec-ui-audit.md` §3 e §7).
 *
 * ## Por que a comparação vem junto
 *
 * "R$ 369,89" não permite julgamento. É bom? É ruim? Só dizendo contra o quê.
 * Todo número desta faixa nasce com o período anterior ao lado, e quando não
 * há histórico suficiente a frase **diz isso** em vez de inventar uma seta.
 *
 * ## Por que as pendências moram aqui
 *
 * Estavam em dois lugares: um bloco no topo e "Estoque crítico" no meio da
 * página, a 1.200px de distância. São a mesma pergunta — "o que precisa de
 * mim?" — e responder em dois lugares faz a pessoa rolar para descobrir se
 * terminou. Uma lista só, logo abaixo da frase.
 *
 * ## Compartilhada de propósito
 *
 * Os quatro canais usam esta mesma peça. Amazon, Mercado Livre, Shopee e
 * TikTok Shop entregam números diferentes, mas a pergunta da manhã é a mesma —
 * e quando a Shopee e o TikTok receberem conta real, a tela deles já nasce
 * igual à dos outros dois em vez de virar uma quinta variação.
 */

export interface BriefingAction {
  label: string;
  href: string;
  /** `alerta` = dinheiro parado ou venda perdida. `pendencia` = cadastro faltando. */
  tone?: "alerta" | "pendencia";
}

export interface BriefingLeadProps {
  /** Rótulo do período ("ontem", "últimos 7 dias"). Entra na frase. */
  periodo: string;
  faturamento: number | null;
  pedidos: number;
  /** `null` = ainda não dá para saber (custo ou tarifa faltando). Não é zero. */
  lucro: number | null;
  /** Faturamento do período anterior de mesmo tamanho. `null` = sem histórico. */
  faturamentoAnterior?: number | null;
  acoes?: BriefingAction[];
  format: (value: number) => string;
  loading?: boolean;
}

function variacao(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

/**
 * A frase. Cada ramo existe porque o anterior seria mentira ou seria vazio:
 * sem venda não há o que comparar, sem custo não há lucro a afirmar, e sem
 * histórico não há variação a exibir.
 */
function montarFrase(p: BriefingLeadProps): { titulo: string; detalhe: string | null } {
  const { periodo, faturamento, pedidos, lucro, faturamentoAnterior, format } = p;

  if (faturamento == null || pedidos === 0) {
    return {
      titulo: `Nenhuma venda ${periodo}.`,
      detalhe: "Se você esperava venda neste período, vale conferir se a conta continua conectada.",
    };
  }

  const venda = `${pedidos} ${pedidos === 1 ? "venda" : "vendas"} e ${format(faturamento)} ${periodo}`;

  // Lucro desconhecido é o caso MAIS comum no começo (custo não cadastrado), e
  // é onde o produto costuma mentir mostrando zero. Aqui ele diz que não sabe.
  if (lucro == null) {
    return {
      titulo: `${venda[0].toUpperCase()}${venda.slice(1)}.`,
      detalhe: "Quanto sobrou ainda não dá para dizer — falta custo ou tarifa. O lucro fica em branco até fechar.",
    };
  }

  const sobra = lucro >= 0
    ? `sobraram ${format(lucro)}`
    : `o resultado ficou negativo em ${format(Math.abs(lucro))}`;

  const v = faturamentoAnterior != null ? variacao(faturamento, faturamentoAnterior) : null;
  const comparacao = v == null
    ? null
    : Math.abs(v) < 1
      ? "Praticamente o mesmo do período anterior."
      : `${v > 0 ? "Alta" : "Queda"} de ${Math.abs(v).toFixed(0)}% contra o período anterior.`;

  return {
    titulo: `${venda[0].toUpperCase()}${venda.slice(1)} — ${sobra}.`,
    detalhe: comparacao,
  };
}

export function BriefingLead(props: BriefingLeadProps) {
  const { acoes = [], loading } = props;

  if (loading) {
    return (
      <div className="briefing-lead is-loading" aria-busy="true">
        <span className="briefing-lead-skeleton" style={{ width: "62%" }} />
        <span className="briefing-lead-skeleton" style={{ width: "38%", height: 18 }} />
      </div>
    );
  }

  const { titulo, detalhe } = montarFrase(props);

  return (
    <div className="briefing-lead">
      <div className="briefing-lead-texto">
        <h2>{titulo}</h2>
        {detalhe && <p>{detalhe}</p>}
      </div>

      {acoes.length > 0 && (
        <ul className="briefing-acoes" aria-label="O que precisa da sua atenção">
          {acoes.map((a) => (
            <li key={a.href + a.label}>
              <Link href={a.href} className={`briefing-acao${a.tone === "alerta" ? " is-alerta" : ""}`}>
                <span className="briefing-acao-marca" aria-hidden="true" />
                <span className="briefing-acao-label">{a.label}</span>
                <ArrowRight className="briefing-acao-seta" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

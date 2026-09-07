/**
 * TACOS — gasto com anúncio sobre o FATURAMENTO do período.
 *
 * ACOS mede o anúncio ("o que gastei sobre o que o anúncio vendeu"); TACOS mede
 * a OPERAÇÃO ("quanto do meu faturamento inteiro o anúncio consome"). É o
 * número que mostra dependência de mídia — na Amazon foi ele que denunciou 62%.
 *
 * ⚠️ A GARANTIA, e ela é a razão desta função existir separada: **TACOS nunca
 * mente para baixo.** O denominador é faturamento; um denominador maior do que
 * a realidade produz um percentual MENOR do que a realidade, e um TACOS baixo
 * demais é a leitura que faz alguém aumentar verba de anúncio achando que
 * sobra espaço. Por isso, base incompleta devolve `null` — nunca um número
 * menor.
 *
 * 📌 REPLICAR A GARANTIA, NÃO O MECANISMO (regra da dona do produto). Na Amazon
 * a recusa é `!semRepassePostado`, porque lá a base do card é o APURADO e ela
 * chega tarde. **No Mercado Livre isso não se aplica**: a base sai do próprio
 * pedido, no instante em que ele existe, sem depender de liquidação. Copiar
 * `semRepassePostado` para cá seria implantar defesa contra um problema que o
 * canal não tem.
 *
 * ⚠️ MAS O ML TEM O SEU PRÓPRIO BURACO, e é outro: pedido não cancelado **sem
 * valor** (`gross IS NULL`). Ele está no universo da base e não soma nada —
 * então o denominador fica menor que a realidade... o que faz o TACOS ficar
 * MAIOR. Esse lado é seguro (erra para cima, e a regra proíbe errar para
 * baixo), mas o número deixa de ser exato, então ele é DECLARADO em vez de
 * escondido: `pedidosSemValor` volta no payload para a tela apontar.
 */

export interface EntradaDoTacos {
  /** Gasto com anúncio no período. `null` = desconhecido (não é zero). */
  gasto: number | null;
  /**
   * Faturamento do período — no ML, todo pedido NÃO CANCELADO.
   *
   * ⚠️ NÃO é `paid_revenue` (aprovadas + canceladas, que espelha as "Vendas
   * brutas" do painel do ML, ADR-020). Cancelada no denominador o INFLA, e
   * denominador inflado é exatamente o "mentir para baixo" que a garantia
   * proíbe. As duas bases existem de propósito neste canal; TACOS usa esta.
   */
  faturamento: number | null;
  /** Pedidos na base sem valor conhecido. Só declara; não bloqueia. */
  pedidosSemValor?: number;
}

export interface TacosDoPeriodo {
  /** Percentual, ou `null` quando não dá para afirmar. */
  pct: number | null;
  /** Por que não deu, para a tela dizer em vez de mostrar travessão mudo. */
  /**
   * ⚠️ `gasto-desconhecido` NAO e "nao anunciou". A distincao existe porque o
   * caminho ao vivo do ML nao coleta anuncio, e chamar isso de "sem anuncio"
   * faria a tela afirmar que a conta nao anuncia — que e outro fato.
   */
  motivo: "gasto-desconhecido" | "sem-faturamento" | null;
  /** Quantos pedidos da base não têm valor — a tela aponta com número. */
  pedidosSemValor: number;
}

export function tacosDoPeriodo(entrada: EntradaDoTacos): TacosDoPeriodo {
  const pedidosSemValor = entrada.pedidosSemValor ?? 0;
  // Gasto desconhecido não vira zero: zero afirmaria "não anunciou", que é
  // fato diferente de "não sei quanto". `null != 0`, doutrina da casa.
  if (entrada.gasto == null) return { pct: null, motivo: "gasto-desconhecido", pedidosSemValor };
  // Sem faturamento não há sobre o que incidir. Zero no denominador não vira
  // infinito nem 0%: vira ausência.
  if (entrada.faturamento == null || entrada.faturamento <= 0) {
    return { pct: null, motivo: "sem-faturamento", pedidosSemValor };
  }
  return {
    pct: +((entrada.gasto / entrada.faturamento) * 100).toFixed(2),
    motivo: null,
    pedidosSemValor,
  };
}

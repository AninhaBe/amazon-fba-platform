/**
 * ISENÇÃO DE TARIFA DA AMAZON — por CONTA e com VIGÊNCIA.
 *
 * ⚠️ POR QUE NÃO É CONSTANTE, e a razão não é elegância: a conta da dona do
 * produto está isenta da tarifa de indicação por uma promoção desde 01/08/2026.
 * Um `if` global aplicando essa isenção acertaria a conta dela e **zeraria a
 * tarifa de todo cliente futuro que paga cheio** — silenciosamente, porque
 * tarifa a menos vira lucro a mais, e lucro a mais ninguém questiona.
 *
 * 📌 É a mesma família dos scripts de cura com `workspace_id` fixo (AGENTS.md):
 * o dado de UMA conta virando regra do produto. Aqui o estrago é pior, porque
 * não é um script que roda uma vez — é uma conta que fica errada para sempre.
 *
 * ⚠️ E A VIGÊNCIA É PELA DATA DO PEDIDO, nunca por "hoje". Um pedido de julho,
 * anterior à promoção, PAGOU tarifa; um de agosto, não. Aplicar a isenção de
 * hoje ao histórico reescreveria o passado e faria a margem de julho subir
 * sozinha — um número que nunca existiu.
 */

/** Uma janela de isenção. `ate: null` = ainda vigente, sem fim conhecido. */
export interface JanelaDeIsencao {
  /** Vocabulário canônico: qual tarifa deixa de ser cobrada. */
  feeType: "commission" | "fulfillment";
  /** Início da vigência, dia-calendário (YYYY-MM-DD). */
  de: string;
  /** Fim inclusivo, ou `null` enquanto durar. */
  ate: string | null;
  /** Por que existe — vai para a tela explicar o zero. */
  motivo: string;
}

/** A chave em `workspace_settings`. Uma linha por workspace, conexões dentro. */
export const CHAVE_DE_ISENCAO = "amazon_isencao_tarifa";

/**
 * O documento guardado: isenções POR CONEXÃO.
 *
 * Fica em `workspace_settings` porque ela já é por workspace e consultável —
 * nada de constante no código, nada de coluna nova. Um cliente novo entra
 * escrevendo uma linha, sem deploy.
 */
export interface DocumentoDeIsencao {
  [connectionId: string]: JanelaDeIsencao[];
}

/**
 * A isenção vale para esta tarifa, nesta data?
 *
 * Pura e sem banco — é o que torna a fronteira de vigência testável dos dois
 * lados sem precisar de Postgres.
 */
export function isentoEm(
  janelas: JanelaDeIsencao[] | undefined,
  feeType: string,
  dataDoPedidoISO: string | Date | null | undefined,
): JanelaDeIsencao | null {
  if (!janelas?.length || !dataDoPedidoISO) return null;
  // Dia-calendário de São Paulo: a vigência é anunciada em data, não em
  // instante, e comparar timestamps UTC jogaria o pedido das 22h do dia 31 para
  // o dia seguinte.
  const data = typeof dataDoPedidoISO === "string" ? dataDoPedidoISO : dataDoPedidoISO.toISOString();
  const dia = new Date(new Date(data).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return janelas.find((j) =>
    j.feeType === feeType && dia >= j.de && (j.ate == null || dia <= j.ate)) ?? null;
}

/** Lê as isenções do workspace corrente. Ausência = ninguém isento. */
export async function lerIsencoes(connectionId: string): Promise<JanelaDeIsencao[]> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const linhas = await dbQuery<{ value: unknown }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [currentWorkspaceId(), CHAVE_DE_ISENCAO],
  );
  const doc = linhas[0]?.value as DocumentoDeIsencao | undefined;
  const janelas = doc?.[connectionId];
  return Array.isArray(janelas) ? janelas : [];
}

/**
 * ═══ A ISENÇÃO É INFERIDA DO EXTRATO, não cadastrada à mão ═══════════════════
 *
 * Regra da dona do produto, 03/09/2026, verbatim: *"A isenção depende de conta
 * pra conta e só acaba quando atingir o teto de faturamento. Você pode se basear
 * nisso quando a amazon confirmar um pedido e vc ver que está com tarifa
 * cobrada, quer dizer que aquela conta já não tem mais isenção."*
 *
 * 📌 É melhor que data cadastrada por três motivos: ninguém sabe de antemão
 * quando o teto de faturamento é atingido; o teto é POR CONTA; e o extrato já
 * diz a verdade sem que a gente pergunte a ninguém.
 */

/** Um pedido CONFIRMADO com extrato postado — o único que carrega sinal. */
export interface PedidoConfirmado {
  external_order_id: string;
  /** Dia-calendário de São Paulo. */
  dia: string;
  /** Soma das tarifas de INDICAÇÃO (commission). `0` = a Amazon não cobrou. */
  comissao: number;
  /**
   * O pedido tem ALGUMA tarifa postada?
   *
   * ⚠️ É a distinção que sustenta tudo: pedido sem tarifa nenhuma é **extrato
   * que ainda não chegou**, não isenção. Confundir os dois faria toda conta
   * nascer "isenta" no dia em que conectasse — e desconto sem prova é o pior
   * erro possível aqui, porque infla o lucro e ninguém questiona lucro alto.
   */
  temExtrato: boolean;
}

export interface InferenciaDeIsencao {
  /** O que passa a valer. Vazio = conta paga cheio. */
  janelas: JanelaDeIsencao[];
  /** Por que — vai para o log e para a auditoria. */
  motivo: "sem-historico" | "isenta" | "teto-atingido";
  /** Pedido que provou o fim da isenção, quando houver. */
  primeiroComComissao: string | null;
  /**
   * Pedidos com comissão ZERO depois do flip. Não revertem nada — o teto é
   * permanente —, mas são anomalia e vão para o log.
   */
  anomalias: string[];
}

/**
 * Deriva o estado da isenção a partir dos pedidos confirmados.
 *
 * Pura de propósito: a decisão mais delicada do cálculo de tarifa não pode
 * depender de banco para ser testada nas fronteiras.
 */
export function inferirIsencao(confirmados: PedidoConfirmado[]): InferenciaDeIsencao {
  // Só pedido COM extrato carrega sinal. Sem extrato não há o que ler.
  const comSinal = confirmados
    .filter((p) => p.temExtrato)
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));

  // ⚠️ DEFAULT SEGURO, e ele é o INVERSO do intuitivo: conta sem histórico paga
  // CHEIO. Desconhecido não pode virar desconto — uma conta nova nasceria sem
  // tarifa até alguém perceber, e o erro apareceria como lucro bom.
  if (!comSinal.length) {
    return { janelas: [], motivo: "sem-historico", primeiroComComissao: null, anomalias: [] };
  }

  const primeiroCobrado = comSinal.find((p) => p.comissao > 0);
  if (!primeiroCobrado) {
    // Todos os confirmados vieram sem comissão: a conta está isenta, e a
    // vigência começa no primeiro pedido que provou isso.
    return {
      janelas: [{ feeType: "commission", de: comSinal[0].dia, ate: null, motivo: "promocao-indicacao" }],
      motivo: "isenta",
      primeiroComComissao: null,
      anomalias: [],
    };
  }

  // ⚠️ O FLIP É SÓ PARA FRENTE. O teto de faturamento é permanente: pedido
  // posterior com comissão zero NÃO devolve a isenção. Reverter faria a conta
  // oscilar entre isenta e não-isenta a cada estorno ou pedido atípico, e a
  // tarifa dos pendentes mudaria de valor sem nada ter mudado no mundo.
  const anomalias = comSinal
    .filter((p) => p.dia > primeiroCobrado.dia && p.comissao === 0)
    .map((p) => p.external_order_id);

  const antes = comSinal.filter((p) => p.dia < primeiroCobrado.dia);
  return {
    // A isenção existiu ATÉ o pedido que cobrou. Se nunca houve pedido isento
    // antes dele, não houve isenção nenhuma — janela vazia.
    janelas: antes.length
      ? [{ feeType: "commission", de: antes[0].dia, ate: primeiroCobrado.dia, motivo: "promocao-indicacao" }]
      : [],
    motivo: "teto-atingido",
    primeiroComComissao: primeiroCobrado.external_order_id,
    anomalias,
  };
}

/**
 * Lê os confirmados do canônico e devolve o estado inferido — POR CONEXÃO.
 *
 * ⚠️ O filtro `f.fee_type = 'commission'` é o coração: FBA e as outras tarifas
 * continuam sendo cobradas mesmo na isenção, então usar "tem tarifa qualquer"
 * como sinal diria que a conta perdeu a isenção no primeiro pedido FBA. O sinal
 * é a tarifa de INDICAÇÃO, e só ela.
 */
export async function inferirIsencaoDaConexao(connectionId: string): Promise<InferenciaDeIsencao> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const linhas = await dbQuery<{ external_order_id: string; dia: string; comissao: string; tem_extrato: boolean }>(
    `SELECT o.external_order_id,
            to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
            COALESCE(SUM(f.amount) FILTER (WHERE f.fee_type = 'commission'), 0)::text AS comissao,
            COUNT(f.*) > 0 AS tem_extrato
       FROM workspace_channel_orders o
       LEFT JOIN workspace_channel_order_fees f
         ON f.workspace_id = o.workspace_id AND f.provider = o.provider
        AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
      WHERE o.workspace_id = $1 AND o.provider = 'amazon' AND o.connection_id = $2
        AND o.status <> 'pending' AND o.status <> 'cancelled'
      GROUP BY 1, 2`,
    [currentWorkspaceId(), connectionId],
  );
  return inferirIsencao(linhas.map((l) => ({
    external_order_id: l.external_order_id,
    dia: l.dia,
    comissao: Number(l.comissao),
    temExtrato: l.tem_extrato,
  })));
}

/**
 * Grava o estado inferido na MESMA estrutura de vigência.
 *
 * 📌 A inferência escreve, mas o que vale é sempre a estrutura — auditável e
 * substituível à mão no dia em que a Amazon fizer algo que a inferência não
 * previu. Máquina que decide sem deixar o estado visível é máquina que ninguém
 * consegue corrigir.
 */
/**
 * Mescla o estado de UMA conexão no documento, preservando as outras.
 *
 * ⚠️ PURA DE PROPÓSITO, e a razão é um teste meu que falhou em ser teste: a
 * primeira guarda deste vazamento casava a STRING `doc[connectionId] = ...` no
 * fonte — e continuava verde com um `delete` de todas as chaves inserido na
 * linha de cima. Casar símbolo não prova comportamento (AGENTS.md), e a saída é
 * ter uma função que se possa CHAMAR.
 *
 * O vazamento que ela impede: a inferência da conta A apagando o estado da conta
 * B. As duas contas ficariam com a isenção da última que rodou.
 */
export function mesclarIsencao(
  atual: DocumentoDeIsencao | undefined,
  connectionId: string,
  janelas: JanelaDeIsencao[],
): DocumentoDeIsencao {
  return { ...(atual ?? {}), [connectionId]: janelas };
}

export async function gravarIsencaoInferida(connectionId: string, inferencia: InferenciaDeIsencao): Promise<void> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const workspaceId = currentWorkspaceId();
  const atual = await dbQuery<{ value: unknown }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, CHAVE_DE_ISENCAO],
  );
  const doc = mesclarIsencao(atual[0]?.value as DocumentoDeIsencao | undefined, connectionId, inferencia.janelas);
  await dbQuery(
    `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [workspaceId, CHAVE_DE_ISENCAO, JSON.stringify(doc)],
  );
  if (inferencia.anomalias.length) {
    // ⚠️ ANOMALIA É LOG, NUNCA DECISÃO. Comissão zero depois do teto não devolve
    // a isenção — mas alguém precisa saber que aconteceu.
    console.warn("[isencao-amazon] comissao zero DEPOIS do teto (nao reverte):", {
      connectionId, pedidos: inferencia.anomalias.slice(0, 10), total: inferencia.anomalias.length,
    });
  }
}

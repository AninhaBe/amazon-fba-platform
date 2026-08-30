import { dbQuery, hasDb } from "./db";
import { currentWorkspaceId } from "./workspaceScope";
import type { AnuncioDoPeriodo } from "./financialMath";

/**
 * O gasto com anúncio de UM canal num período — a leitura que os produtores de
 * lucro usam para cumprir a fronteira de `financialMath.ts`.
 *
 * ⚠️ AS DUAS TABELAS, E POR QUE NÃO SE SOMAM. `workspace_ad_metrics`
 * (migration 0012) é 1 linha por campanha×dia; `workspace_ad_product_metrics`
 * (0016) é 1 linha por produto×campanha×dia. É O MESMO DINHEIRO em
 * granularidades diferentes — somar as duas dobraria o gasto. E cada canal
 * escreve onde consegue: a Amazon grava nas duas (dois relatórios), o Mercado
 * Livre só na de produto (o PADS entrega por anúncio). Por isso a de campanha é
 * a autoridade QUANDO EXISTE, e a de produto é a fonte quando ela não existe —
 * nunca as duas ao mesmo tempo.
 *
 * ⚠️ `workspace_id` é `uuid` na 0012 e `text` na 0016 (a 0016 é text de
 * propósito, para poder dar JOIN com o canônico — está documentado lá). Os casts
 * abaixo são por causa disso, não por descuido.
 */

/** Casa com o gravador da 0012/0016: a coluna guarda o dia civil de Brasília. */
const diaBR = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

interface LinhaDeGasto {
  gasto: string | null;
  ate: string | null;
  linhas: string;
}

/**
 * O primeiro dia em que este canal entregou métrica de anúncio — o começo da
 * JANELA EM QUE SABEMOS ALGUMA COISA.
 *
 * É o que separa três estados que um `SUM` sozinho confunde:
 *   - período sem linha e ANTES deste dia → o canal não tinha coleta ainda;
 *     afirmar gasto seria inventar, e nulificar o lucro de todo mês anterior à
 *     integração transformaria histórico em "—" sem ninguém ter perdido dado;
 *   - período sem linha e DEPOIS dele → o canal anuncia e a métrica não chegou:
 *     DESCONHECIDO, e o lucro sai `null` em vez do número otimista;
 *   - canal que nunca entregou linha nenhuma → não anuncia, gasto zero, fato.
 *
 * Sem período no WHERE de propósito: a pergunta é sobre a conta, não sobre a
 * semana. `null` = nenhuma métrica jamais gravada para este canal.
 *
 * ⚠️⚠️ ISTO NÃO É UMA OTIMIZAÇÃO, E QUEM VIER "SIMPLIFICAR" VAI ACHAR QUE É.
 *
 * A consulta parece supérflua: já temos o `SUM` do período, e "sem linha" já
 * parece resposta suficiente. Não é. Ela existe para separar duas ausências que
 * o banco escreve com o mesmo silêncio:
 *
 *   **"não sabemos"** — o canal anuncia, o período está dentro da janela viva
 *   dele, e a métrica não chegou. Aqui o lucro TEM de sair `null`: o número sem
 *   anúncio seria otimista, e otimista sem aviso é mentira (AGENTS.md).
 *
 *   **"não havia o que saber"** — o período é anterior à primeira coleta deste
 *   canal. Não falta dado: não existia dado. Tratar isto como desconhecimento
 *   apagaria o lucro de TODO mês anterior à integração, trocando histórico bom
 *   por travessão — e o pior tipo de regressão é a que se disfarça de rigor.
 *
 * Remover `primeiroDiaComAnuncio` colapsa as duas no primeiro caso, o teste da
 * suíte continua verde (ele cobre o canal que gasta, não o mês de julho), e o
 * estrago só aparece quando alguém abrir um período antigo. Se você veio aqui
 * para cortar uma consulta, corte outra.
 */
async function primeiroDiaComAnuncio(provider: string): Promise<string | null> {
  const workspaceId = currentWorkspaceId();
  // ⚠️ DOIS PARÂMETROS COM O MESMO VALOR, DE PROPÓSITO — e a primeira versão
  // disto quebrou em produção por não fazer assim.
  //
  // `workspace_id` é `uuid` na 0012 e `text` na 0016 (a 0016 explica o porquê).
  // Com um `$1` só, o Postgres INFERE o tipo do parâmetro pelo primeiro uso —
  // `$1::uuid` — e o segundo uso vira `text = uuid`, que não tem operador:
  // `operator does not exist: text = uuid`, e o dashboard inteiro cai.
  //
  // O detalhe que fez isso passar pela suíte: o teste que varre as duas tabelas
  // não filtra por `workspace_id`, então a consulta dele nunca esbarrou no
  // conflito. Quem pegou foi a captura contra o banco REAL. Duas vagas
  // separadas removem a inferência da jogada.
  const rows = await dbQuery<{ dia: string | null }>(
    `SELECT to_char(LEAST(
              (SELECT MIN(day) FROM workspace_ad_metrics
                WHERE workspace_id = $1::uuid AND provider = $3),
              (SELECT MIN(day) FROM workspace_ad_product_metrics
                WHERE workspace_id = $2::text AND provider = $3)
            ), 'YYYY-MM-DD') AS dia`,
    [workspaceId, workspaceId, provider],
  );
  return rows[0]?.dia ?? null;
}

async function somar(
  tabela: "workspace_ad_metrics" | "workspace_ad_product_metrics",
  provider: string,
  de: string,
  ate: string,
): Promise<LinhaDeGasto | undefined> {
  // `tabela` nunca vem de fora: é literal de união, escolhido neste arquivo.
  const workspace = tabela === "workspace_ad_metrics" ? "$1::uuid" : "$1";
  const rows = await dbQuery<LinhaDeGasto>(
    `SELECT COALESCE(SUM(cost), 0)::text     AS gasto,
            to_char(MAX(day), 'YYYY-MM-DD')  AS ate,
            COUNT(*)::text                   AS linhas
       FROM ${tabela}
      WHERE workspace_id = ${workspace} AND provider = $2
        AND day >= $3::date AND day <= $4::date`,
    [currentWorkspaceId(), provider, de, ate],
  );
  return rows[0];
}

/**
 * ⚠️ NÃO EXTRAPOLA os dias sem métrica (AGENTS.md). Se o período tem 30 dias e a
 * coleta cobriu 3, o lucro desconta o gasto dos 3 e `ateDia` diz até quando —
 * inventar os outros 27 por média seria a projeção que a regra proíbe.
 */
export async function anuncioDoCanal(
  provider: string,
  deISO: string,
  ateISO: string,
  extrato?: { jaNoExtrato: boolean },
): Promise<AnuncioDoPeriodo> {
  // Sem banco (teste, build) o anúncio não é zero: é desconhecido. Mas só se o
  // canal anunciar — e sem banco não dá para saber, então "não anuncia" é a
  // resposta que preserva o comportamento de quem nunca ligou Ads.
  if (!hasDb()) return { gasto: 0, jaNoExtrato: extrato?.jaNoExtrato ?? false, ateDia: null };

  const de = diaBR(deISO);
  const ate = diaBR(ateISO);
  const [porCampanha, primeiroDia] = await Promise.all([
    somar("workspace_ad_metrics", provider, de, ate),
    primeiroDiaComAnuncio(provider),
  ]);

  const linha =
    porCampanha && Number(porCampanha.linhas) > 0
      ? porCampanha
      : await somar("workspace_ad_product_metrics", provider, de, ate);

  const temLinha = linha != null && Number(linha.linhas) > 0;
  // "não sabemos" ou "não havia o que saber"? Ver `primeiroDiaComAnuncio`: só
  // dentro da janela viva do canal a ausência de linha vira desconhecimento.
  const dentroDaJanela = primeiroDia != null && ate >= primeiroDia;
  return {
    // Canal que anuncia e não tem métrica NO PERÍODO: desconhecido, não zero.
    // Canal que nunca anunciou: zero, e isso é um fato sobre a operação dela.
    gasto: temLinha ? Number(linha.gasto) : dentroDaJanela ? null : 0,
    jaNoExtrato: extrato?.jaNoExtrato ?? false,
    ateDia: temLinha ? linha.ate : null,
  };
}

/**
 * O anúncio já veio como TARIFA no extrato do canal?
 *
 * Padrão, não lista de nomes exatos: a Amazon tem dezenas de tipos de tarifa e
 * só alguns estão confirmados — nome fora de uma lista sairia como R$ 0,00,
 * resposta errada com cara de certeza. Mesma escolha do agrupador de cards.
 *
 * Importa porque tarifa postada já saiu do repasse líquido: descontar a API de
 * Ads por cima contaria o mesmo dinheiro duas vezes. Hoje nenhum tipo casa — a
 * Amazon posta anúncio fora do extrato de pedido —, e a guarda existe para o dia
 * em que isso mudar sem aviso, que é como marketplace muda.
 */
export function anuncioJaNoExtrato(feeBreakdown?: { type: string; amount: number }[] | null): boolean {
  return (feeBreakdown ?? []).some((f) => /advertis|productads/i.test(f.type) && f.amount > 0);
}

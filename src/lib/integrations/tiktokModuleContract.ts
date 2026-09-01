export class TiktokModuleError extends Error {
  status: 400 | 404 | 409; code: string;
  constructor(status: 400 | 404 | 409, code: string, message: string) { super(message); this.status=status; this.code=code; }
}
export const TIKTOK_CATALOG_STATUSES = ["active", "paused", "closed"] as const;
export type PageRequest = { limit: number; offset: number };
export function pageRequest(params: URLSearchParams): PageRequest {
  const rawLimit=params.get("limit")??"50", rawOffset=params.get("offset")??"0";
  if(!/^\d+$/.test(rawLimit)||!/^\d+$/.test(rawOffset)) throw new TiktokModuleError(400,"INVALID_PAGINATION","Paginação inválida.");
  const limit=Number(rawLimit),offset=Number(rawOffset); if(limit<1||limit>100||offset>100_000) throw new TiktokModuleError(400,"INVALID_PAGINATION","Use limit entre 1 e 100 e offset até 100000.");
  return {limit,offset};
}
export function pageMetadata(page: PageRequest, total: number, returned: number) {
  return { ...page, total, hasMore: page.offset + returned < total };
}
/** Dia-calendário de Brasília. Offset fixo: o Brasil não tem horário de verão desde 2019. */
const BRT = "-03:00";
const DIA = 86_400_000;
const diaEmBrasilia = (instante = Date.now()) =>
  new Date(instante - 3 * 60 * 60_000).toISOString().slice(0, 10);

/** Os mesmos presets dos quatro dashboards. Divergir aqui cria a próxima diferença entre canais. */
const DIAS_ACEITOS = new Set([7, 15, 30]);

/**
 * O período de um módulo do TikTok: preset (`days`) OU intervalo (`from`/`to`).
 *
 * ⚠️ ATÉ 01/09/2026 ESTA FUNÇÃO SÓ ACEITAVA `from`/`to`, E ISSO PRODUZIU UM
 * DEFEITO DIÁRIO NA TELA. Como a rota exigia datas, a conversão de `days` para
 * data passou a viver no CLIENTE — e lá ela usava `toISOString()`, que é **UTC**.
 * Das 21h à meia-noite de Brasília (13% de todo dia, todo dia) o "hoje" do
 * cliente já era o dia seguinte em UTC: a janela ia para o FUTURO e a aba do
 * TikTok aparecia **vazia à noite e normal de manhã**.
 *
 * A Vitrine corrigiu a conversão do lado dela; esta é a correção de raiz. Com o
 * preset aceito aqui, o cliente manda `days` como nos outros três canais e não
 * precisa converter data nenhuma — conversão que não existe não erra de fuso.
 *
 * ⚠️ E A CONVERSÃO CERTA MORA NO SERVIDOR POR UM MOTIVO, não por gosto: o fuso
 * do cliente é o do navegador dela, e o dia-calendário que o Seller Central usa
 * é o de Brasília. Deixar a conta no cliente é aceitar que o recorte mude
 * conforme o relógio de quem abre a tela.
 */
export function periodRequest(params: URLSearchParams, maxDays = 365) {
  const from = params.get("from"), to = params.get("to");

  // Intervalo personalizado tem precedência: quem escolheu data quer aquela data.
  if (from || to) {
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      // Uma data só é pedido malformado, não meio período — recusar é o único
      // jeito de não inventar a outra ponta.
      throw new TiktokModuleError(400, "INVALID_PERIOD", "Informe from e to no formato YYYY-MM-DD.");
    }
    const start = new Date(`${from}T00:00:00${BRT}`), end = new Date(`${to}T23:59:59.999${BRT}`);
    if (!Number.isFinite(start.getTime()) || start > end || end.getTime() - start.getTime() > maxDays * DIA) {
      throw new TiktokModuleError(400, "INVALID_PERIOD", `O período deve ter no máximo ${maxDays} dias.`);
    }
    return { from: start, to: end, label: `${from} a ${to}` };
  }

  // ⚠️ O PADRÃO É "today", O MESMO DOS QUATRO DASHBOARDS. Dois padrões em dois
  // lugares divergem — é só questão de quando (AGENTS.md, e já aconteceu aqui
  // com o `|| "30"` do servidor contra o "Hoje" da tela).
  const days = params.get("days") ?? "today";
  const hoje = diaEmBrasilia();
  if (days === "today") {
    return { from: new Date(`${hoje}T00:00:00${BRT}`), to: new Date(`${hoje}T23:59:59.999${BRT}`), label: "Hoje" };
  }
  const n = Number(days);
  if (!DIAS_ACEITOS.has(n)) {
    throw new TiktokModuleError(400, "INVALID_PERIOD", "Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  }
  // N dias-calendário TERMINANDO hoje — inclusive hoje, como nos outros canais.
  const inicio = diaEmBrasilia(new Date(`${hoje}T00:00:00${BRT}`).getTime() - (n - 1) * DIA);
  return {
    from: new Date(`${inicio}T00:00:00${BRT}`),
    to: new Date(`${hoje}T23:59:59.999${BRT}`),
    label: `Últimos ${n} dias`,
  };
}

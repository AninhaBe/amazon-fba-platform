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
export function periodRequest(params:URLSearchParams,maxDays=365){const from=params.get("from"),to=params.get("to");if(!from||!to||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw new TiktokModuleError(400,"INVALID_PERIOD","Informe from e to no formato YYYY-MM-DD.");const start=new Date(`${from}T00:00:00-03:00`),end=new Date(`${to}T23:59:59.999-03:00`);if(!Number.isFinite(start.getTime())||start>end||end.getTime()-start.getTime()>maxDays*86_400_000)throw new TiktokModuleError(400,"INVALID_PERIOD",`O período deve ter no máximo ${maxDays} dias.`);return {from:start,to:end,label:`${from} a ${to}`};}

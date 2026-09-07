import { NextResponse, type NextRequest } from "next/server";
import { cronAutorizado } from "./portaoDoCron";

/**
 * Envelope HTTP do portao do cron. A DECISAO mora em `portaoDoCron.ts`, que e
 * pura e testada; aqui so entra o que precisa do Next.
 *
 * Devolve `null` quando pode seguir, ou a resposta de recusa.
 */
export function portaoDoCron(req: NextRequest): NextResponse | null {
  if (cronAutorizado(req.headers.get("authorization"), process.env.CRON_SECRET)) return null;
  // ⚠️ 404, NUNCA 401: para quem nao tem o segredo, esta rota nao existe.
  return new NextResponse("Not Found", { status: 404 });
}

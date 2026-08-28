import { shopeeGet } from "@/lib/integrations/shopeeRoute";
import { getShopeeSaudeDaConta } from "@/lib/integrations/shopeeAccountHealth";
import { isShopeeDemoConnection } from "@/lib/integrations/shopeeConnection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saúde da conta: leitura de estado ao vivo (cache 30 min na lib). A demo não
// chama a Open Platform e não ganha dado sintético aqui — a tela diz o estado
// real ("indisponível na demonstração"), nunca números inventados.
export async function GET(request: Request) {
  return shopeeGet(request, async (connection) => {
    if (isShopeeDemoConnection(connection)) return { availability: "NOT_AVAILABLE" };
    return { availability: "AVAILABLE", saude: await getShopeeSaudeDaConta(connection) };
  });
}

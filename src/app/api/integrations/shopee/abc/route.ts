import { shopeeGet } from "@/lib/integrations/shopeeRoute";
import { readShopeeAbc } from "@/lib/integrations/shopeeModules";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request) { return shopeeGet(request, readShopeeAbc); }

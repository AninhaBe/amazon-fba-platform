import { tiktokGet } from "@/lib/integrations/tiktokRoute";
import { readInventory } from "@/lib/integrations/tiktokModules";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request){return tiktokGet(request,readInventory);}

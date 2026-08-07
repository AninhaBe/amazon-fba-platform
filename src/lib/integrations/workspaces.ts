export type WorkspaceId = "overview" | "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

const legacyAmazonRoutes = ["/calculadora", "/monitor", "/desempenho", "/estoque", "/pesquisa", "/produtos"];

export function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === "/amazon" || pathname.startsWith("/amazon/") || legacyAmazonRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return "amazon";
  if (pathname === "/mercado-livre" || pathname.startsWith("/mercado-livre/")) return "mercado_livre";
  if (pathname === "/shopee" || pathname.startsWith("/shopee/")) return "shopee";
  if (pathname === "/tiktok" || pathname.startsWith("/tiktok/")) return "tiktok_shop";
  return "overview";
}

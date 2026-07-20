export type WorkspaceId = "overview" | "amazon" | "mercado_livre";

const legacyAmazonRoutes = ["/calculadora", "/monitor", "/desempenho", "/estoque", "/pesquisa", "/produtos"];

export function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === "/amazon" || pathname.startsWith("/amazon/") || legacyAmazonRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return "amazon";
  if (pathname === "/mercado-livre" || pathname.startsWith("/mercado-livre/")) return "mercado_livre";
  return "overview";
}

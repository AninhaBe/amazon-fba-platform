import { NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "../workspaceContext";
import { requireTiktokConnection, TiktokModuleError } from "./tiktokModules";

export function tiktokGet(request: Request, read: (connection: Awaited<ReturnType<typeof requireTiktokConnection>>, params: URLSearchParams) => Promise<unknown>) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const params = new URL(request.url).searchParams;
      const connection = await requireTiktokConnection(params);
      return NextResponse.json({ connection: { id: connection.id, name: connection.displayName, region: connection.region }, ...(await read(connection, params) as object) });
    } catch (error) {
      if (error instanceof TiktokModuleError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      return NextResponse.json({ error: "Não foi possível carregar os dados TikTok.", code: "TIKTOK_READ_FAILED" }, { status: 500 });
    }
  });
}

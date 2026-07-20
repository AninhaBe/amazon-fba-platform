import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "./supabase/server";
import { runWithWorkspace } from "./workspaceScope";

export async function withAuthenticatedWorkspace<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Autenticação ainda não configurada no servidor." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const workspaceId = data?.claims?.sub;
  if (error || !workspaceId) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  return runWithWorkspace(String(workspaceId), fn);
}

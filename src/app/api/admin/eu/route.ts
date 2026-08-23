import { NextResponse } from "next/server";
import { comAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Sou admin?" — o único jeito de a interface saber, sem ela decidir nada.
//
// 📌 O PADRÃO, para quando alguém adicionar a próxima função só de admin:
//
//   1. A rota de dados é envolvida em `comAdmin` — é ELA que protege.
//   2. A interface consulta este endpoint só para decidir se MOSTRA o caminho.
//
// Esconder o link não é controle de acesso: quem digitar a URL chega igual, e é
// por isso que a rota de dados precisa do próprio portão. O inverso também vale
// — proteger só o dado e deixar o link à mostra funciona, mas oferece à pessoa
// uma porta que vai bater na cara dela.
//
// Responde 200 para admin e 404 para o resto — a mesma regra de todo
// `/api/admin/*`. Ver docs/adr/ADR-024-tela-de-administracao.md.
export async function GET() {
  return comAdmin(async () => NextResponse.json({ admin: true }));
}

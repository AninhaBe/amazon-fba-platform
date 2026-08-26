"use server";

import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import type { AuthActionState } from "../login/actions";

// Mensagem única, dita sempre — exista a conta ou não. Responder "esse e-mail não
// está cadastrado" transforma a tela num verificador de quem é cliente do NEXO:
// qualquer pessoa descobre, um e-mail por vez, quem tem conta aqui.
const RESPOSTA_NEUTRA =
  "Se existir uma conta com esse e-mail, o link para criar uma senha nova acabou de sair. Confira a caixa de entrada e o spam.";

export async function requestPasswordReset(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { message: "Informe um e-mail válido." };

  if (!supabaseConfigured()) {
    return { message: "Configure as credenciais do Supabase no servidor." };
  }

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // `/auth/confirm` troca o token do e-mail por sessão e só então manda para a
    // tela da senha nova. Ir direto para `/nova-senha` cairia no proxy sem sessão.
    redirectTo: `${baseUrl}/auth/confirm?next=/nova-senha`,
  });

  // Erro aqui é quase sempre limite de envio do Supabase. Mesmo assim não
  // devolvemos o texto cru dele: diz coisa de API, em inglês, para o vendedor.
  if (error) {
    return { message: "Não foi possível enviar o link agora. Tente de novo em alguns minutos." };
  }

  return { success: true, message: RESPOSTA_NEUTRA };
}

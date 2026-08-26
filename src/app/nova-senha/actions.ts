"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import type { AuthActionState } from "../login/actions";

export async function definirNovaSenha(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  // Mesma régua do cadastro: mudar aqui e não lá deixaria a recuperação mais
  // frouxa que a porta da frente.
  if (password.length < 8) return { message: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== confirmation) return { message: "As senhas não coincidem." };

  if (!supabaseConfigured()) {
    return { message: "Configure as credenciais do Supabase no servidor." };
  }

  const supabase = await createClient();

  // O proxy já barra quem não tem sessão, mas Server Action é endpoint POST
  // público: quem souber o ID da action chega aqui sem passar pela tela.
  const { data, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !data.user) {
    return { message: "Este link expirou ou já foi usado. Peça um novo em Esqueci minha senha." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { message: "Não foi possível salvar a senha nova. Tente novamente." };
  }

  // Trocar a senha tem que derrubar as outras sessões. Se alguém entrou na conta
  // — o motivo mais comum de recuperar senha —, deixar a sessão dele viva faz a
  // troca não servir para nada.
  await supabase.auth.signOut({ scope: "others" });

  revalidatePath("/", "layout");
  redirect("/");
}

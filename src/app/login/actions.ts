"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { mensagemDeFalhaDeLogin } from "./mensagemDeFalha";

export interface AuthActionState {
  message?: string;
  success?: boolean;
}

function credentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  };
}

function validate(email: string, password: string): string | null {
  if (!email || !email.includes("@")) return "Informe um e-mail válido.";
  if (password.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  return null;
}

export async function signIn(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!supabaseConfigured()) return { message: "Configure as credenciais do Supabase no servidor." };
  const { email, password } = credentials(formData);
  const validation = validate(email, password);
  if (validation) return { message: validation };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { message: mensagemDeFalhaDeLogin(error) };

  const requested = String(formData.get("next") ?? "");
  const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signUp(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!supabaseConfigured()) return { message: "Configure as credenciais do Supabase no servidor." };
  const { email, password } = credentials(formData);
  const passwordConfirmation = String(formData.get("password_confirmation") ?? "");
  const validation = validate(email, password);
  if (validation) return { message: validation };
  if (password !== passwordConfirmation) return { message: "As senhas não coincidem." };

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${baseUrl}/auth/confirm` },
  });
  // Nunca devolver `error.message` cru: vem em inglês e com vocabulário de API
  // ("User already registered", "Email rate limit exceeded"). Além de ilegível
  // para o vendedor, o texto do Supabase diz se o e-mail já tem conta — o mesmo
  // vazamento que a tela de recuperação evita de propósito.
  if (error) {
    return { message: "Não foi possível criar a conta agora. Confira os dados e tente novamente." };
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/");
  }
  return { success: true, message: "Conta criada. Confira seu e-mail para confirmar o acesso." };
}

// NÃO redireciona aqui: o LogoutButton faz a navegação com reload REAL do
// navegador (window.location), o que zera os caches de módulo do cliente
// (centralCache, dashCache, monitorCache...). Sem isso, o logout é uma navegação
// SPA e esses caches sobrevivem — pintando os dados da conta anterior antes de
// revalidar. Foi o vazamento entre contas relatado em 22/08/2026.
export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete("active_seller");
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

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
  if (error) return { message: "E-mail ou senha incorretos." };

  const requested = String(formData.get("next") ?? "");
  const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signUp(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!supabaseConfigured()) return { message: "Configure as credenciais do Supabase no servidor." };
  const { email, password } = credentials(formData);
  const validation = validate(email, password);
  if (validation) return { message: validation };

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${baseUrl}/auth/confirm` },
  });
  if (error) return { message: error.message };

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/");
  }
  return { success: true, message: "Conta criada. Confira seu e-mail para confirmar o acesso." };
}

export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete("active_seller");
  redirect("/login");
}

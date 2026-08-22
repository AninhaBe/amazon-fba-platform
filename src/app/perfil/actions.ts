"use server";

import { revalidatePath } from "next/cache";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export interface ProfileActionState {
  tone?: "success" | "error";
  message?: string;
}

function validateDisplayName(value: FormDataEntryValue | null): string | null {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return null;
  if (name.length > 80) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export async function updateProfile(
  _state: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const displayName = validateDisplayName(formData.get("displayName"));
  if (!displayName) {
    return { tone: "error", message: "Informe um nome entre 2 e 80 caracteres." };
  }
  if (!supabaseConfigured()) {
    return { tone: "error", message: "Não foi possível acessar a conta agora." };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { tone: "error", message: "Sua sessão expirou. Entre novamente para continuar." };
  }

  const { error } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (error) {
    return { tone: "error", message: "Não foi possível salvar o perfil. Tente novamente." };
  }

  revalidatePath("/configuracoes");
  return { tone: "success", message: "Nome atualizado no seu perfil." };
}

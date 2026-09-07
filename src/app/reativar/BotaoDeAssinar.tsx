"use client";

import { useState } from "react";

/**
 * O botão que abre o pagamento. Ele NÃO decide preço nem status — pede a sessão
 * ao servidor e vai para onde a Stripe mandar.
 */
export function BotaoDeAssinar({ rotulo }: { rotulo: string }) {
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function assinar() {
    setIndo(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/billing/checkout", { method: "POST" });
      const dados = (await resposta.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!resposta.ok || !dados?.url) {
        setErro(dados?.error ?? "Não foi possível abrir o pagamento agora.");
        setIndo(false);
        return;
      }
      window.location.href = dados.url;
    } catch {
      setErro("Não foi possível falar com o servidor. Verifique a conexão e tente de novo.");
      setIndo(false);
    }
  }

  return (
    <div>
      <button type="button" className="auth-submit" onClick={assinar} disabled={indo}>
        {indo ? "Abrindo o pagamento…" : rotulo}
      </button>
      {/* Erro aparece por escrito, com o que fazer. Botão que não responde e
          não explica é o pior desfecho possível numa tela de pagamento. */}
      {erro && (
        <p role="alert" className="auth-message">
          {erro}
        </p>
      )}
    </div>
  );
}

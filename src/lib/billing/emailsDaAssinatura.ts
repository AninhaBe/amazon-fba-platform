/**
 * Os dois e-mails que a assinatura manda. Texto puro aqui, envio no runtime.
 *
 * ⚠️ NENHUM DELES AFIRMA VALOR. Quem sabe quanto foi cobrado é a Stripe, e é ela
 * que manda o recibo. Repetir o preço aqui seria uma segunda fonte da verdade
 * sobre dinheiro — no dia em que o preço mudar no painel, o e-mail mente.
 */
export type TipoDeAvisoDaAssinatura = "boas-vindas" | "pagamento-falhou";

export interface AvisoDaAssinatura {
  assunto: string;
  texto: string;
}

const ENTRAR = "https://nexoaihub.com.br";

export function montarAviso(tipo: TipoDeAvisoDaAssinatura, dados: { contaNova: boolean }): AvisoDaAssinatura {
  if (tipo === "boas-vindas") {
    return {
      assunto: "Sua assinatura do NEXO está ativa",
      texto: dados.contaNova
        ? [
            "Pagamento confirmado — bem-vinda ao NEXO.",
            "",
            "Enviamos um segundo e-mail com o link para você criar sua senha. Depois de",
            "criá-la, entre em " + ENTRAR + " e conecte seus canais de venda.",
            "",
            "Qualquer dúvida, é só responder este e-mail.",
          ].join("\n")
        : [
            "Pagamento confirmado — seu acesso ao NEXO está liberado.",
            "",
            "Nada foi perdido: canais conectados, custos cadastrados e histórico continuam",
            "onde estavam. Entre em " + ENTRAR + " para continuar.",
            "",
            "Qualquer dúvida, é só responder este e-mail.",
          ].join("\n"),
    };
  }
  return {
    assunto: "Não conseguimos processar o pagamento do NEXO",
    texto: [
      "A cobrança da sua assinatura do NEXO não foi aprovada.",
      "",
      "Isso costuma ser cartão vencido, limite ou uma recusa do banco. A Stripe tenta",
      "de novo automaticamente nos próximos dias — se preferir resolver agora, atualize",
      "a forma de pagamento em " + ENTRAR + "/reativar.",
      "",
      "Seu acesso e seus dados continuam disponíveis enquanto as tentativas seguem.",
    ].join("\n"),
  };
}

const REMETENTE = "NEXO <assinatura@nexoaihub.com.br>";

/**
 * Envio pelo Resend. Devolve `null` em sucesso, ou o detalhe do erro para o log.
 *
 * ⚠️ NUNCA LANÇA. E-mail que não sai é chato; evento de pagamento reprocessado
 * porque o e-mail falhou é a pessoa recebendo duas cobranças de aviso e o ledger
 * marcando erro num pagamento que deu certo.
 */
export async function enviarAviso(
  tipo: TipoDeAvisoDaAssinatura,
  dados: { email: string | null; contaNova: boolean }
): Promise<string | null> {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) return "RESEND_API_KEY ausente";
  if (!dados.email) return "evento sem e-mail: não há para quem mandar";

  const aviso = montarAviso(tipo, { contaNova: dados.contaNova });
  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: REMETENTE,
        to: [dados.email],
        subject: aviso.assunto,
        text: aviso.texto,
      }),
    });
    if (resposta.ok) return null;
    return `Resend respondeu ${resposta.status}: ${await resposta.text().catch(() => "")}`;
  } catch (motivo) {
    return `falha de rede ao chamar o Resend: ${motivo instanceof Error ? motivo.message : String(motivo)}`;
  }
}

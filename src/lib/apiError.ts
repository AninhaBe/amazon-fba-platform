import { NextResponse } from "next/server";
import { SpApiError } from "./spapi";

// Converte qualquer erro capturado numa resposta HTTP segura para a equipe:
// - a UI recebe uma mensagem amigável em `error` (string, compatível com o front atual)
//   + `errorInfo` estruturado (code, requestId, retryable);
// - o servidor registra o detalhe técnico com um requestId de correlação,
//   NUNCA incluindo token, secret ou dado sensível.

let seq = 0;
function newRequestId(): string {
  // id curto de correlação (não precisa ser criptográfico).
  seq = (seq + 1) % 1_000_000;
  return `req_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function errorResponse(err: unknown): NextResponse {
  const requestId = newRequestId();
  const timestamp = new Date().toISOString();

  if (err instanceof SpApiError) {
    console.error(
      JSON.stringify({
        requestId,
        endpoint: err.endpoint,
        status: err.status,
        code: err.code,
        amazonRequestId: err.amazonRequestId,
        technicalMessage: err.technicalDetail,
        timestamp,
      })
    );
    return NextResponse.json(
      {
        error: err.userMessage,
        errorInfo: { code: err.code, requestId, retryable: err.retryable },
      },
      // 5xx da Amazon vira 502 (falha de upstream); 4xx repassa o status.
      { status: err.status >= 500 ? 502 : err.status }
    );
  }

  const technicalMessage = err instanceof Error ? err.message : String(err);
  console.error(
    JSON.stringify({ requestId, code: "INTERNAL", technicalMessage, timestamp })
  );
  return NextResponse.json(
    {
      error: "Não foi possível carregar os dados.",
      errorInfo: { code: "INTERNAL", requestId, retryable: false },
    },
    { status: 500 }
  );
}

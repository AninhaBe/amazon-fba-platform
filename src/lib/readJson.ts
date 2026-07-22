// Lê o corpo de uma resposta como JSON de forma tolerante: se vier vazio
// (ex.: 500 com corpo em branco, timeout de gateway, servidor reiniciando
// durante deploy), devolve {} em vez de estourar "Unexpected end of JSON
// input". Corpo não-vazio e inválido (uma página de erro HTML, por exemplo)
// vira uma mensagem legível. O chamador mantém a checagem de response.ok.
export async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      response.status >= 500
        ? "O serviço demorou para responder. Tente novamente em instantes."
        : "A resposta do servidor foi interrompida. Atualize a página e tente novamente."
    );
  }
}

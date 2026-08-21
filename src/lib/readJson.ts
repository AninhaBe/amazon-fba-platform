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
    // Não afirmar timeout sem evidência de timeout. A versão anterior dizia
    // "O serviço demorou para responder" para QUALQUER 5xx com corpo não-JSON,
    // e isso mandou procurar lentidão numa falha que respondeu em 189ms — o
    // servidor quebrou na hora, não demorou.
    //
    // A regra que o produto já aplica a dado incerto vale para erro também:
    // dizer o que aconteceu, não inventar a causa. "Tente em instantes" faz a
    // pessoa repetir um clique que vai falhar de novo.
    throw new Error(
      response.status >= 500
        ? `O servidor respondeu com erro ${response.status}. Isso é falha nossa, não da sua conexão — repetir agora não resolve.`
        : "A resposta do servidor veio incompleta. Atualize a página e tente novamente."
    );
  }
}

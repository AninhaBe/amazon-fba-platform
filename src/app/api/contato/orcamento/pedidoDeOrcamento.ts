/**
 * Pedido de orçamento da landing — a DECISÃO, separada do transporte.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE SEPARADO DA ROTA, e não é gosto de arquitetura:
 * o runner de teste deste projeto não resolve `next/server`, então todo teste de
 * rota do repo hoje se limita a LER O FONTE — e casar texto do fonte não prova
 * comportamento nenhum (AGENTS.md). Numa rota pública que valida entrada de
 * estranho e dispara e-mail, "o código menciona maxLength" é exatamente o tipo
 * de garantia que não garante nada.
 *
 * Aqui a decisão é uma função pura de entrada/saída: o teste monta o corpo, chama
 * e confere o status e a mensagem. A rota vira adaptador de três linhas.
 *
 * ⚠️ TUDO QUE CHEGA AQUI É TEXTO DE ESTRANHO. A validação do cliente (`required`,
 * `type="email"`, `maxLength`) é experiência, não defesa: qualquer pessoa posta
 * direto na rota sem passar pela tela. Formato, tamanho e vocabulário são
 * decididos aqui, e o que não bate é RECUSADO — nunca "corrigido em silêncio".
 *
 * ⚠️ E ELA É ALVO DE SPAM POR CONSTRUÇÃO: rota pública que dispara e-mail é uma
 * máquina de envio de graça. O domínio é nosso e a reputação de envio também —
 * um flood daqui queima a entrega de TODO e-mail do produto, inclusive o de
 * recuperação de senha. Por isso o teto por IP e o teto global vêm antes do
 * envio, e antes até de ler o corpo.
 */

/** Mesma lista fixa da tela. Vem de lá porque o e-mail é sobre o que ela oferece. */
export const MARKETPLACES = ["Amazon", "Mercado Livre", "Shopee", "TikTok Shop", "Site próprio"];
export const FAIXAS = [
  "Até 100 pedidos/mês",
  "100 a 500 pedidos/mês",
  "500 a 2.000 pedidos/mês",
  "Mais de 2.000 pedidos/mês",
];

export const LIMITE_DE_CORPO = 4 * 1024;
export const LIMITE_POR_IP = 5;
export const LIMITE_GLOBAL = 60;
export const JANELA_MS = 60 * 60 * 1000;

export const DESTINO = "contato@nexoaihub.com";
/**
 * ⚠️ O REMETENTE É DO DOMÍNIO VERIFICADO — e ele é o `.com.br`, não o `.com`.
 *
 * Medido em produção em 02/09/2026, com a chave já publicada:
 *
 *   403  This API key is not authorized to send emails from nexoaihub.com
 *
 * A primeira versão usava `contato@nexoaihub.com` porque é o endereço que a
 * empresa divulga. Mas quem autoriza o envio é o **domínio verificado no
 * provedor**, e o verificado (desde 26/08) é `nexoaihub.com.br` — a chave é
 * restrita a ele por privilégio mínimo, que é o desenho certo e foi o que
 * denunciou o erro.
 *
 * 📌 A LIÇÃO: os dois domínios existem e fazem coisas diferentes (o `.com` é
 * Squarespace + Google Workspace, e-mail; o `.com.br` é Registro.br + Fly, o
 * app). "O e-mail da empresa" e "o domínio que pode enviar" não são a mesma
 * coisa, e escolher pelo primeiro parece certo até o provedor recusar.
 *
 * ⚠️ Enviar "de" um endereço de terceiro continua proibido pelo motivo de
 * sempre: o SPF/DKIM dele não cobre o nosso envio, cai em spam e queima a NOSSA
 * reputação. A pessoa vai em `reply_to`, que é o campo que existe para isso.
 *
 * O DESTINATÁRIO continua no `.com`: receber não exige verificação nenhuma, e é
 * a caixa que a dona do produto lê.
 */
export const REMETENTE = "NEXO <orcamento@nexoaihub.com.br>";

export interface PedidoDeOrcamento {
  nome: string;
  email: string;
  marketplaces: string[];
  faixaDePedidos: string;
}

export interface Resultado {
  status: number;
  corpo: { ok: true } | { error: string };
}

/**
 * Contadores em memória.
 *
 * ⚠️ O QUE ISTO **NÃO** GARANTE, dito aqui para ninguém confiar demais: o estado
 * vive no processo. Reinício de máquina ou deploy zera a janela, e se um dia o
 * app rodar em mais de uma máquina cada uma terá o seu contador — o teto real
 * vira `N × LIMITE`. Hoje o app roda numa máquina só (Fly, app `nexo`), então o
 * limite vale como escrito.
 *
 * Foi escolhido assim de propósito: a alternativa é uma tabela, e tabela exige
 * migration — o portão mais lento que temos, num item com prazo. O gatilho da
 * troca está escrito: **se `fly scale count` passar de 1, isto vira tabela.**
 */
const porIp = new Map<string, number[]>();
let global: number[] = [];

/** Só para o teste: cenários de teto precisam começar de uma folha limpa. */
export function zerarContadores() {
  porIp.clear();
  global = [];
}

const dentroDaJanela = (marcas: number[], agora: number) =>
  marcas.filter((marca) => agora - marca < JANELA_MS);

const recusa = (status: number, mensagem: string): Resultado => ({ status, corpo: { error: mensagem } });

/** Texto simples: sem HTML não há injeção de HTML. */
export function textoDoEmail(pedido: PedidoDeOrcamento) {
  return [
    "Pedido de orçamento pela landing do NEXO.",
    "",
    `Nome: ${pedido.nome}`,
    `E-mail: ${pedido.email}`,
    `Canais: ${pedido.marketplaces.join(", ")}`,
    `Volume: ${pedido.faixaDePedidos}`,
  ].join("\n");
}

export interface Entrada {
  corpoBruto: string | null;
  ip: string;
  agora: number;
  /** `null` = sem credencial configurada. A rota NÃO finge que enviou. */
  chave: string | null | undefined;
  /** Injetado para o teste não tocar a rede. Devolve `null` em sucesso, ou o detalhe do erro. */
  enviar: (pedido: PedidoDeOrcamento) => Promise<string | null>;
  /** Onde o detalhe técnico é registrado — nunca na resposta ao navegador. */
  registrar?: (mensagem: string, detalhe?: unknown) => void;
}

export async function processarPedidoDeOrcamento(entrada: Entrada): Promise<Resultado> {
  const { corpoBruto, ip, agora, chave, enviar } = entrada;
  const registrar = entrada.registrar ?? (() => {});

  // ── Tetos ANTES de qualquer trabalho ──────────────────────────────────────
  // Inclusive antes de olhar o corpo: quem manda 10 MB não deve nos custar o
  // processamento de 10 MB.
  global = dentroDaJanela(global, agora);
  if (global.length >= LIMITE_GLOBAL) {
    return recusa(429, `Estamos recebendo muitos pedidos agora. Escreva para ${DESTINO} que respondemos hoje.`);
  }
  const desteIp = dentroDaJanela(porIp.get(ip) ?? [], agora);
  if (desteIp.length >= LIMITE_POR_IP) {
    porIp.set(ip, desteIp);
    return recusa(429, `Você já enviou alguns pedidos. Se for urgente, escreva direto para ${DESTINO}.`);
  }

  // ── Corpo ─────────────────────────────────────────────────────────────────
  if (corpoBruto == null) return recusa(400, "Não foi possível ler o formulário. Tente novamente.");
  if (corpoBruto.length > LIMITE_DE_CORPO) {
    return recusa(413, "O formulário veio grande demais. Reduza o texto e tente novamente.");
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    return recusa(400, "Não foi possível ler o formulário. Tente novamente.");
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return recusa(400, "Não foi possível ler o formulário. Tente novamente.");
  }
  const dados = corpo as Record<string, unknown>;
  const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
  const nome = texto(dados.nome);
  const email = texto(dados.email);

  if (nome.length < 2 || nome.length > 120) {
    return recusa(400, "Informe seu nome (de 2 a 120 caracteres).");
  }
  // ⚠️ Sem quebra de linha em NENHUM campo que entra no e-mail. É assim que se
  // injeta cabeçalho (um `\nBcc:` no meio de um valor), e `email` alimenta o
  // `reply_to`. O `trim()` acima não resolve: ele só tira das pontas.
  if (/[\r\n]/.test(nome) || /[\r\n]/.test(email)) {
    return recusa(400, "O formulário contém caracteres inválidos.");
  }
  // Formato deliberadamente simples e estrito no que importa: um arroba, sem
  // espaço, com ponto no domínio. Validar e-mail por regex completa é folclore —
  // o que confirma o endereço é a resposta chegar.
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return recusa(400, "Informe um e-mail válido para receber o orçamento.");
  }

  // ── Vocabulário: reduzir ao conhecido, não repassar ───────────────────────
  // O que chega de fora da lista não é "um canal novo": é texto de estranho
  // indo para dentro do nosso e-mail.
  const enviados = Array.isArray(dados.marketplaces) ? dados.marketplaces : [];
  const marketplaces = MARKETPLACES.filter((conhecido) => enviados.includes(conhecido));
  if (marketplaces.length === 0) {
    return recusa(400, "Escolha ao menos um canal para receber o orçamento.");
  }
  const faixaDePedidos = texto(dados.faixaDePedidos);
  if (!FAIXAS.includes(faixaDePedidos)) {
    return recusa(400, "Escolha o volume de pedidos por mês.");
  }

  // ── Envio ─────────────────────────────────────────────────────────────────
  if (!chave) {
    // ⚠️ SEM CREDENCIAL, A ROTA DIZ QUE NÃO ENVIOU. A tentação seria responder
    // 200 para o formulário "funcionar" — e aí o pedido some sem ninguém saber,
    // que é pior do que a landing sem formulário. O caminho alternativo vai
    // junto: quem falha sem dar o e-mail transforma interessado em desistente.
    registrar("RESEND_API_KEY ausente — pedido NAO enviado");
    return recusa(503, `Não conseguimos enviar agora. Escreva para ${DESTINO} que respondemos hoje.`);
  }

  const falha = await enviar({ nome, email, marketplaces, faixaDePedidos });
  if (falha != null) {
    // O detalhe fica no log; a pessoa recebe uma frase dizível. Repassar corpo de
    // erro de API para a tela é como nome de recurso e chave escapam.
    registrar("falha ao enviar o pedido", falha);
    return recusa(502, `Não conseguimos enviar agora. Escreva para ${DESTINO} que respondemos hoje.`);
  }

  // Só conta quem chegou até aqui: pedido recusado por validação não gasta a
  // cota de quem preencheu errado e vai corrigir.
  porIp.set(ip, [...desteIp, agora]);
  global = [...global, agora];
  return { status: 200, corpo: { ok: true } };
}

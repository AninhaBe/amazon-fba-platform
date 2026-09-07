import { timingSafeEqual } from "node:crypto";

/**
 * O PORTAO DAS ROTAS DE CRON — um lugar so, para as cinco.
 *
 * ⚠️ NASCEU DA AUDITORIA DE SUPERFICIE DE 07/09/2026, que achou a mesma
 * conferencia copiada em cinco arquivos com duas fraquezas identicas em todos:
 * comparacao de segredo com `!==` e recusa em `401`. Copiar cinco vezes e
 * garantir que a sexta copia nasca diferente.
 *
 * Duas propriedades, cada uma com um motivo medido:
 *
 * 1. **Comparacao em tempo constante.** `!==` vaza o tamanho do prefixo correto
 *    pelo tempo de resposta. E pouco, e e gratis nao vazar — a Shopee, a Stripe
 *    e o webhook do ML ja faziam assim; so o cron nao fazia.
 *
 * 2. **404, nao 401.** `401` confirma que a rota existe e que ha um segredo a
 *    adivinhar. Para quem nao tem o segredo, esta rota nao existe — mesma regra
 *    do `/admin` (ADR-024) e do webhook do ML.
 *
 * ⚠️ FALHA FECHADA, e SEM janela de convivencia: sem `CRON_SECRET`, ninguem
 * entra. O cron e disparado por infraestrutura nossa, que sempre pode carregar
 * o cabecalho — nao ha chamador legado a proteger. Onde havia (o webhook do ML),
 * a janela foi declarada com prazo; aqui nao ha o que declarar.
 *
 * ⚠️ E A DECISAO MORA AQUI, SEM `next/server`, de proposito: o envelope HTTP fica
 * em `portaoDoCronHttp.ts`. Com o import do Next aqui dentro, esta funcao nao
 * roda no ambiente de teste e a unica prova possivel seria olhar o texto do
 * arquivo — que nao prova comportamento nenhum.
 */
export function cronAutorizado(cabecalho: string | null, segredo: string | undefined): boolean {
  if (!segredo) return false;
  if (!cabecalho) return false;
  return iguais(cabecalho, `Bearer ${segredo}`);
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Tamanhos diferentes fazem `timingSafeEqual` lancar. Comparar tamanho antes
  // vaza o tamanho, que nao e o segredo — o conteudo e.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

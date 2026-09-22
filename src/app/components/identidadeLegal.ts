/**
 * QUEM OPERA O NEXO — a identificação legal, num lugar só.
 *
 * ⚠️ POR QUE ISTO EXISTE (22/09/2026). O cadastro do NEXO na
 * **AbacatePay** foi reprovado porque o site público não exibia a identificação
 * do fornecedor. A causa medida não foi ausência de documento — a Política de
 * Privacidade já trazia razão social e CNPJ desde 24/08 —, foi **visibilidade**:
 * quem audita entra pela home e precisa achar tudo a partir dali.
 *
 * Então o dado passa a aparecer em toda página pública, e por isso ele mora
 * aqui: repetido em cinco arquivos, ele diverge no dia em que um número mudar,
 * e identificação divergente num site de pagamento é pior que identificação
 * ausente.
 *
 * ⚠️ O CNPJ NÃO FOI INVENTADO NEM ADIVINHADO. Ele é o que a
 * própria Política de Privacidade já publica desde 24/08/2026
 * (`src/app/privacidade/page.tsx`), e casa com a razão social de empresário
 * individual, em que o nome da empresa é a raiz do CNPJ seguida do nome da
 * pessoa. Se algum dia estiver errado, é UMA linha para corrigir — e a correção
 * alcança a home, o login, a assinatura, os Termos e a Política de uma vez.
 */
export const IDENTIFICACAO_LEGAL = {
  razaoSocial: "66.106.202 ANA BEATRIZ DE OLIVEIRA",
  cnpj: "66.106.202/0001-20",
  /**
   * Canal de contato do fornecedor — **só e-mail**, decisão dela em
   * 22/09/2026. Não acrescentar telefone ou WhatsApp aqui sem ordem: canal
   * publicado é canal que alguém precisa atender.
   */
  email: "contato@nexoaihub.com",
} as const;

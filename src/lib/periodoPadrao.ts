/**
 * O PERÍODO PADRÃO DO PRODUTO — uma constante, lida pela TELA e pelo SERVIDOR.
 *
 * Decisão da dona do produto, 31/08/2026, verbatim: *"Todo click no dashboard
 * (para Mercado Livre, Amazon, Shopee e TikTok) precisa entrar com o Hoje
 * clicado ao invés de 30 dias. O carregamento é mais rápido e a necessidade
 * principal é saber o lucro de hoje."*
 *
 * 🔴 POR QUE ELA SAIU DE `DashboardPeriodFilter.tsx` (02/09/2026): aquele módulo
 * é `"use client"`, e o contrato dos módulos da Shopee roda no SERVIDOR — os
 * dois precisavam da mesma constante e não podiam se importar. Sem um lugar
 * neutro, cada lado escreveu o seu:
 *
 *   tela      `escolhida.get("days") ?? "today"`
 *   servidor  `params.get("days") ?? "30"`
 *
 * Resultado medido: quando a query chegava sem `days` — primeira carga, link
 * direto, cache —, a tela ROTULAVA "Hoje" e o servidor RESPONDIA 30 dias. A
 * vendedora viu **R$ 372 mil e 10.146 vendas** sob um filtro dizendo "Hoje",
 * quando o dia tinha **R$ 10.143,96 e 280 vendas**.
 *
 * 📌 Ninguém errou uma decisão: os dois defaults é que nunca foram conciliados.
 * É a família "duas variáveis que por acaso coincidem hoje" — só que estas nem
 * chegaram a coincidir. **Um lugar só, e as duas pontas leem dele.**
 *
 * ⚠️ Este arquivo não importa React nem nada de cliente, DE PROPÓSITO: é o que
 * permite que o servidor o leia. Acrescentar dependência aqui quebra isso e a
 * divergência volta pela mesma porta.
 */
export type OpcaoDePeriodo = "today" | "7" | "15" | "30" | "custom";

export const PERIODO_PADRAO: Exclude<OpcaoDePeriodo, "custom"> = "today";

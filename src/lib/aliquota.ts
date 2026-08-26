/**
 * A alíquota de imposto, e a dica que a explica na tela.
 *
 * Mora em `src/lib` porque serve os QUATRO canais: a calculadora do Mercado
 * Livre e o painel único da Visão geral (`AliquotasPorCanal.tsx`) usam a mesma
 * regra. Nasceu dentro de `mercado-livre/calculadora/` e foi movida daqui para
 * não obrigar componente compartilhado a importar de uma pasta de canal.
 *
 * ⚠️ O CAMPO É SIMULAÇÃO. ELE NÃO SALVA NADA.
 *
 * A calculadora só faz `GET` em `/api/integrations/mercado-livre/settings`; os
 * `POST` dela vão para `/calculator`, que consulta tarifa. O valor digitado vive
 * em `useState` e some ao trocar de página.
 *
 * A dica antiga dizia **"Alíquota configurada"** assim que qualquer número fosse
 * digitado. Em 25/08/2026 alguém digitou 5%, leu que estava configurada, e o
 * dashboard do Mercado Livre passou horas com Lucro e Margem em "—" esperando
 * uma alíquota que nunca tinha sido gravada — enquanto o número existia e valia
 * R$ 61,89 (margem 3,0%).
 *
 * Por isso a dica agora responde três perguntas diferentes, em vez de uma:
 * o que está salvo, o que está no campo, e onde salvar.
 *
 * Módulo puro e separado da página para poder ser testado.
 */

/**
 * Onde a alíquota é gravada de verdade.
 *
 * Desde 26/08/2026 os quatro canais têm o campo na **Visão geral**, num lugar
 * só — antes era preciso descobrir a tela de cada canal, e no Mercado Livre
 * havia dois campos, um que salvava e outro que só simulava.
 */
export const ONDE_SALVAR = "salve na Visão geral";

const pct = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/**
 * @param campo  o que está digitado agora (texto cru do input)
 * @param salva  a alíquota gravada na conta; `null` = não configurada
 */
export function dicaDoImposto(campo: string, salva: number | null): string {
  const cru = campo.trim().replace(",", ".");
  const vazio = cru === "";
  const valor = vazio ? null : Number(cru);
  // Número inválido não vira dica sobre alíquota: o campo é `type="number"` e o
  // navegador já entrega "" nesse caso, mas texto colado pode chegar aqui.
  if (!vazio && !Number.isFinite(valor)) return `Informe um percentual — ${ONDE_SALVAR}`;

  if (salva == null) {
    return vazio
      ? `Não configurada — ${ONDE_SALVAR} para o lucro do canal aparecer`
      : `Simulação — nada salvo ainda; ${ONDE_SALVAR}`;
  }
  if (vazio) return `Simulando sem imposto — a salva é ${pct(salva)}`;
  // Comparação por valor, não por texto: "5", "5.0" e "5,00" são a mesma coisa.
  return valor === salva
    ? "Alíquota salva na sua conta"
    : `Simulação — a salva é ${pct(salva)}`;
}

#!/usr/bin/env node
/**
 * Calculadora de lance para Amazon Sponsored Products.
 *
 * Responde a pergunta que a tela de criação nunca responde: "quanto eu posso
 * pagar por clique sem sair no prejuízo?". A tela sugere um número olhando o
 * leilão; ela não conhece o seu custo.
 *
 *   node scripts/lance.mjs --preco 27.90 --custo 5.84
 *   node scripts/lance.mjs --preco 22.11 --custo 6.82 --tarifas 3.31 --cvr 12
 *   node scripts/lance.mjs --preco 27.90 --custo 5.84 --cpc 1.28   (avalia um lance)
 *
 * Regra do projeto: dado desconhecido é `null`, não zero. Aqui isso vira
 * recusa explícita — sem preço e custo o script não chuta, ele para.
 */

const ARGS = process.argv.slice(2);

function arg(nome) {
  const i = ARGS.indexOf(`--${nome}`);
  if (i === -1 || i === ARGS.length - 1) return null;
  const bruto = Number(ARGS[i + 1].replace(",", "."));
  return Number.isFinite(bruto) ? bruto : null;
}

const preco = arg("preco");
const custo = arg("custo");
const tarifas = arg("tarifas") ?? 0;
const cvrInformado = arg("cvr");
const cpcAvaliar = arg("cpc");

if (preco === null || custo === null) {
  console.error(`
Uso: node scripts/lance.mjs --preco <R$> --custo <R$> [opções]

  --preco     preço que o comprador paga (use o valor do PEDIDO, não o do anúncio —
              cupom não aparece na Pricing API e só desconta se for resgatado)
  --custo     custo do produto
  --tarifas   comissão + FBA + frete. Padrão 0.
              ⚠️ Zero só é verdade enquanto a promoção "FBA GRÁTIS" durar.
  --cvr       taxa de conversão em %, se você já mediu. Padrão: mostra uma faixa.
  --cpc       um lance específico para avaliar (opcional)
`);
  process.exit(1);
}

if (preco <= 0 || custo < 0 || tarifas < 0) {
  console.error("Erro: preço deve ser positivo; custo e tarifas não podem ser negativos.");
  process.exit(1);
}

const margem = preco - custo - tarifas;

if (margem <= 0) {
  console.error(`
❌ Margem unitária é ${brl(margem)} — negativa ou zero.

Não existe lance que se pague: cada venda já sai no prejuízo antes do anúncio.
O problema é preço ou custo, não campanha. Não anuncie este produto.
`);
  process.exit(1);
}

const acosEquilibrio = margem / preco;

console.log(`
┌─ Produto ────────────────────────────────────
│  Preço ao comprador      ${brl(preco).padStart(10)}
│  Custo do produto      − ${brl(custo).padStart(10)}
│  Tarifas               − ${brl(tarifas).padStart(10)}${tarifas === 0 ? "   ⚠️  zero informado" : ""}
│  ──────────────────────────────────
│  Margem unitária         ${brl(margem).padStart(10)}
└──────────────────────────────────────────────

ACOS de equilíbrio: ${pct(acosEquilibrio)}
   Acima disso, o anúncio consome mais que a margem inteira.
   Este é o SEU teto — não os 30% de benchmark de mercado.
`);

if (cvrInformado !== null) {
  if (cvrInformado <= 0 || cvrInformado > 100) {
    console.error("Erro: --cvr deve estar entre 0 e 100.");
    process.exit(1);
  }
  linhaCvr(cvrInformado / 100, true);
} else {
  console.log("CPC de equilíbrio por taxa de conversão:\n");
  console.log("   CVR     CPC equilíbrio   CPC p/ ACOS 30%   CPC p/ ACOS 50%");
  console.log("   ─────────────────────────────────────────────────────────");
  for (const cvr of [0.05, 0.08, 0.1, 0.12, 0.15, 0.2]) linhaCvr(cvr, false);
  console.log(`
⚠️  Sem CVR medido, 10% é hipótese de trabalho — e precisa ser dita como hipótese.
    Com menos de ~10 cliques não há conversão medida.`);
}

if (cpcAvaliar !== null) {
  const cvr = (cvrInformado ?? 10) / 100;
  const lucroPorClique = cvr * margem - cpcAvaliar;
  const acosResultante = cpcAvaliar / (cvr * preco);
  console.log(`
┌─ Avaliando um lance de ${brl(cpcAvaliar)} ${cvrInformado === null ? "(CVR suposta de 10%)" : `(CVR de ${cvrInformado}%)`}
│  ACOS resultante        ${pct(acosResultante).padStart(10)}
│  Lucro por clique       ${brl(lucroPorClique).padStart(10)}  ${lucroPorClique >= 0 ? "✅" : "🔴 cada clique tira dinheiro"}
│  Cliques por venda      ${(1 / cvr).toFixed(0).padStart(10)}
└──────────────────────────────────────────────`);
  if (lucroPorClique < 0) {
    console.log(`
Em fase de ranqueamento isso pode ser aceitável DE PROPÓSITO — o objetivo é
velocidade de venda para o BSR, não lucro por clique. Mas tem que ser escolha,
não descuido: são ${brl(-lucroPorClique)} por clique saindo do bolso.`);
  }
}

console.log(`
📌 Lembrar: lance base × (1 + ajuste de posicionamento) × (1 + ajuste dinâmico).
   Com ajuste de topo e dinâmico "aumento e redução" ligados, o que você paga
   pode ser MÚLTIPLO do número acima. Ver referencias/lance-e-orcamento.md
`);

function linhaCvr(cvr, detalhado) {
  const equilibrio = margem * cvr;
  const acos30 = 0.3 * cvr * preco;
  const acos50 = 0.5 * cvr * preco;
  if (detalhado) {
    console.log(`Com CVR de ${(cvr * 100).toFixed(0)}% (1 venda a cada ${(1 / cvr).toFixed(0)} cliques):
   CPC de equilíbrio          ${brl(equilibrio)}   ← acima disso, prejuízo por clique
   CPC para ACOS de 30%       ${brl(acos30)}
   CPC para ACOS de 50%       ${brl(acos50)}   ← faixa de lançamento`);
  } else {
    console.log(
      `   ${(cvr * 100).toFixed(0).padStart(3)}%   ` +
        `${brl(equilibrio).padStart(13)}   ${brl(acos30).padStart(15)}   ${brl(acos50).padStart(15)}`,
    );
  }
}

function brl(v) {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

function pct(v) {
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

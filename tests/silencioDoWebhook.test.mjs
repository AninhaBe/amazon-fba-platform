import test from "node:test";
import assert from "node:assert/strict";
import { avaliarSilencio, LIMITE_DE_SILENCIO_MS } from "../src/lib/integrations/silencioDoWebhook.ts";

// ═══ O ALARME QUE TERIA PEGO 236 HORAS DE SILÊNCIO ═══════════════════════════
//
// QUAL DEFEITO ESTE ARQUIVO REPROVA, com o número que ele teve no mundo real:
// medido em 01/09/2026 sobre 41,7 dias, o webhook do Mercado Livre teve CINCO
// silêncios acima de 60 horas — o maior de 236 HORAS, de 15/08 a 25/08. Ninguém
// soube, porque não havia nada olhando. Custou 7 pedidos da conta CRYSTALFANCY
// (seis `paid`) criados nos últimos 30 minutos daquele apagão.
//
// ⚠️ O CASO QUE MAIS IMPORTA AQUI É O DA MADRUGADA, e ele é o motivo de o alarme
// medir INTERVALO e não VOLUME. O volume varia 7× ao longo do dia (307/h no pico,
// 44/h às 4h da manhã); qualquer limite de volume que não dispare às 11h dispara
// às 4h, e alarme que toca sozinho toda noite é desligado em uma semana.
//
// COMO VER VERMELHO: troque `arredondado > limiteMinutos` por
// `arredondado > limiteMinutos * 10` em `avaliarSilencio` — o caso dos 236
// minutos passa a devolver "ok" e reprova. Feito em 01/09/2026; os 236 minutos
// do teste são um décimo das 236 horas reais, de propósito, para o caso ficar
// bem acima do limite sem parecer arbitrário.

const LIMITE = LIMITE_DE_SILENCIO_MS / 60_000;

test("silêncio normal não alarma: o p99 do intervalo é 4 minutos", () => {
  const r = avaliarSilencio(4);
  assert.equal(r.estado, "ok");
  assert.equal(r.mensagem, null, "sem alarme não se escreve mensagem — ruído é o que mata alarme");
});

test("o pior silêncio de uma semana saudável (18 min) ainda NÃO alarma", () => {
  // É o caso que define a folga: 18 minutos aconteceu de verdade, num período
  // sem incidente. Se o limite disparasse aqui, seria falso alarme semanal.
  assert.equal(avaliarSilencio(18).estado, "ok");
});

test("APAGÃO alarma — o caso que custou 7 pedidos", () => {
  const r = avaliarSilencio(236);
  assert.equal(r.estado, "silencioso");
  assert.match(r.mensagem, /236 minutos/);
  // A mensagem diz o que quebrou E o que ainda funciona. Aviso que só assusta
  // produz pânico; o que aponta o que sobrou permite decidir.
  assert.match(r.mensagem, /sincroniza[çc][ãa]o peri[óo]dica/i);
});

test("a fronteira é exatamente o limite, e ela não é ambígua", () => {
  assert.equal(avaliarSilencio(LIMITE).estado, "ok", "no limite ainda não alarma");
  assert.equal(avaliarSilencio(LIMITE + 1).estado, "silencioso", "um minuto além, alarma");
});

test("MADRUGADA não alarma: é onde um limite de VOLUME falharia", () => {
  // Às 4h são ~44 eventos/hora — um a cada 82 segundos. O intervalo continua
  // curto mesmo com sete vezes menos volume, e é por isso que a grandeza certa
  // é o intervalo. Um limite de volume calibrado para o pico acusaria a
  // madrugada inteira, toda noite.
  assert.equal(avaliarSilencio(2).estado, "ok");
});

test("sem histórico NÃO é silêncio: é ausência de dado", () => {
  const r = avaliarSilencio(null);
  assert.equal(r.estado, "sem-historico");
  assert.equal(r.ultimoEventoHaMinutos, null);
  assert.equal(r.mensagem, null, "alarmar sobre pergunta não respondida é pior que não alarmar");
});

test("valor inválido não vira alarme nem vira ok silencioso", () => {
  assert.equal(avaliarSilencio(Number.NaN).estado, "sem-historico");
});

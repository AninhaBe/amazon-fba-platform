import test from "node:test";
import assert from "node:assert/strict";
import { brDate, brTime } from "../src/lib/datetime.ts";

// Data SEM hora voltava um dia na tela.
//
// `new Date("2026-08-25")` é meia-noite UTC; formatado em America/Sao_Paulo isso
// vira 21h de 24/08 — e a data exibida era a do dia anterior. Achado em
// 23/08/2026 pela rodada do TikTok, num caminho do Mercado Livre.
//
// Não é canto escuro: os três overviews canônicos projetam
// `to_char(occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`, ou seja,
// data já convertida para o fuso certo. O parse como UTC desfazia a conversão
// que o SQL tinha acabado de fazer.

test("data sem hora mantem o dia", () => {
  assert.equal(brDate("2026-08-25"), "25/08/2026");
  assert.equal(brDate("2026-01-01"), "01/01/2026");
  // Virada de ano é onde o erro aparecia mais feio: 01/01 virava 31/12.
  assert.equal(brDate("2027-01-01"), "01/01/2027");
});

test("timestamp com offset continua respeitando o fuso do Brasil", () => {
  // Meia-noite e meia UTC é 21h30 do dia anterior em Brasília.
  assert.equal(brDate("2026-08-25T00:30:00Z"), "24/08/2026");
  // O mesmo instante, escrito no offset do Brasil.
  assert.equal(brDate("2026-08-24T21:30:00-03:00"), "24/08/2026");
});

test("objeto Date nao e reinterpretado", () => {
  assert.equal(brDate(new Date("2026-08-25T12:00:00Z")), "25/08/2026");
});

test("brTime segue no fuso do Brasil", () => {
  assert.equal(brTime("2026-08-25T12:00:00Z"), "09:00");
});

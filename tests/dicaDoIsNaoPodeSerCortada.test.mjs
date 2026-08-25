import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A DICA DO "i" É UM `::after` QUE SOBE. QUALQUER RECORTE ACIMA DELE A APAGA.
//
// Achado por ela em 25/08/2026: *"tem o i de information em todos os cards, mas
// passo por cima e não tem nada escrito nos de cima"*. A bolinha aparecia em
// todos, e a faixa de baixo funcionava — a de cima, nunca.
//
// A causa não estava no `::after`, que estava correto e servido em produção:
// `.metric-label` tinha `overflow: hidden` (para reticências de rótulo longo) e
// o "i" era DESCENDENTE dele. O recorte comia a dica inteira.
//
// Nenhum teste de regra pegaria isso. Este pega.

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const metric = readFileSync(new URL("../src/app/components/Metric.tsx", import.meta.url), "utf8");

/** O bloco de uma regra CSS, pelo seletor exato. */
function regra(seletor) {
  const i = css.indexOf(`\n${seletor} {`);
  assert.ok(i > 0, `regra ${seletor} precisa existir`);
  return css.slice(i, css.indexOf("}", i));
}

test("o rotulo NAO recorta - senao a dica morre nele", () => {
  const r = regra(".metric-label");
  assert.doesNotMatch(r, /overflow:\s*(hidden|clip|auto|scroll)/,
    ".metric-label não pode recortar: o 'i' é descendente dele e a dica sobe");
});

test("as reticencias continuam existindo, no span de dentro", () => {
  // O recorte não foi removido, foi MOVIDO. Rótulo longo continua com "…".
  const r = regra(".metric-label-text");
  assert.match(r, /overflow:\s*hidden/);
  assert.match(r, /text-overflow:\s*ellipsis/);
});

test("o 'i' e irmao do texto, nao filho", () => {
  // Se alguém devolver o `{label}` para dentro do span junto com o MetricInfo,
  // o recorte volta a alcançar a dica.
  const i = metric.indexOf('className="metric-label"');
  const bloco = metric.slice(i, i + 400);
  assert.match(bloco, /<span className="metric-label-text">\{label\}<\/span>/);
  const fecha = bloco.indexOf("</span>");
  const infoPos = bloco.indexOf("MetricInfo");
  assert.ok(infoPos > fecha, "o MetricInfo tem de vir DEPOIS do span do texto");
});

test("a faixa de baixo, que sempre funcionou, segue sem recorte", () => {
  const i = css.indexOf(".compact-metric p {");
  assert.ok(i > 0);
  assert.doesNotMatch(css.slice(i, css.indexOf("}", i)), /overflow:\s*(hidden|clip)/);
});

test("a dica sobe e depende de nada recortar acima", () => {
  // Documenta a dependência: se um dia a dica passar a descer, o risco muda de
  // lugar e este arquivo inteiro precisa ser relido.
  const r = regra(".metric-info::after");
  assert.match(r, /bottom:\s*calc\(100% \+ 7px\)/);
  assert.match(r, /content:\s*attr\(data-dica\)/);
});

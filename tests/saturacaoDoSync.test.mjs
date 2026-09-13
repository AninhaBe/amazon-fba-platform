import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CICLO_ESPERADO_MIN,
  FATOR_DE_ALERTA,
  formatarDefasagem,
  piorSaturacao,
  saturacaoDoSync,
} from "../src/lib/saturacaoDoSync.ts";

// Monitor Unificado, E0 (28/08/2026): "Sincronizado há X min" nos quatro
// monitores, com alerta quando a defasagem passa de 3× o ciclo do canal.

const MIN = 60_000;
const now = 1_700_000_000_000;
const ha = (minutos) => new Date(now - minutos * MIN).toISOString();

// ⚠️ TESTE QUE TRAVA A REGRA (exigência explícita do plano aprovado): conta em
// primeira sincronização NUNCA dispara alarme — nem afirma "sincronizado".
test("primeira sincronização é silêncio obrigatório — sem alarme falso em conta recém-conectada", () => {
  // Recém-conectada: nada preenchido ainda.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: null, lastSuccessAt: null, cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Kick disparou mas o primeiro ciclo ainda não fechou: covered_from vazio.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: null, lastSuccessAt: ha(500), cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Cobertura marcada sem sucesso registrado: afirmar sincronismo seria inventar.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: ha(0), lastSuccessAt: null, cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Timestamp corrompido não vira alarme.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: ha(0), lastSuccessAt: "não-é-data", cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
});

test("dentro de 3× o ciclo é sincronizado; além disso é atrasado, com o ciclo no resultado", () => {
  const base = { coveredFrom: ha(60 * 24), cicloEsperadoMin: 2, agoraMs: now };
  // 6 min = exatamente 3× o ciclo de 2 min: ainda não é notícia.
  assert.deepEqual(saturacaoDoSync({ ...base, lastSuccessAt: ha(6) }), {
    estado: "sincronizado",
    minutosAtras: 6,
    cicloEsperadoMin: 2,
  });
  assert.deepEqual(saturacaoDoSync({ ...base, lastSuccessAt: ha(7) }), {
    estado: "atrasado",
    minutosAtras: 7,
    cicloEsperadoMin: 2,
  });
  // Canal de ciclo longo não alarma no ritmo do canal curto.
  assert.equal(
    saturacaoDoSync({ ...base, cicloEsperadoMin: 10, lastSuccessAt: ha(25) }).estado,
    "sincronizado"
  );
  // Relógio do cliente atrás do servidor não vira defasagem negativa.
  assert.equal(saturacaoDoSync({ ...base, lastSuccessAt: ha(-3) }).minutosAtras, 0);
});

test("os quatro canais têm ciclo esperado e o fator de alerta é 3", () => {
  assert.deepEqual(Object.keys(CICLO_ESPERADO_MIN).sort(), ["amazon", "mercado_livre", "shopee", "tiktok_shop"]);
  for (const ciclo of Object.values(CICLO_ESPERADO_MIN)) assert.ok(ciclo > 0);
  assert.equal(FATOR_DE_ALERTA, 3);
});

test("com várias conexões a tela mostra a pior: atrasado > sincronizado, mais defasado primeiro", () => {
  const sync5 = { estado: "sincronizado", minutosAtras: 5, cicloEsperadoMin: 2 };
  const sync1 = { estado: "sincronizado", minutosAtras: 1, cicloEsperadoMin: 2 };
  const atras30 = { estado: "atrasado", minutosAtras: 30, cicloEsperadoMin: 2 };
  const atras90 = { estado: "atrasado", minutosAtras: 90, cicloEsperadoMin: 2 };
  assert.deepEqual(piorSaturacao([sync1, atras30, sync5]), atras30);
  assert.deepEqual(piorSaturacao([atras30, atras90]), atras90);
  assert.deepEqual(piorSaturacao([sync1, sync5]), sync5);
  // Conexão nova no meio não silencia nem alarma as demais.
  assert.deepEqual(piorSaturacao([{ estado: "silencio" }, sync5]), sync5);
  assert.deepEqual(piorSaturacao([{ estado: "silencio" }]), { estado: "silencio" });
  assert.deepEqual(piorSaturacao([]), { estado: "silencio" });
});

test("defasagem legível: minutos até 2 h, horas depois — sem falsa precisão", () => {
  assert.equal(formatarDefasagem(0), "menos de 1 min");
  assert.equal(formatarDefasagem(7), "7 min");
  assert.equal(formatarDefasagem(119), "119 min");
  assert.equal(formatarDefasagem(120), "2 h");
  assert.equal(formatarDefasagem(750), "12 h");
});

/**
 * ⚠️ ESTES DOIS TESTES MUDARAM DE INTENÇÃO EM 13/09/2026, E A
 * DIREÇÃO SE INVERTEU: eles EXIGIAM a faixa de estado do sync nos quatro
 * monitores; agora eles PROÍBEM que ela volte.
 *
 * Ordem da dona do produto, confirmada explicitamente, e o fundamento é a
 * doutrina dela de 02/09/2026: *"sobre os dados sincronizados, isso precisa
 * estar de pé sempre"*. Sincronização é chão, não notícia — falha de sync
 * alarma para NÓS (o vigia por canal no /api/health e o Grafana), se autocura
 * quando dá, e só chega à tela da vendedora se atravessar tudo isso, o que é
 * incidente, não aviso. "Sincronizado há 4 min" é estado normal virando
 * manchete; "Sincronização atrasada" é problema nosso pedindo atenção dela sem
 * dizer o que ela pode fazer.
 *
 * O QUE SAIU, para quem precisar reverter: o componente
 * `src/app/components/EstadoDoSync.tsx` (apagado — ficou sem nenhum consumidor),
 * as quatro chamadas nos monitores dos quatro canais, e as três regras de CSS
 * `.estado-do-sync*` do `globals.css`.
 *
 * ⚠️ O QUE **NÃO** SAIU, de propósito: a régua (`saturacaoDoSync`)
 * e a rota `/api/sync-estado` continuam de pé, com os testes acima e abaixo.
 * Elas são o instrumento de MEDIR a defasagem, e medir continua valendo — o que
 * a decisão mudou foi quem lê o resultado. Hoje a rota ficou sem consumidor de
 * tela; se ela deve morrer também é decisão do backend, dono de `src/app/api`.
 */
test("a faixa de estado do sync NÃO volta para as telas — nos quatro canais", async () => {
  // A asserção olha o fonte SEM COMENTÁRIOS porque as notas que explicam a
  // remoção CITAM `EstadoDoSync` pelo nome — casar o texto cru reprovaria a
  // própria documentação do que foi removido.
  const semComentarios = (codigo) =>
    codigo
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const telas = [
    "../src/app/(app)/monitor/page.tsx",
    "../src/app/components/MercadoLivreWorkspace.tsx",
    "../src/app/components/ShopeeModulePage.tsx",
    "../src/app/components/TikTokModulePage.tsx",
  ];
  for (const arquivo of telas) {
    const codigo = semComentarios(await readFile(new URL(arquivo, import.meta.url), "utf8"));
    assert.ok(!codigo.includes("EstadoDoSync"),
      `${arquivo}: a faixa de sincronização voltou para a tela da vendedora`);
  }
  // E nenhuma tela reescreve o texto por conta própria — remover o componente e
  // recriar a frase à mão seria a mesma faixa com outro nome.
  for (const arquivo of telas) {
    const codigo = semComentarios(await readFile(new URL(arquivo, import.meta.url), "utf8"));
    assert.ok(!/Sincroniza(ç|c)(ã|a)o atrasada|Sincronizado h(á|a)/.test(codigo),
      `${arquivo}: a frase de estado do sync voltou escrita à mão`);
  }
});

test("o componente da faixa não existe mais — remoção inteira, sem código morto", async () => {
  await assert.rejects(
    () => readFile(new URL("../src/app/components/EstadoDoSync.tsx", import.meta.url), "utf8"),
    /ENOENT/,
    "o componente voltou ao disco — sem consumidor, ele é código morto esperando um novo uso",
  );
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.ok(!css.includes(".estado-do-sync"), "o CSS da faixa voltou");
});

test("a rota de estado é escopada por workspace e só aceita canal conhecido", async () => {
  const rota = await readFile(new URL("../src/app/api/sync-estado/route.ts", import.meta.url), "utf8");
  assert.match(rota, /withAuthenticatedWorkspace/);
  assert.match(rota, /workspace_id = \$1/, "a query TEM que filtrar por workspace — cache sem escopo já vazou dado uma vez");
  assert.match(rota, /currentWorkspaceId\(\)/);
  assert.match(rota, /provider in CICLO_ESPERADO_MIN/, "allowlist de canal, não string livre");
  // Só metadado de sync sai daqui — nenhum número de negócio.
  assert.doesNotMatch(rota, /revenue|gross|profit/i);
});

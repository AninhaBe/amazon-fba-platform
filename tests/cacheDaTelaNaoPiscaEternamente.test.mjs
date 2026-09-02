import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * ⚠️ O DEFEITO QUE ISTO REPROVA — relatado pela vendedora em 02/09/2026 como
 * *"a tela fica piscando eternamente"* ao paginar a aba Produtos da Shopee.
 *
 * `useCacheDaTela` devolvia `{ buscar, jaTem, esquecer }` — um objeto NOVO a
 * cada render. As tres funcoes eram estaveis (`useCallback`), mas quem consome
 * guarda o OBJETO:
 *
 *   const buscarModulo = useCallback(..., [cache, cfg.endpoint]);
 *   useEffect(..., [attempt, buscarModulo, query, selectedId]);
 *
 * Objeto novo -> `buscarModulo` novo -> o efeito re-dispara -> `setPayload(null)`
 * apaga a lista e busca de novo -> o estado muda -> re-renderiza -> objeto novo.
 * MEDIDO ANTES DO CONSERTO: 20 disparos em 20 renders. Depois: 1.
 *
 * ⚠️ E ELE NAO APARECE NA ABA NETWORK: o controle de voo dedupe a ida e o cache
 * responde da memoria. O laco e de RENDER, nao de rede — quem procurar
 * requisicao repetida nao acha nada e conclui que esta tudo bem.
 *
 * ⚠️ POR QUE O TESTE COPIA A PECA: nao ha harness de React neste repo. A copia
 * troca SO a linha do import por um stub que segue o CONTRATO dos hooks (ref
 * guarda entre renders; callback/memo devolvem o mesmo valor com as mesmas
 * deps). A guarda contra deriva esta na primeira assercao: se a copia diferir
 * do original em qualquer linha que nao seja import, o teste falha — assim a
 * medicao nao pode envelhecer em silencio.
 */

const STUB = `
type Slot = { current?: unknown; fn?: unknown; valor?: unknown; deps?: unknown[] };
let slots: Record<number, Slot> = {};
let i = 0;
export function novoRender() { i = 0; }
export function novoComponente() { slots = {}; i = 0; }
export function useRef<T>(inicial: T) {
  const k = i++;
  if (!(k in slots)) slots[k] = { current: inicial };
  return slots[k] as { current: T };
}
const mesmas = (a: unknown[] | undefined, b: unknown[]) =>
  !!a && a.length === b.length && a.every((d, n) => Object.is(d, b[n]));
export function useCallback<T>(fn: T, deps: unknown[]): T {
  const k = i++;
  const anterior = slots[k];
  if (anterior && mesmas(anterior.deps, deps)) return anterior.fn as T;
  slots[k] = { fn, deps };
  return fn;
}
export function useMemo<T>(fn: () => T, deps: unknown[]): T {
  const k = i++;
  const anterior = slots[k];
  if (anterior && mesmas(anterior.deps, deps)) return anterior.valor as T;
  const valor = fn();
  slots[k] = { valor, deps };
  return valor;
}
`;

async function carregarCopia() {
  const original = await readFile(new URL("../src/app/components/cacheDaTela.ts", import.meta.url), "utf8");
  const controle = new URL("../src/app/components/controleDeVoo.ts", import.meta.url).href;
  const copia = original
    .replace(/from "react"/, 'from "./reactStub.ts"')
    .replace(/from "\.\/controleDeVoo"/, `from ${JSON.stringify(controle)}`);

  const soImports = original.split("\n").map((linha, n) => [linha, copia.split("\n")[n]])
    .filter(([a, b]) => a !== b)
    .every(([a]) => a.trimStart().startsWith("import "));
  assert.ok(soImports, "a copia da peca diferiu em linha que NAO e import — a medicao envelheceu");

  const dir = await mkdtemp(join(tmpdir(), "nexo-cache-"));
  await writeFile(join(dir, "reactStub.ts"), STUB, "utf8");
  await writeFile(join(dir, "cacheDaTela.ts"), copia, "utf8");
  const stub = await import(pathToFileURL(join(dir, "reactStub.ts")).href);
  const peca = await import(pathToFileURL(join(dir, "cacheDaTela.ts")).href);
  // O nome NAO comeca com "use" de proposito: a regra rules-of-hooks acusa
  // "hook chamado em loop" num teste que chama a peca 20 vezes de proposito.
  // Renomear e mais honesto que desligar a regra com um comentario.
  return { stub, montarCache: peca.useCacheDaTela };
}

test("o cache devolve o MESMO objeto entre renders — nao so as mesmas funcoes", async () => {
  const { stub, montarCache } = await carregarCopia();
  stub.novoComponente();
  stub.novoRender();
  const a = montarCache("shopee:costs");
  stub.novoRender();
  const b = montarCache("shopee:costs");
  assert.ok(Object.is(a.buscar, b.buscar), "as funcoes internas deixaram de ser estaveis");
  assert.ok(
    Object.is(a, b),
    "o cache voltou a devolver um objeto novo a cada render — a tela pisca eternamente",
  );
});

test("e o efeito de busca da tela dispara UMA vez em 20 renders", async () => {
  const { stub, montarCache } = await carregarCopia();
  stub.novoComponente();
  let disparos = 0;
  let anterior = Symbol("primeiro");
  const RENDERS = 20;
  for (let render = 1; render <= RENDERS; render += 1) {
    stub.novoRender();
    const cache = montarCache("shopee:costs");
    // A MESMA forma dos dois consumidores (ShopeeModulePage e TikTokModulePage):
    // `useCallback(..., [cache, cfg.endpoint])`, que entra no array do efeito.
    const buscarModulo = stub.useCallback(() => cache, [cache, "costs"]);
    if (!Object.is(buscarModulo, anterior)) { disparos += 1; anterior = buscarModulo; }
  }
  assert.equal(
    disparos, 1,
    `o efeito de busca disparou ${disparos} vezes em ${RENDERS} renders — cada disparo apaga a lista e busca de novo`,
  );
});

test("os DOIS consumidores tem a mesma forma — a cura vale para os dois canais", async () => {
  // A Shopee foi quem ela usou; o TikTok tem o codigo identico e piscava igual,
  // sem ninguem reportar. O defeito aparece numa tela; a causa mora na peca.
  for (const tela of ["src/app/components/ShopeeModulePage.tsx", "src/app/components/TikTokModulePage.tsx"]) {
    const fonte = await readFile(new URL(`../${tela}`, import.meta.url), "utf8");
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.match(codigo, /\[cache,\s*cfg\.endpoint\]/, `${tela}: o consumidor mudou de forma e esta medicao deixou de cobri-lo`);
  }
});

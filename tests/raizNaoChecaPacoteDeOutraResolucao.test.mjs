import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const raiz = new URL("../", import.meta.url);

/**
 * ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA PRENDEU O DEPLOY (06/09/2026).
 *
 * O `include` do tsconfig da raiz alcanca todo `.ts` da arvore, e o `exclude` so
 * tinha `node_modules`. Quando `packages/nexo-ds/` entrou, o type-check da raiz
 * passou a puxar `packages/nexo-ds/tsup.config.ts`, que importa `tsup` — uma
 * dependencia que existe SO dentro do pacote.
 *
 * Na maquina de quem escreveu o pacote isso passa, porque
 * `packages/nexo-ds/node_modules/tsup` esta la. No Docker nao existe: o
 * `npm ci` roda so na raiz. Medido, escondendo aquele `node_modules`:
 *
 *   packages/nexo-ds/tsup.config.ts(1,30): error TS2307:
 *   Cannot find module 'tsup' or its corresponding type declarations.
 *
 * Producao ficou presa em `54b5e4b` e duas tentativas de deploy bateram na
 * parede antes de alguem reproduzir a diferenca entre as duas maquinas.
 *
 * ⚠️ A REGRA E MAIS GERAL QUE O CASO. Diretorio com `package.json` proprio tem
 * RESOLUCAO DE DEPENDENCIA propria; checa-lo pelo tsconfig da raiz e checar com
 * a resolucao errada, e a resolucao errada e o defeito. Por isso a guarda nao
 * casa a palavra "packages": ela PROCURA os sub-pacotes e exige que cada um
 * esteja coberto. Um pacote novo amanha cai aqui sem ninguem lembrar do teste.
 *
 * ⚠️ E ELA SO OLHA O QUE O GIT VERSIONA, o que tambem foi medido: na primeira
 * execucao ela acusou `.ds-sync/`, uma ferramenta local com `package.json`
 * proprio — e `.ds-sync` esta no `.gitignore`, entao o Docker NUNCA o ve e ele
 * nao pode quebrar deploy nenhum. Guarda que acusa o que nao quebra e como
 * guarda morre: alguem a desliga no dia em que ela atrapalha, e ela nao esta la
 * no dia em que importa. A fronteira certa e o que o git manda para a imagem.
 */

/** Os sub-pacotes que o git VERSIONA — que sao os que chegam ao Docker. */
function subPacotesVersionados() {
  const saida = execFileSync("git", ["ls-files", "*package.json"], {
    cwd: fileURLToPath(raiz),
    encoding: "utf8",
  });
  return saida
    .split(String.fromCharCode(10))
    .map((linha) => linha.trim())
    .filter((linha) => linha.endsWith("/package.json"))
    .map((linha) => linha.slice(0, -"/package.json".length));
}

test("todo sub-pacote versionado fica FORA do type-check da raiz", async () => {
  const bruto = await readFile(new URL("tsconfig.json", raiz), "utf8");
  // ⚠️ NAO DA PARA `JSON.parse` NO TSCONFIG: ele aceita comentario, e o
  // nosso tem. Em vez de escrever meio parser, recorto o unico array que
  // interessa, que e JSON valido sozinho. O `[^/]` antes das aspas impede casar
  // a chave de documentacao `"//exclude"`.
  const achado = bruto.match(/(?:^|[^/])"exclude"\s*:\s*(\[[^\]]*\])/);
  assert.ok(achado, "o tsconfig da raiz perdeu o `exclude` — sem ele, TUDO entra no type-check");
  const excluidos = JSON.parse(achado[1]);

  const pacotes = subPacotesVersionados();
  assert.ok(
    pacotes.length > 0,
    "nenhum sub-pacote versionado encontrado. Ou a arvore mudou de forma, ou o `git ls-files` " +
      "nao rodou — e nos dois casos a guarda passaria VAZIA, provando nada.",
  );

  for (const pacote of pacotes) {
    const coberto = excluidos.some((padrao) => pacote === padrao || pacote.startsWith(`${padrao}/`));
    assert.ok(
      coberto,
      `"${pacote}" tem package.json proprio e NAO esta no exclude do tsconfig da raiz.\n` +
        "  A raiz vai type-checar os arquivos dele com a resolucao DELA, e as dependencias do\n" +
        "  pacote nao existem no Docker (o `npm ci` roda so na raiz). Foi assim que o deploy\n" +
        "  ficou preso em 06/09/2026. Acrescente-o ao `exclude`.",
    );
  }
});

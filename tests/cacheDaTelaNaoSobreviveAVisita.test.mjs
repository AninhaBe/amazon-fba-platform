import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — o caminho que fez a opcao "cache de
// escopo de modulo" ser recusada em 01/09/2026:
//
//   salvar o custo -> sair da tela -> voltar
//
// Nos modulos de Shopee e TikTok a tabela e corrigida por um PATCH EM MEMORIA
// (`custosSalvos`), porque salvar nao recarrega — pedido dela em 29/08/2026. Um
// cache que sobreviva a desmontagem serve o payload ANTERIOR ao salvamento sem
// o patch que o corrige, e a coluna volta a "—": a vendedora conclui que o NEXO
// perdeu o custo que ela acabou de digitar.
//
// A defesa nao e invalidar bem. E o cache ter o MESMO TEMPO DE VIDA do patch,
// para nao existir estado em que as duas metades se separem.

test("o cache dos modulos vive no COMPONENTE, nunca no modulo", async () => {
  const cache = await fonte("src/app/components/cacheDaTela.ts");
  // useRef, e nao um Map de escopo de modulo como Amazon, ML, central e /ads.
  assert.match(cache, /const guardado = useRef<Map<string, T> \| null>\(null\);/);
  assert.match(cache, /const voo = useRef<ReturnType<typeof criaControleDeVoo> \| null>\(null\);/);
  // ⚠️ Nada de `new Map(` no topo do arquivo: seria exatamente o cache que
  // sobrevive a desmontagem.
  const semComentarios = cache.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/^const \w+ = new Map/m.test(semComentarios),
    "voltou um cache de escopo de modulo, que sobrevive ao patch que corrige as linhas",
  );
  // O controle de voo tambem e proprio: o compartilhado sobrevive a
  // desmontagem e entregaria a ida antiga a montagem nova.
  assert.ok(!/controleDoEscopo/.test(semComentarios), "o controle compartilhado reabre a fresta");
});

test("os dois modulos usam A MESMA peca, nao uma parecida", async () => {
  for (const tela of ["src/app/components/ShopeeModulePage.tsx", "src/app/components/TikTokModulePage.tsx"]) {
    const codigo = await fonte(tela);
    assert.match(codigo, /useCacheDaTela<Payload>\(/, `${tela} deixou de usar o cache compartilhado`);
    // A busca do modulo passa pelo cache — nao pode sobrar fetch direto no
    // efeito, que era por onde o payload entrava sem passar por lugar nenhum.
    assert.match(codigo, /cache\.buscar\(chave,async\(\)=>\{/, `${tela}: a busca saiu de dentro do cache`);
    assert.match(codigo, /filaDeFundo:false,/, `${tela}: fila de fundo custa tres idas por sessao`);
    assert.match(codigo, /onIntent=\{aquecerAgora\}/, `${tela}: perdeu a antecipacao`);
  }
});

test("aquecer NAO monta periodo por conta propria", async () => {
  // A conversao de periodo tem UM dono (o filtro). Montar `days`/`from`/`to` na
  // tela criaria a segunda regra de periodo do produto — o defeito que a
  // unificacao do seletor do ABC acabou de tirar do caminho.
  for (const tela of ["src/app/components/ShopeeModulePage.tsx", "src/app/components/TikTokModulePage.tsx"]) {
    const codigo = await fonte(tela);
    const helper = codigo.slice(codigo.indexOf("function comPeriodo("), codigo.indexOf("function comPeriodo(") + 500);
    assert.match(helper, /saida\.set\("days",escolhida\.get\("days"\)\?\?"today"\)/, `${tela}: repassa o que o filtro devolveu`);
    // ⚠️ Recortado no HELPER de proposito. O TikTok ja tinha, ANTES disto, um
    // `syncPeriod` que converte `days` em datas com `setDate` + `toISOString` —
    // conversao de periodo no cliente, com o relogio do navegador. Nao e deste
    // conserto, esta reportado a parte, e casar o arquivo inteiro faria este
    // teste ficar vermelho por um defeito que ele nao reprova.
    assert.ok(!/setDate\(|86_400_000|86400000/.test(helper), `${tela}: o aquecimento voltou a calcular data`);
  }
});

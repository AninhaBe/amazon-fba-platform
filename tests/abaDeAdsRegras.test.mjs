import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PENDENCIA_POR_CANAL, CANAIS_DE_ADS, diaAindaConsolidando } from "../src/lib/adsMultiCanal.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// As tres consequencias que o DADO impoe a esta tela (inventario medido em
// producao em 30/08/2026). Nenhuma e preferencia de design: cada uma existe
// porque o contrario produziria um numero falso.

test("NAO existe total dos quatro canais — nem no payload, nem na tela", async () => {
  // A defesa e ESTRUTURAL: a Amazon tem 19 dias de historico e o ML 3, com o ML
  // gastando 6x mais. Se o campo nao existe na resposta, ninguem o soma por
  // engano daqui a tres meses.
  const rota = await fonte("src/app/api/ads/route.ts");
  const lib = await fonte("src/lib/adsMultiCanal.ts");
  const pagina = await fonte("src/app/ads/page.tsx");
  for (const [nome, arquivo] of [["rota", rota], ["lib", lib], ["pagina", pagina]]) {
    assert.ok(
      !/\bgastoTotal\b|\btotalGeral\b|\btotalDosCanais\b/.test(arquivo),
      `${nome}: total somando canais com janelas diferentes nao pode existir`
    );
  }
  assert.match(pagina, /N[aã]o somamos os quatro num total/, "a tela precisa DIZER por que nao ha total");
});

test("a janela de cada canal fica colada ao numero, nao num rodape", async () => {
  const pagina = await fonte("src/app/ads/page.tsx");
  const cartao = pagina.slice(pagina.indexOf("function CartaoDoCanal"), pagina.indexOf("function OQueOAnuncioDeixou"));
  assert.match(cartao, /ads-canal-valor[\s\S]{0,200}<Janela/, "a janela vem logo depois do valor no cartao");
  const cascata = pagina.slice(pagina.indexOf("function OQueOAnuncioDeixou"), pagina.indexOf("function TabelaDeProdutos"));
  assert.match(cascata, /<Janela canal=\{canal\} \/>/, "a cascata do canal tambem carrega a janela");
});

test("canal sem dado mostra o estado real e o dono da espera — nunca R$ 0,00", async () => {
  const pagina = await fonte("src/app/ads/page.tsx");
  assert.match(pagina, /sem dado/, "a ausencia tem texto proprio");
  // Sem os comentarios: o codigo EXPLICA por que nao escreve R$ 0,00, e a
  // explicacao nao pode reprovar a propria regra que ela documenta.
  const visivel = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/R\$ 0,00/.test(visivel),
    "zero fabricado leria como 'nao gastou', que e outra afirmacao"
  );
  // Shopee espera terceiro; TikTok espera a Ana, e por isso tem link.
  assert.equal(PENDENCIA_POR_CANAL.shopee.dono, "shopee");
  assert.equal(PENDENCIA_POR_CANAL.tiktok_shop.dono, "voce");
  assert.equal(PENDENCIA_POR_CANAL.tiktok_shop.href, "/ads/como-ligar");
  assert.ok(!("amazon" in PENDENCIA_POR_CANAL), "canal com dado nao tem pendencia fixa");
});

test("os quatro canais aparecem SEMPRE, mesmo sem linha no banco", () => {
  assert.deepEqual([...CANAIS_DE_ADS], ["amazon", "mercado_livre", "shopee", "tiktok_shop"]);
});

test("a tela nao se desculpa: nada de 'parcial' nem 'indisponivel'", async () => {
  // AGENTS.md: a pendencia diz O QUE falta, com numero e dono. Adjetivo que se
  // desculpa explica ao vendedor uma coisa que ele ja sabe.
  for (const caminho of ["src/app/ads/page.tsx", "src/app/ads/como-ligar/page.tsx"]) {
    const arquivo = await fonte(caminho);
    const visivel = arquivo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/parcial|incompleto|indispon[ií]vel/i.test(visivel), `${caminho}: adjetivo que se desculpa`);
  }
});

test("o aviso do GMV Max sobrevive ao resumo do guia", async () => {
  // O guia tem 105 linhas e nao cabe na aba; o unico ponto onde um clique errado
  // APAGA campanha em producao nao pode ser o que se perde no resumo.
  const guia = await fonte("src/app/ads/como-ligar/page.tsx");
  assert.match(guia, /GMV Max/);
  assert.match(guia, /encerra as campanhas/i);
  assert.match(guia, /ads-aviso-forte/, "e ele tem hierarquia visual propria");
});

test("'Ads' no menu, porque 'Anuncios' ja e catalogo publicado nos 4 canais", async () => {
  const nav = await fonte("src/app/components/Nav.tsx");
  assert.match(nav, /href: "\/ads", label: "Ads"/);
  // Se alguem renomear para "Anuncios", passam a existir dois itens com o mesmo
  // nome e sentidos diferentes — a pessoa so descobre clicando errado.
  assert.equal((nav.match(/label: "Anúncios"/g) ?? []).length, 4, "os 4 de catalogo continuam sendo 4");
});

test("dia que ainda se move e MARCADO, e a marca some quando ele fecha", () => {
  // COMPORTAMENTO, nao existencia de simbolo: casar /consolidando/ no fonte
  // continuaria verde se alguem apagasse a chamada e deixasse o import.
  //
  // 30/08/2026: o coletor do ML pedia 8 dias e carimbava como 1 — o gasto ficou
  // ate 16,7x maior. Isso foi curado na raiz. O que SOBRA e propriedade da
  // fonte: o dia corrente e o ultimo fechado ainda encolhem enquanto o PADS
  // consolida (R$ 46,78 -> R$ 46,55 entre duas leituras).
  const hoje = new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10);
  const antigo = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);

  // A GRAVACAO manda: `true` marca, `false` nao marca — inclusive hoje.
  assert.equal(diaAindaConsolidando(hoje, true), hoje);
  assert.equal(diaAindaConsolidando(hoje, false), null, "carimbo fechado tira a marca no mesmo dia");
  assert.equal(diaAindaConsolidando(antigo, true), antigo, "dia velho carimbado como aberto continua marcado");

  // `null` e "nao sei", NUNCA `false`: linha gravada antes de 74160d6 nao tem o
  // campo. Dentro da janela que o coletor reescreve, a marca fica; fora dela o
  // carimbo nunca vai chegar e a marca viraria decoracao.
  assert.equal(diaAindaConsolidando(hoje, null), hoje, "sem carimbo e recente: pode mudar, entao marca");
  assert.equal(diaAindaConsolidando(antigo, null), null, "sem carimbo e velho: o carimbo nao vem mais");

  // Sem dado nenhum nao ha o que marcar.
  assert.equal(diaAindaConsolidando(null, null), null);
});

test("a marca de consolidacao nao usa 'parcial' nem promete numero final", async () => {
  const pagina = await fonte("src/app/ads/page.tsx");
  const visivel = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/parcial/i.test(visivel));
  assert.match(visivel, /pode mudar/, "a promessa e honesta: o valor ainda muda");
});

test("o contrato 'uma linha = um dia' esta escrito onde quem soma vai ler", async () => {
  // A premissa que ninguem tinha escrito, e por isso ninguem esbarrou nela.
  const lib = await fonte("src/lib/adsMultiCanal.ts");
  assert.match(lib, /UMA LINHA = UM DIA/);
  assert.match(lib, /16,7/, "com o tamanho medido do erro, nao so a regra");
});

test("linha que cobre mais de um dia NAO e somada — a tela diz o que esta errado", async () => {
  // A defesa estrutural contra o defeito de 16,7x voltar por outro caminho.
  // Antes de existir `janela_em_dias`, a leitura somava linhas achando que
  // somava dias e NAO TINHA COMO SABER. Agora o dado diz, e a tela prefere nao
  // mostrar numero a mostrar numero errado.
  const lib = await fonte("src/lib/adsMultiCanal.ts");
  assert.match(lib, /janela_em_dias/, "a leitura precisa conferir o carimbo da janela");
  assert.match(lib, /estado: "dado-em-recoleta"/);
  assert.match(lib, /if \(acumuladas > 0\) \{[\s\S]{0,1600}gasto: null/, "sem numero enquanto houver linha acumulada");

  const pagina = await fonte("src/app/ads/page.tsx");
  // "sem dado" seria mentira: o dado existe e esta errado, que e outra coisa.
  assert.match(pagina, /recolhendo de novo/);

  // RECUSAR NAO BASTA. Um canal que so diz "nao da para somar" deixa a
  // vendedora sem saber se o problema e dela — o mesmo buraco de
  // "indisponivel", com numero. A frase precisa dizer o que fazer.
  assert.match(lib, /nada a fazer do seu lado/);
  assert.match(lib, /volta sozinho na próxima sincronização/);
});

test("a aba usa o FRAME da casa, e nao uma classe inventada", async () => {
  // DEFEITO ACHADO NA REVISAO (31/08/2026): a pagina abria com
  // <div className="dashboard-shell">, classe que NAO EXISTE no globals.css —
  // inventada aqui e usada so por estas duas paginas. Sem o frame, faltava o
  // `min-width: 0` da raiz e a fileira de canais transbordava para a direita: o
  // quarto card (TikTok) era cortado pela borda, e e justamente o unico com
  // acao ("Ver como ligar"). Conteudo cortado que nao anuncia o corte e pior
  // que conteudo ausente.
  const css = await fonte("src/app/globals.css");
  for (const caminho of ["src/app/ads/page.tsx", "src/app/ads/como-ligar/page.tsx"]) {
    const pagina = await fonte(caminho);
    const jsx = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/className="dashboard-shell"/.test(jsx), `${caminho}: classe de layout inexistente`);
    assert.match(jsx, /<IntegrationDashboardFrame/, `${caminho}: precisa do frame compartilhado`);
    // A variante de sections que carrega o min-width: 0.
    assert.match(jsx, /dashboard-sections channel-dashboard-sections/, `${caminho}: sections sem a guarda de largura`);
  }
  // E a guarda existe mesmo — se alguem tirar do CSS, este teste acusa.
  assert.match(css, /\.channel-dashboard-sections \{ display: flex; min-width: 0;/);
});

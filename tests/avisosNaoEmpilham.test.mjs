import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { progressoQueAparece, sinaisSilenciadosPorAlarme } from "../src/app/components/hierarquiaDeAvisos.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — auditoria de empilhamento, 01/09/2026.
//
// NAO ERA EXCESSO DE INFORMACAO. ERA A MESMA INFORMACAO REPETIDA:
// sinaisDoResultado() devolve ate TRES sinais, e a MESMA lista era passada para
// tres cartoes no ML e quatro na Shopee — ate 9 e 12 marcas "⚠" dizendo tres
// coisas. Repeticao ensina a varrer a faixa sem ler nenhuma.
//
// ⚠️ E POR ISSO O CONSERTO NAO TIRA INFORMACAO: os tres sinais continuam
// visiveis, uma vez cada, com numero e link. O que saiu foi a repeticao. Se
// algum corte fizer um sinal sumir de vez, o corte esta errado — vira o oposto
// do que ela pediu, que e apontar o que falta com numero.

test("CORTE 1 — os sinais aparecem UMA vez por tela, nao um por cartao", async () => {
  for (const tela of [
    // ⚠️ O ML SAIU DESTA LISTA em 07/09/2026 porque o BLOCO saiu: o
    // canvas do Caminho do Dinheiro cortou o corpo antigo do dashboard. A
    // regra continua valendo para os outros canais, e volta a valer para o ML
    // no dia em que ele tiver um bloco que precise dela.
    // (Os sinais seguem VIVOS no Monitor do ML, que o corte nao tocou.)
    // A AMAZON SAIU EM 12/09/2026 PELO MESMO MOTIVO DO ML, e a ordem e dela:
    // "replicar a mesma estrutura do mercado livre na amazon". O bloco que
    // hospedava os sinais — a rosquinha de repasses e a cascata escrita — saiu
    // da tela com a troca pelo PainelV3, e a unica pendencia que a Amazon
    // produzia (custo nao cadastrado) passou a viver no cartao "O que falta
    // para o numero fechar", com numero e link. A garantia nao caiu: mudou de
    // casa, e quem a cobra agora e o ultimo teste deste arquivo.
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    // ⚠️ POR VIEW, nao por arquivo. O ML tem duas telas no mesmo modulo
    // (dashboard e Monitor), e cada uma mostra os sinais UMA vez — o corte
    // proibe repetir a MESMA lista em varios cartoes da MESMA tela, nao
    // mostra-la nas telas que a usam.
    const vezes = (codigo.match(/<SinaisDoResultado sinais=\{sinais\} \/>/g) ?? []).length;
    const limite = tela.includes("MercadoLivreWorkspace") ? 2 : 1;
    assert.ok(vezes <= limite, `${tela}: os sinais voltaram a repetir (${vezes} vezes, limite ${limite})`);
  }
});

test("e NENHUM sinal desapareceu — a lista continua na tela", async () => {
  // A condicao que atravessa os tres cortes. Um corte que zera a lista e pior
  // que o empilhamento.
  // ⚠️ O TIKTOK ENTROU AQUI EM 01/09/2026, e a ausencia dele era um buraco: a
  // rodada de quebras mostrou que APAGAR os sinais do TikTok nao era pego por
  // teste nenhum. A lista cobria tres canais e a regra vale para os quatro —
  // exatamente o defeito que o guard do BriefingLead teve, numa tela de fora.
  for (const tela of [
    // ⚠️ O ML SAIU DESTA LISTA em 07/09/2026 porque o BLOCO saiu: o
    // canvas do Caminho do Dinheiro cortou o corpo antigo do dashboard. A
    // regra continua valendo para os outros canais, e volta a valer para o ML
    // no dia em que ele tiver um bloco que precise dela.
    // A AMAZON SAIU EM 12/09/2026 PELO MESMO MOTIVO DO ML, e a ordem e dela:
    // "replicar a mesma estrutura do mercado livre na amazon". O bloco que
    // hospedava os sinais — a rosquinha de repasses e a cascata escrita — saiu
    // da tela com a troca pelo PainelV3, e a unica pendencia que a Amazon
    // produzia (custo nao cadastrado) passou a viver no cartao "O que falta
    // para o numero fechar", com numero e link. A garantia nao caiu: mudou de
    // casa, e quem a cobra agora e o ultimo teste deste arquivo.
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
    "src/app/components/ShopeeModulePage.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    // ⚠️ O NOME DA VARIAVEL NAO E PARTE DA REGRA: a primeira versao casava
    // `sinais={sinais}` literal e reprovou o ShopeeModulePage, que chama a lista
    // de `sinaisDaTela`. Guarda que so aceita um nome ensina a renomear para
    // fugir dela.
    assert.match(codigo, /<SinaisDoResultado\s+sinais=\{\w+\}\s*\/>/, `${tela}: os sinais sumiram de vez`);
  }
});

test("CORTE 2 — conexao caida cala os sinais, e so onde ela EMPILHA", async () => {
  assert.equal(sinaisSilenciadosPorAlarme(true), true);
  assert.equal(sinaisSilenciadosPorAlarme(false), false, "os sinais voltam quando a conexao volta");

  // Amazon: a faixa de conexao caida convive com o conteudo.
  //
  // ⚠️ O ML SAIU DAQUI em 07/09/2026 porque o BLOCO saiu: os sinais nao
  // estao mais no dashboard do ML (o canvas do Caminho do Dinheiro cortou o
  // corpo antigo, e a fila de alertas responde por eles). Sem os sinais na
  // tela, nao ha o que o alarme cale — a condicao ficou sem sujeito.
  //
  // A REGRA CONTINUA COBRADA na Amazon, e a funcao `sinaisSilenciadosPorAlarme`
  // segue testada acima. Se um dia os sinais voltarem ao dashboard do ML, esta
  // linha volta com eles.
  // NENHUMA TELA TEM MAIS O PAR, e isto esta escrito aqui de proposito: a
  // Amazon foi a ultima e saiu em 12/09/2026, quando o PainelV3 substituiu o
  // bloco que hospedava os sinais (o ML saiu em 07/09 pelo mesmo motivo). Laco
  // vazio nao prova nada — por isso a regra segue cobrada pela FUNCAO, nas duas
  // asercoes acima, que e onde ela mora.
  //
  // O QUE FAZER QUANDO OS SINAIS VOLTAREM A UMA TELA: devolva a linha dela a
  // esta lista no MESMO commit que os devolve. A forma exata que esta guarda
  // cobrava, para copiar:
  //   !sinaisSilenciadosPorAlarme(Boolean(brokenConnection)) && sinais.length > 0
  const telasComSinaisEAlarmeJuntos = [];
  assert.equal(telasComSinaisEAlarmeJuntos.length, 0,
    "se alguma tela voltou a ter os dois, ela precisa da asercao de silenciamento aqui");
});

test("na Shopee e no TikTok a conexao caida e TAKEOVER — nao ha o que calar", async () => {
  // ⚠️ Verificado, nao suposto. Foi um erro do meu inventario inicial dizer que
  // os quatro empilhavam: nestes dois a tela inteira e substituida, entao a
  // supressao seria codigo que nao muda nada.
  for (const tela of ["src/app/components/ShopeeWorkspace.tsx", "src/app/components/TikTokWorkspace.tsx"]) {
    const codigo = semComentarios(await fonte(tela));
    assert.match(codigo, /return[\s\S]{0,220}<ConnectionBroken/, `${tela}: a conexao caida deixou de ser takeover`);
  }
});

test("CORTE 3 — os dois avisos de progresso ja sao mutuamente exclusivos", async () => {
  // Outro erro do inventario, e este vale registrar: `SincronizacaoCompleta` so
  // age com status "complete" e `AvisoDeSyncInterrompido` so com erro de sync.
  // Nao existe estado em que as duas faixas aparecam juntas — nao havia o que
  // cortar, e cortar seria codigo que nao move numero nenhum.
  // ⚠️ A METADE DE CIMA DESTE TESTE SAIU EM 02/09/2026: ela lia
  // `SincronizacaoCompleta`, o aviso do estado NORMAL, que a dona mandou
  // remover ("estamos assumindo que tudo ja esta sincronizado"). Sem ele nao ha
  // duas faixas de progresso para serem mutuamente exclusivas — resta uma.
  // O teste continua valendo para a que ficou.
  const tiktok = semComentarios(await fonte("src/app/components/TikTokWorkspace.tsx"));
  assert.match(tiktok, /\(syncPhase === "retryable_error" \|\| syncPhase === "reauth_required"\) && \(/);
});

test("a peca da hierarquia escolhe UM progresso, e o que nao se resolve sozinho ganha", () => {
  assert.equal(progressoQueAparece(["em-andamento", "interrompido"]), "interrompido");
  assert.equal(progressoQueAparece(["concluido", "em-andamento"]), "em-andamento");
  assert.equal(progressoQueAparece([null, undefined]), null);
});

test("a pendencia de custo da Amazon sobreviveu ao corte dos sinais", async () => {
  // QUAL DEFEITO ESTE TESTE REPROVA: o corte de 12/09/2026 removeu da Amazon o
  // <SinaisDoResultado>, que era quem dizia "N SKUs sem custo cadastrado". Sem
  // outra casa, a tela teria perdido a unica frase que aponta o cadastro que
  // falta — e a regra da casa e que a tela diga O QUE falta, com numero e link.
  //
  // A asercao e na DEFINICAO da pendencia, nao no uso: o nome `pendencias`
  // continuaria no JSX mesmo se a lista passasse a vir de outra fonte, e casar o
  // nome nao prova de onde o valor nasce.
  const codigo = semComentarios(await fonte("src/app/(app)/amazon/page.tsx"));
  assert.ok(
    codigo.includes('items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/produtos" });'),
    "a pendencia de custo precisa continuar nascendo com numero e link",
  );
  // E ela precisa CHEGAR ao cartao do v3 — a lista do painel le `pendencias`.
  assert.ok(
    codigo.includes("...pendencias.map((p) => ({ id: p.href, titulo: p.label,"),
    "o cartao do v3 precisa receber as pendencias da tela",
  );
});

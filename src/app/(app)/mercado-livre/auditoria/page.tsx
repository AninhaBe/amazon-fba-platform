"use client";

import { useEffect, useState } from "react";
import { TableLoading } from "../../../components/LoadingState";
import { EmptyState } from "../../../components/EmptyState";
import { Pagination } from "../../../components/Pagination";
import { SeletorNexo } from "../../../components/SeletorNexo";
import { brDate } from "@/lib/datetime";
import { readJson } from "../../../../lib/readJson";
import { gerarXlsx, type CelulaDaPlanilha } from "@/lib/planilha";

interface PedidoARevisar {
  orderId: string;
  paymentId: string | null;
  esperado: number;
  esperadoVendedor: number;
  esperadoComprador: number;
  cobrado: number;
  diferenca: number;
  freteCheio: number | null;
  shipmentId: string | null;
  transactionAmount: number | null;
  netReceived: number | null;
  paidAt: string | null;
}

interface Auditoria {
  currency: string;
  pedidos: PedidoARevisar[];
  totalACustestar: number;
  comparados: number;
  semReferencia: number;
  parcial: boolean;
  dias: number;
}

const money = (v: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

const POR_PAGINA = 15;

/**
 * Pedidos a revisar — frete cobrado pelo Mercado Pago contra o frete que o
 * shipment do Mercado Livre declara.
 *
 * ⚠️ DELIBERADAMENTE NÃO SE CHAMA "COBRANÇAS INDEVIDAS". O
 * shipment é uma foto e o ML pode reprecificar o frete depois da pesagem;
 * divergência é candidata a revisão, não erro provado. Mostrar os dois números
 * lado a lado e deixar a decisão com a vendedora é o que mantém a tela
 * confiável — uma tela que grita "erro" em toda diferença vira geradora de falso
 * positivo e é ignorada.
 *
 * ⚠️ A TELA MUDOU DE ROUPA, NÃO DE FUNÇÃO (10/09/2026). O
 * período, o "Copiar para contestação", a comparação previsto × cobrado, a lista
 * e a nota de método continuam os mesmos. O que mudou é a linguagem visual, que
 * passou a ser a do dashboard.
 */
export default function AuditoriaPage() {
  const [dados, setDados] = useState<Auditoria | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dias, setDias] = useState(30);
  /* Guarda o aviso momentâneo do botão. O nome vem de quando ele copiava
     texto; hoje marca o download recém-disparado. */
  const [copiado, setCopiado] = useState(false);
  const [pagina, setPagina] = useState(1);
  const totalEsperado = dados?.pedidos.reduce((total, pedido) => total + pedido.esperado, 0) ?? 0;
  const totalCobrado = dados?.pedidos.reduce((total, pedido) => total + pedido.cobrado, 0) ?? 0;
  const maiorTotal = Math.max(totalEsperado, totalCobrado, 1);

  useEffect(() => {
    const controller = new AbortController();
    // `Promise.resolve()` antes do setState: chamar direto no efeito dispara
    // render em cascata (regra react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setCarregando(true);
      setErro(null);
    });
    fetch(`/api/integrations/mercado-livre/auditoria?dias=${dias}`, { cache: "no-store", signal: controller.signal })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error((d as { error?: string }).error || "Não foi possível auditar os fretes.");
        setDados(d as Auditoria);
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setErro(motivo instanceof Error ? motivo.message : "Não foi possível auditar os fretes.");
      })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [dias]);

  /**
   * ⚠️ PLANILHA, NÃO TEXTO PARA COLAR. Até 10/09/2026 este
   * botão copiava um parágrafo para a área de transferência ("Copiar para
   * contestação"). Ela trocou por exportação: *"faz um botão de exportar pra
   * excel, aí a pessoa consegue baixar um excel"*.
   *
   * O texto colado servia para abrir uma reclamação escrevendo à mão. A
   * planilha serve para o que ela realmente faz: conferir linha a linha, somar,
   * filtrar e anexar.
   *
   * ⚠️ E É .xlsx DE VERDADE, NÃO CSV. Minha primeira versão
   * gerava CSV — abre no Excel, os números somam — e ela reprovou na hora:
   * *"baixou em csv, não excel"*. Estava certa: CSV não guarda tipo, largura de
   * coluna nem formato, e quem recebe o arquivo arruma tudo à mão. O gerador
   * está em `src/lib/planilha.ts`, sem biblioteca nova.
   */
  function exportarPlanilha() {
    if (!dados?.pedidos.length) return;
    const hoje = new Date();
    const moeda = (valor: number) => ({ valor, estilo: "dinheiro" as const });

    /* ⚠️ O CABEÇALHO DA PLANILHA CARREGA O RECORTE. Sem período
       e data de geração, o arquivo vira um solto na pasta de downloads em duas
       semanas — "de quando é isso?" é a pergunta que ele tem de responder
       sozinho. */
    const linhas: CelulaDaPlanilha[][] = [
      [{ valor: "Divergências de frete — Mercado Livre", estilo: "titulo" }],
      [{ valor: "Período", estilo: "rotulo" }, `Últimos ${dados.dias} dias`],
      [{ valor: "Gerado em", estilo: "rotulo" }, brDate(hoje.toISOString())],
      [{ valor: "Total a contestar", estilo: "rotulo" }, moeda(dados.totalACustestar)],
      [{ valor: "Pedidos a revisar", estilo: "rotulo" }, dados.pedidos.length],
      [{ valor: "Comparados", estilo: "rotulo" }, dados.comparados],
      /* Vai junto porque LIMITA a leitura: sem esses, a auditoria não cobre o
         período inteiro e o total a contestar não é final. */
      [{ valor: "Sem comparação", estilo: "rotulo" }, dados.semReferencia],
      [],
      [
        "Pedido",
        "Envio",
        "Data do pagamento",
        "Frete previsto",
        "Sua parte",
        "Parte do comprador",
        "Frete cobrado",
        "Diferença",
        "Venda",
      ].map((titulo) => ({ valor: titulo, estilo: "cabecalho" as const })),
    ];
    const linhaDoCabecalho = linhas.length - 1;

    /* A planilha leva TODOS os pedidos, não a página aberta: paginação é
       assunto da tela, e exportar meia lista é o recorte silencioso que ninguém
       percebe até somar errado. */
    for (const pedido of dados.pedidos) {
      linhas.push([
        { valor: pedido.orderId, estilo: "texto" },
        { valor: pedido.shipmentId, estilo: "texto" },
        { valor: pedido.paidAt ? brDate(pedido.paidAt) : null, estilo: "texto" },
        moeda(pedido.esperado),
        moeda(pedido.esperadoVendedor),
        moeda(pedido.esperadoComprador),
        moeda(pedido.cobrado),
        /* ⚠️ A COR DA DIFERENÇA SEGUE A MESMA REGRA DA TELA:
           positivo é cobrança a mais (vermelho), negativo é a favor dela
           (verde). Quem lê a planilha e quem lê a tela precisam chegar à mesma
           conclusão olhando a mesma cor. */
        {
          valor: pedido.diferenca,
          estilo: pedido.diferenca > 0 ? ("dinheiroCobradoAMais" as const) : ("dinheiroAFavor" as const),
        },
        /* Desconhecido fica VAZIO, nunca zero: zero somaria como se a venda
           tivesse valor. É a regra `null ≠ 0` dentro da planilha. */
        pedido.transactionAmount == null ? { valor: null, estilo: "texto" as const } : moeda(pedido.transactionAmount),
      ]);
    }

    const somaPrevisto = dados.pedidos.reduce((t, x) => t + x.esperado, 0);
    const somaCobrado = dados.pedidos.reduce((t, x) => t + x.cobrado, 0);
    const total = (valor: number | null) => ({ valor, estilo: "totalDinheiro" as const });
    linhas.push([]);
    const linhaDoTotal = linhas.length;
    linhas.push([
      { valor: "Total", estilo: "totalTexto" },
      { valor: null, estilo: "totalTexto" },
      { valor: null, estilo: "totalTexto" },
      total(Math.round(somaPrevisto * 100) / 100),
      total(null),
      total(null),
      total(Math.round(somaCobrado * 100) / 100),
      /* ⚠️ O TOTAL DA DIFERENÇA NÃO É A SOMA DA COLUNA, e a linha
         de nota diz isso dentro da planilha. Diferença negativa é cobrança a
         menor, a favor dela, e somá-la abateria o que há para contestar — a
         tela segue a mesma regra. */
      total(dados.totalACustestar),
      total(null),
    ]);
    linhas.push([]);
    linhas.push([{ valor: "A coluna Diferença soma só os valores positivos: negativo é cobrança a menor, a seu favor, e não entra no total a contestar.", estilo: "nota" }]);

    const bytes = gerarXlsx({
      aba: "Pedidos a revisar",
      linhas,
      larguras: [20, 18, 18, 16, 14, 20, 16, 14, 14],
      /* Congela até o cabeçalho: rolando 40 linhas, os nomes das colunas ficam.
         O `+1` é porque o Excel conta a partir de 1. */
      congelarAcimaDe: linhaDoCabecalho + 1,
      /* Filtro do Excel na tabela: é o que permite isolar "só as diferenças
         acima de X" sem sair da planilha. */
      filtro: { linha: linhaDoCabecalho, daColuna: 0, ateColuna: 8, ateLinha: linhaDoTotal - 2 },
      /* Pedido e envio são códigos em texto — sem isto o Excel põe um triângulo
         verde em cada célula, e 17 triângulos parecem 17 erros. */
      colunasDeCodigo: { daColuna: 0, ateColuna: 1, daLinha: linhaDoCabecalho + 1, ateLinha: linhaDoTotal - 2 },
    });

    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pedidos-a-revisar-mercado-livre-${dados.dias}-dias.xlsx`;
    link.click();
    /* Sem o revoke o blob fica na memória da aba até recarregar. */
    URL.revokeObjectURL(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  const paginas = Math.max(1, Math.ceil((dados?.pedidos.length ?? 0) / POR_PAGINA));
  /* Derivado, nunca guardado: trocar o período com a página 3 aberta deixaria o
     estado apontando para uma página que não existe mais. */
  const paginaAtual = Math.min(pagina, paginas);
  const naTela = (dados?.pedidos ?? []).slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  return (
    <div className="v3 audit-page">
      <section className="v3-card v3-faixa">
        <div className="v3-card-cab">
          <h2>Pedidos a revisar</h2>
          <div className="v3-card-cab-dir">
            <SeletorNexo
              valor={String(dias)}
              rotuloAcessivel="Período da auditoria"
              aoEscolher={(valor) => { setDias(Number(valor)); setPagina(1); }}
              opcoes={[
                { valor: "7", rotulo: "Últimos 7 dias" },
                { valor: "30", rotulo: "Últimos 30 dias" },
                { valor: "60", rotulo: "Últimos 60 dias" },
                { valor: "90", rotulo: "Últimos 90 dias" },
              ]}
            />
            {/* Aparece com QUALQUER pedido na lista, não só com diferença
                positiva: a planilha serve para conferir, e as cobranças a menor
                fazem parte da conferência. */}
            {dados && dados.pedidos.length > 0 && (
              <button type="button" className="v3-btn is-primaria" onClick={exportarPlanilha}>
                {copiado ? "Baixado" : "Exportar para Excel"}
              </button>
            )}
          </div>
        </div>

        {dados && (
          /* ⚠️ O TOM SEGUE O RÓTULO, não o valor — regra fixada por
             ela no Radar. "A contestar" é vermelho porque é dinheiro cobrado a
             mais; "Sem comparação" é âmbar porque é falta de dado, não erro. */
          <div className="v3-colunas">
            <div className="v3-coluna is-tom-vermelho">
              <p className="v3-coluna-rotulo">A contestar</p>
              <strong className={`v3-coluna-valor${dados.totalACustestar > 0 ? " is-negativo" : ""}`}>
                {money(dados.totalACustestar, dados.currency)}
              </strong>
              <span className="v3-coluna-share">cobrado a mais no período</span>
            </div>
            <div className="v3-coluna">
              <p className="v3-coluna-rotulo">Pedidos a revisar</p>
              <strong className="v3-coluna-valor">{dados.pedidos.length.toLocaleString("pt-BR")}</strong>
              <span className="v3-coluna-share">casos com divergência</span>
            </div>
            <div className="v3-coluna">
              <p className="v3-coluna-rotulo">Comparados</p>
              <strong className="v3-coluna-valor">{dados.comparados.toLocaleString("pt-BR")}</strong>
              <span className="v3-coluna-share">com referência de envio</span>
            </div>
            {/* ⚠️ "Sem comparação" É FALTA DE DADO E FICA NA TELA:
                são pagamentos cujo envio não veio, e sem eles a auditoria não
                cobre o período inteiro. Esconder faria o "A contestar" parecer
                completo quando não é. */}
            <div className="v3-coluna is-tom-ambar is-ultima">
              <p className="v3-coluna-rotulo">Sem comparação</p>
              <strong className="v3-coluna-valor">{dados.semReferencia.toLocaleString("pt-BR")}</strong>
              <span className="v3-coluna-share">pagamento sem envio conhecido</span>
            </div>
          </div>
        )}

        {dados?.parcial && (
          <p className="v3-nota">
            O período tem mais pagamentos do que foi possível ler de uma vez. Reduza o período para cobrir tudo.
          </p>
        )}
      </section>

      {erro ? (
        <section className="v3-card"><p role="alert" className="v3-nota is-erro">{erro}</p></section>
      ) : carregando ? (
        <TableLoading label="Comparando fretes" />
      ) : !dados ? null : (
        <>
          {dados.pedidos.length > 0 && (
            <section className="v3-card" aria-labelledby="audit-comparison-title">
              <div className="v3-card-cab">
                <h2 id="audit-comparison-title">Previsto versus cobrado</h2>
                <span className="v3-meta">Somente os {dados.pedidos.length} pedidos listados abaixo</span>
              </div>
              {/* Duas barras na mesma escala: a comparação é visual porque a
                  pergunta é "quanto maior", não "quanto exatamente" — o número
                  exato está ao lado e na tabela. */}
              <div className="v3-comparacao">
                <div className="v3-comparacao-linha">
                  <span>Frete previsto</span>
                  <i><b style={{ inlineSize: `${(totalEsperado / maiorTotal) * 100}%` }} /></i>
                  <strong>{money(totalEsperado, dados.currency)}</strong>
                </div>
                <div className={`v3-comparacao-linha${totalCobrado > totalEsperado ? " is-negativo" : ""}`}>
                  <span>Frete cobrado</span>
                  <i><b style={{ inlineSize: `${(totalCobrado / maiorTotal) * 100}%` }} /></i>
                  <strong>{money(totalCobrado, dados.currency)}</strong>
                </div>
              </div>
            </section>
          )}

          <section className="v3-card" aria-labelledby="audit-table-title">
            <div className="v3-card-cab">
              <h2 id="audit-table-title">
                {dados.pedidos.length.toLocaleString("pt-BR")} {dados.pedidos.length === 1 ? "pedido candidato" : "pedidos candidatos"} à revisão
              </h2>
              <span className="v3-meta">de {dados.comparados.toLocaleString("pt-BR")} comparados</span>
            </div>

            {dados.pedidos.length === 0 ? (
              <EmptyState
                title="Nenhuma divergência no período"
                description={`Comparamos ${dados.comparados} pedido(s) e o frete cobrado bateu com o declarado no envio.`}
              />
            ) : (
              <div className="v3-tabela v3-tabela-auditoria">
                <div className="v3-auditoria-cab">
                  <span>Pedido</span>
                  <span>Previsto</span>
                  <span>Cobrado</span>
                  <span>Diferença</span>
                  <span>Venda</span>
                  <span>Data</span>
                </div>
                {naTela.map((p) => (
                  <div className="v3-auditoria-linha" key={p.orderId}>
                    <span className="v3-cel-nome">
                      <span className="v3-margem-titulo v3-cel-codigo">{p.orderId}</span>
                      {p.shipmentId && <span className="v3-cel-sub">envio {p.shipmentId}</span>}
                    </span>
                    {/* O previsto abre a conta: a parte do vendedor e a do
                        comprador. É ela que explica por que comparar só com a
                        sua parte acusaria divergência em todo frete dividido. */}
                    <span className="v3-cel-num v3-cel-duplo">
                      <span>{money(p.esperado, dados.currency)}</span>
                      <span className="v3-cel-sub">
                        você {money(p.esperadoVendedor, dados.currency)} + comprador {money(p.esperadoComprador, dados.currency)}
                      </span>
                    </span>
                    <span className="v3-cel-num">{money(p.cobrado, dados.currency)}</span>
                    {/* Diferença positiva é cobrança a mais (vermelho); negativa
                        é a seu favor (verde) e não entra no total a contestar. */}
                    <span className={`v3-cel-num${p.diferenca > 0 ? " is-negativo" : " is-positivo"}`}>
                      {p.diferenca > 0 ? "+" : ""}{money(p.diferenca, dados.currency)}
                    </span>
                    <span className={`v3-cel-num${p.transactionAmount == null ? " is-vazio" : ""}`}>
                      {p.transactionAmount == null ? "—" : money(p.transactionAmount, dados.currency)}
                    </span>
                    <span className="v3-cel-num">{p.paidAt ? brDate(p.paidAt) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {paginas > 1 && (
            <div className="v3-paginacao">
              <Pagination page={paginaAtual} pageCount={paginas} total={dados.pedidos.length} pageSize={POR_PAGINA} onPage={setPagina} />
            </div>
          )}

          <p className="v3-nota">
            <strong>Previsto</strong> é o frete cheio do envio: a sua parte (<code>senders[].cost</code>)
            mais a do comprador (<code>receiver.cost</code>). O Mercado Livre debita o cheio e credita de
            volta a parte do comprador, então comparar só com a sua parte acusaria divergência em todo
            pedido com frete dividido.
            <strong> Cobrado</strong> vem de <code>charges_details</code> do pagamento no Mercado Pago.
            Diferença negativa significa cobrança a menor, a seu favor — aparece na lista, mas não entra no total a contestar.
          </p>
        </>
      )}
    </div>
  );
}

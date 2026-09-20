"use client";

import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";
import { EtapaDoCaminhoView } from "./EtapaDoCaminhoView";
import { readJson } from "../../lib/readJson";
import { BaseDeData } from "./BaseDeData";
import { Pagination } from "./Pagination";

interface Saldo {
  currency: string;
  retido: number;
  liberadoNaJanela: number;
  liberacoes: { date: string; amount: number; pagamentos: number }[];
  pagamentosLidos: number;
  pagamentosTotais: number;
  parcial: boolean;
}

const money = (v: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

/**
 * Saldo e liberação do Mercado Livre, lido da API do Mercado Pago.
 *
 * Existe pelo mesmo motivo do bloco da Amazon: lucro do período não responde
 * "cadê o dinheiro". O ML retém cada venda até uma data própria — vi um
 * pagamento de 15/08 com liberação só em 13/09 — e sem esta tela isso não
 * aparece em lugar nenhum.
 *
 * Diferença em relação à Amazon: o MP recusa o endpoint de saldo da conta
 * (`mercadopago_account/balance` → 403), então **não afirmamos "disponível
 * agora"**. Mostramos o que dá para provar: o que está retido e quando cai.
 */
export function MercadoLivreSaldo({
  connectionId,
  modo = "resumo",
}: {
  connectionId?: string;
  /**
   * `resumo` — o card compacto do dashboard.
   * `etapa` — a QUARTA etapa da faixa do Caminho do Dinheiro. Mesmo dado,
   * mesma busca, desenhado com a peca das outras tres. Existe como modo, e nao
   * como componente novo, justamente para NAO duplicar a chamada ao saldo.
   * `transacoes` — a aba do monitor, no mesmo formato da Amazon: faixa de
   * números em cima, extrato de liberações embaixo. Mesma busca, mesma fonte;
   * só a apresentação muda, para as duas abas dizerem a mesma coisa do mesmo
   * jeito nos dois canais.
   */
  modo?: "resumo" | "transacoes" | "etapa";
}) {
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [erro, setErro] = useState(false);
  /* ⚠️ AQUI EM CIMA POR CAUSA DO RETORNO CEDO logo abaixo:
     `if (erro || !saldo) return null` roda antes do corpo de `transacoes`, e um
     `useState` la dentro mudaria a ordem dos hooks entre um render e o
     seguinte. */
  const [pagina, setPagina] = useState(1);
  /**
   * ⚠️ O RELOGIO ANCORA NA RESPOSTA, NAO NO RENDER — mesmo padrao
   * de `TikTokWorkspace` e do antigo `EstadoDoSync`. O corpo de `transacoes`
   * chamava `Date.now()` durante o render para contar quantos dias faltam ate
   * cada liberacao, e render que le relogio nao e puro: dois renders do mesmo
   * estado podem produzir telas diferentes, e no servidor e no cliente eles
   * produzem HORAS diferentes — que e hidratacao divergente.
   *
   * Aqui isso e conserto de verdade e nao contorno de regra: "faltam 7 dias" e
   * uma leitura DO MOMENTO EM QUE O DADO CHEGOU, nao do instante em que o React
   * decidiu repintar. Ancorado, o numero para de mudar sozinho no meio de um
   * re-render disparado por outra coisa da tela.
   */
  const [agoraMs, setAgoraMs] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
    fetch(`/api/integrations/mercado-livre/balance${query}`, { cache: "no-store", signal: controller.signal })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        // O par (dado, relogio) nasce junto: contagem de dias feita com um
        // relogio de outro momento e a mesma familia de "duas bases".
        if (ok && d) { setSaldo(d as Saldo); setAgoraMs(Date.now()); } else setErro(true);
      })
      .catch((motivo) => { if (!(motivo instanceof DOMException && motivo.name === "AbortError")) setErro(true); });
    return () => controller.abort();
  }, [connectionId]);

  // Some em silêncio: é um bloco complementar, e um erro aqui não pode roubar a
  // atenção do resto do painel.
  if (erro || !saldo || agoraMs == null) return null;

  const proxima = saldo.liberacoes[0];

  if (modo === "etapa") {
    return (
      <EtapaDoCaminhoView
        rotulo={proxima ? `Cai na conta até ${brDate(proxima.date)}` : "Cai na conta"}
        valor={money(saldo.retido, saldo.currency)}
        /* ⚠️ LEVA PARA O EXTRATO, nao para o dashboard: o valor
           aqui e um resumo, e a pergunta seguinte de quem o le e "quais
           pagamentos, em que datas". `secao=transacoes` e o mesmo parametro que
           `MercadoLivreWorkspaceInterno` interpreta — cravar outro nome abriria
           a aba errada em silencio. */
        acao={
          <a className="v3-btn" href="/mercado-livre/monitor?secao=transacoes">
            Abrir extrato →
          </a>
        }
        contexto={
          <>
            {saldo.pagamentosTotais.toLocaleString("pt-BR")} pagamento(s) retido(s) no Mercado Pago,
            já líquidos de tarifa e frete.
            {/* ⚠️ QUANDO A LEITURA E PARCIAL, o retido REAL e maior que o
                exibido — e a tela diz isso com numero, em vez de deixar a
                vendedora somar um valor que ela nao pode conferir. */}
            {saldo.parcial
              ? ` Lidos ${saldo.pagamentosLidos} de ${saldo.pagamentosTotais} — o retido real é maior.`
              : ""}
          </>
        }
      />
    );
  }

  if (modo === "transacoes") {
    /**
     * ⚠️ UM CARTAO SO, e ela viu por que: *"quando o dinheiro cai
     * e extrato de liberacoes nao seria a mesma coisa?"* (10/09/2026). Era. O
     * cartao de cima resumia em tres linhas exatamente o que a tabela de baixo
     * detalhava — 34 pagamentos, R$ 1.284,60 — e resumo colado no detalhe e a
     * mesma lista dita duas vezes, que a regra da casa proibe.
     *
     * O resumo virou a LINHA DE TOTAL da propria tabela, no mesmo padrao do
     * "Custo do estoque no Full": quem quer o numero fechado le a ultima linha,
     * quem quer a data le as de cima, e os dois numeros nao podem divergir
     * porque saem da mesma tabela.
     *
     * ⚠️ O QUE ISSO CUSTA: "Liberado nas ultimas 24 horas" nao cabe
     * na tabela — ele fala do PASSADO, e a tabela e toda de datas futuras.
     * Virou nota abaixo dela, que e o peso certo: e uma margem tecnica da busca
     * (`agora - 24h`), nao um indicador que alguem acompanha.
     */
    /**
     * ⚠️ TUDO AQUI SAI DE `liberacoes`, nada e inventado. Pedido
     * dela em 10/09/2026: *"tente destrinchar melhor essa tela, tem muita coisa
     * interessante que da pra colocar e que realmente e informativo"*.
     *
     * O criterio do que entrou: a tela do proprio Mercado Pago ja mostra data e
     * valor de cada liberacao — repetir isso e commodity. O que ela NAO mostra e
     * o dinheiro AGRUPADO POR HORIZONTE ("quanto entra nesta semana"), o prazo
     * que o ML esta segurando na pratica, e o peso de cada data no total. Sao
     * essas tres perguntas que a vendedora faz e hoje responde no olho.
     *
     * ⚠️ E TUDO FECHA NA TELA, de proposito: os tres cartoes
     * somam a linha de total, e a coluna "% do retido" soma 100. Numero que nao
     * pode ser conferido na propria tela e numero que ninguem acredita — foi o
     * defeito desta manha, quando o cartao dizia 276 e o extrato, 34.
     */
    /* Meio-dia, nao meia-noite: com "YYYY-MM-DD" puro o fuso empurra a data um
       dia para tras e "cai amanha" vira "cai hoje". */
    const MEIO_DIA = "T12:00:00";
    const agora = agoraMs;
    const diasAte = (data: string) =>
      Math.max(0, Math.ceil((new Date(data + MEIO_DIA).getTime() - agora) / 86_400_000));
    const cent = (v: number) => Math.round(v * 100) / 100;
    const emDias = (d: number) => (d === 0 ? "hoje" : d + (d === 1 ? " dia" : " dias"));

    /* A soma sai das MESMAS linhas que a tabela mostra — nao de `saldo.retido` —
       para o total e as parcelas nunca poderem divergir por arredondamento. */
    const somaRetida = cent(saldo.liberacoes.reduce((total, l) => total + l.amount, 0));
    const naFaixa = (de: number, ate: number) =>
      cent(
        saldo.liberacoes
          .filter((l) => { const d = diasAte(l.date); return d >= de && d <= ate; })
          .reduce((total, l) => total + l.amount, 0),
      );
    const horizontes = [
      { rotulo: "Nos próximos 7 dias", valor: naFaixa(0, 7) },
      { rotulo: "De 8 a 30 dias", valor: naFaixa(8, 30) },
      { rotulo: "Depois de 30 dias", valor: naFaixa(31, Number.MAX_SAFE_INTEGER) },
    ];

    /* Prazo medio PONDERADO PELO VALOR, nao pela contagem de datas: uma data com
       R$ 900 pesa mais que tres com R$ 30. O numero responde "quanto tempo o
       Mercado Livre esta segurando o meu dinheiro", que e o que se usa para
       planejar caixa. */
    const prazoMedio = somaRetida > 0
      ? Math.round(
          saldo.liberacoes.reduce((total, l) => total + diasAte(l.date) * l.amount, 0) / somaRetida,
        )
      : null;
    const primeira = saldo.liberacoes[0];

    const paginas = Math.max(1, Math.ceil(saldo.liberacoes.length / 15));
    /* Derivado, nunca guardado: se a lista encolher entre duas buscas, uma
       pagina guardada em estado apontaria para o vazio. */
    const paginaAtual = Math.min(pagina, paginas);
    const naTela = saldo.liberacoes.slice((paginaAtual - 1) * 15, paginaAtual * 15);

    return (
      <>
        <section className="v3-card" aria-labelledby="ml-transacoes-title">
          <div className="v3-card-cab">
            <h2 id="ml-transacoes-title">Quando o dinheiro cai</h2>
            <span className="v3-meta">Valor líquido: venda menos tarifa menos a sua parte do frete</span>
          </div>
          {saldo.liberacoes.length === 0 ? (
            /* Estado real, nao zero: o Mercado Pago nao esta segurando nada. */
            <p className="v3-nota">Nenhuma venda retida — o Mercado Pago não está segurando nada agora.</p>
          ) : (
            <>
              {/* ⚠️ OS TRES SOMAM A LINHA DE TOTAL da tabela
                  abaixo. E a mesma peca de faixa das outras telas (`v3-colunas`),
                  aqui falando de CAIXA e nao de periodo — esta aba nao tem
                  periodo. */}
              <div className="v3-colunas v3-horizontes">
                {horizontes.map((h) => (
                  <div className="v3-coluna is-tom-verde" key={h.rotulo}>
                    <p className="v3-coluna-rotulo">{h.rotulo}</p>
                    <strong className={`v3-coluna-valor${h.valor === 0 ? " is-vazio" : ""}`}>
                      {money(h.valor, saldo.currency)}
                    </strong>
                  </div>
                ))}
              </div>

              {/* O que a faixa nao diz: quando comeca a entrar, e quanto tempo o
                  Mercado Livre segura na pratica. */}
              <p className="v3-nota">
                {primeira && (
                  <>
                    Primeira entrada em <strong>{brDate(primeira.date)}</strong>
                    {diasAte(primeira.date) === 0 ? " (hoje)" : " (em " + emDias(diasAte(primeira.date)) + ")"}.
                  </>
                )}
                {prazoMedio != null &&
                  " O Mercado Livre está segurando o seu dinheiro por " + emDias(prazoMedio) + ", em média, ponderado pelo valor."}
              </p>

              <div className="v3-tabela v3-tabela-liberacoes">
                <div className="v3-liberacoes-cab">
                  <span>Data de liberação</span>
                  <span>Em</span>
                  <span>Pagamentos</span>
                  <span>Valor líquido</span>
                  <span>% do retido</span>
                </div>
                {naTela.map((l) => (
                  <div className="v3-liberacoes-linha" key={l.date}>
                    <span>{brDate(l.date)}</span>
                    <span className="v3-cel-num">{emDias(diasAte(l.date))}</span>
                    <span className="v3-cel-num">{l.pagamentos.toLocaleString("pt-BR")}</span>
                    <span className="v3-cel-num">{money(l.amount, saldo.currency)}</span>
                    {/* ⚠️ A BARRA E O NUMERO, nao enfeite: ela
                        responde de relance "esta concentrado numa data so?" —
                        pergunta que a coluna em texto so responde somando de
                        cabeca. A largura sai da MESMA divisao que imprime o
                        numero ao lado, entao as duas nao podem discordar. */}
                    <span className="v3-cel-num v3-cel-share">
                      <span>
                        {somaRetida > 0
                          ? ((l.amount / somaRetida) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%"
                          : "—"}
                      </span>
                      {somaRetida > 0 && (
                        <span className="v3-share-pista" aria-hidden>
                          <span className="v3-share-barra" style={{ inlineSize: (l.amount / somaRetida) * 100 + "%" }} />
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                {/* ⚠️ O TOTAL E DA CONTA INTEIRA, nao da pagina.
                    Com 15 datas por pagina o numero nao muda ao virar de pagina —
                    e e isso que se espera de "ainda retido": e o que o Mercado
                    Pago segura, ponto. Se um dia entrar filtro aqui, o rotulo tem
                    de mudar junto, como o do Full faz ao filtrar. */}
                <div className="v3-liberacoes-linha is-total">
                  <span><strong>Ainda retido pelo Mercado Pago</strong></span>
                  <span className="v3-cel-num" />
                  <span className="v3-cel-num"><strong>{saldo.pagamentosLidos.toLocaleString("pt-BR")}</strong></span>
                  <span className="v3-cel-num"><strong>{money(somaRetida, saldo.currency)}</strong></span>
                  {/* ⚠️ A CELULA FICA VAZIA, e nao com "100%".
                      As parcelas sao arredondadas a uma casa e somam 100,1 nesta
                      amostra; escrever 100% convida a conferencia que o proprio
                      arredondamento reprova. O total que importa esta ao lado, em
                      dinheiro, e esse fecha ao centavo. */}
                  <span className="v3-cel-num" />
                </div>
              </div>
            </>
          )}          {/* Margem tecnica da busca (`agora - 24h`), nao "o que caiu no
              periodo": esta aba nao tem periodo. So aparece quando houve algo. */}
          {saldo.liberadoNaJanela > 0 && (
            <p className="v3-nota">{money(saldo.liberadoNaJanela, saldo.currency)} caíram nas últimas 24 horas.</p>
          )}
          {/* ⚠️ A LEITURA PARCIAL E FATO DO DOMINIO: quando o
              Mercado Pago so devolve parte dos pagamentos, o retido REAL e maior
              que o exibido, e esconder isso e deixar a vendedora somar um numero
              que ela nao pode conferir. Vem com os dois numeros, nunca com a
              palavra "parcial" — a regra da casa e dizer O QUE FALTA. */}
          {saldo.parcial && (
            <p className="v3-nota">
              Lidas as {saldo.pagamentosLidos} liberações mais próximas de {saldo.pagamentosTotais} na janela — o retido real é maior que o exibido.
            </p>
          )}
        </section>

        {paginas > 1 && (
          <div className="v3-paginacao">
            <Pagination
              page={paginaAtual}
              pageCount={paginas}
              total={saldo.liberacoes.length}
              pageSize={15}
              onPage={setPagina}
            />
          </div>
        )}
      </>
    );
  }
  return (
    <section className="saldo-panel" aria-labelledby="saldo-ml-title">
      <div>
        <p className="section-kicker">Saldo no Mercado Livre</p>
        <h2 id="saldo-ml-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Quando o dinheiro cai</h2>
        <BaseDeData base="lancamento" prefixo="Liberações" />
      </div>
      <div className="saldo-grid">
        <div className="saldo-card">
          <span>Retido pelo Mercado Pago</span>
          <strong>{money(saldo.retido, saldo.currency)}</strong>
          <small>
            {proxima ? `Primeira liberação em ${brDate(proxima.date)}` : "Nenhuma venda retida"}
            {saldo.parcial && ` · ${saldo.pagamentosLidos} de ${saldo.pagamentosTotais} pagamentos lidos`}
          </small>
        </div>
        <div className="saldo-card">
          <span>Pagamentos a liberar</span>
          <strong>{saldo.pagamentosTotais.toLocaleString("pt-BR")}</strong>
          <small>Já descontadas a tarifa de venda e a sua parte do frete</small>
        </div>
      </div>
      {saldo.liberacoes.length > 0 && (
        <ol className="saldo-liberacoes">
          {saldo.liberacoes.slice(0, 8).map((l) => (
            <li key={l.date}>
              <span>{brDate(l.date)}</span>
              <strong>{money(l.amount, saldo.currency)}</strong>
              <small>{l.pagamentos} {l.pagamentos === 1 ? "pagamento" : "pagamentos"}</small>
            </li>
          ))}
        </ol>
      )}
      <p className="saldo-nota">
        O valor é o <strong>líquido</strong>: venda menos tarifas menos a sua parte do frete — a mesma
        conta do &quot;Total a receber&quot; do Mercado Pago. O frete que o comprador paga não é descontado,
        porque o Mercado Livre debita o valor cheio e credita essa parte de volta.
        {saldo.parcial
          ? ` Lemos as ${saldo.pagamentosLidos} liberações mais próximas de ${saldo.pagamentosTotais} pendentes — o retido real é maior que o exibido.`
          : ""}
      </p>
    </section>
  );
}

import type { ReactNode } from "react";

/**
 * A FAIXA DO RESULTADO — o lucro como protagonista, com a cascata do que o
 * consumiu.
 *
 * ⚠️ ESTA PEÇA NÃO CALCULA NADA. Ela recebe pronto o que a tela já exibia e
 * decide APENAS a apresentação: tamanho, ordem e a barra proporcional. É a
 * restrição literal do pedido — *"sem alteração nenhuma que não seja o
 * design"* —, e o teste que a acompanha compara os números exibidos com os de
 * hoje, com o mesmo payload.
 *
 * ⚠️ E ELA É DO MERCADO LIVRE POR ENQUANTO, de propósito: a dona chamou o
 * redesenho de teste e quer validar num canal antes de mandar replicar. Por
 * isso ela é um componente novo em vez de uma mudança no `FinancialSummaryPanel`
 * — o painel é compartilhado pelos quatro, e mexer nele mudaria os outros três
 * sem ninguém pedir.
 *
 * ⚠️ A CASCATA NÃO INVENTA FATIA. Parcela desconhecida (`null`) fica de fora da
 * barra e da legenda, em vez de virar zero — o `null ≠ 0` aplicado à
 * proporção. Uma barra que soma o que não se sabe mente com a autoridade de um
 * desenho.
 */

export interface ParcelaDaCascata {
  id: string;
  rotulo: string;
  valor: number | null | undefined;
  /** A cor do quadradinho e da fatia. Vem do chamador para não fixar paleta aqui. */
  cor: string;
  /** Fatia clara precisa de contorno para existir sobre o fundo do painel. */
  contorno?: boolean;
}

export function CockpitDoResultado({
  titulo,
  lucro,
  lucroFormatado,
  frase,
  parcelas,
  aoLado,
}: {
  titulo: string;
  /** Só para decidir a cor do número; a formatação vem pronta. */
  lucro: number | null;
  lucroFormatado: string;
  frase: ReactNode;
  parcelas: ParcelaDaCascata[];
  /** O painel que acompanha a faixa (hoje, a rosquinha dos repasses). */
  aoLado?: ReactNode;
}) {
  const conhecidas = parcelas.filter(
    (parte): parte is ParcelaDaCascata & { valor: number } =>
      parte.valor != null && Math.abs(parte.valor) > 0,
  );
  const tom = lucro == null ? "" : lucro > 0 ? " is-positive" : lucro < 0 ? " is-negative" : "";

  return (
    <section className="cockpit-faixa" aria-label={titulo}>
      <div className="cockpit-resultado">
        <p className="cockpit-kicker">{titulo}</p>
        <div className="cockpit-linha">
          <strong className={`cockpit-lucro${tom}`}>{lucroFormatado}</strong>
          <p className="cockpit-frase">{frase}</p>
        </div>

        {/* A barra só existe quando há o que proporcionar. Sem parcela
            conhecida, ela seria uma faixa cinza que não diz nada. */}
        {conhecidas.length > 0 && (
          <>
            <div className="cockpit-cascata" aria-hidden="true">
              {conhecidas.map((parte) => (
                <span
                  key={parte.id}
                  style={{ flexGrow: Math.abs(parte.valor), background: parte.cor, ...(parte.contorno ? { boxShadow: "inset 0 0 0 1px var(--line)" } : {}) }}
                />
              ))}
            </div>
            <ul className="cockpit-legenda">
              {conhecidas.map((parte) => (
                <li key={parte.id}>
                  <span
                    className="cockpit-marca"
                    aria-hidden="true"
                    style={{ background: parte.cor, ...(parte.contorno ? { boxShadow: "inset 0 0 0 1px var(--line)" } : {}) }}
                  />
                  {parte.rotulo}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {aoLado ? <div className="cockpit-ao-lado">{aoLado}</div> : null}
    </section>
  );
}

/**
 * A CONTA ESCRITA — a Direção D da prancheta, aprovada em 03/09/2026.
 *
 * Ela substitui a rosquinha no lado direito da faixa do ML. A rosquinha
 * respondia "qual fatia é grande"; a conta escrita responde "de onde saiu cada
 * real", que é a pergunta que a vendedora faz quando confere o dia contra outra
 * ferramenta. As duas leem a MESMA composição — a mesma chamada de
 * `buildFinancialComposition` que o painel de baixo consome —, então não há
 * como uma discordar da outra.
 *
 * ⚠️ ESTA PEÇA NÃO CALCULA NADA, nem a soma. Ela recebe as linhas prontas e
 * decide só a apresentação. Se ela somasse, a conta da direita poderia fechar
 * enquanto a barra da esquerda não fecha, e nada ficaria vermelho.
 *
 * ⚠️ LINHA COM VALOR DESCONHECIDO NÃO EXISTE AQUI. Quem monta as linhas já
 * omitiu o `null` — escrever "Impostos —" numa conta de subtração convida a
 * pessoa a ler zero, e `null ≠ 0` vale principalmente onde há um sinal de menos
 * ao lado.
 */
export function ContaEscrita({
  titulo,
  receitaRotulo,
  receitaFormatada,
  linhas,
  resultado,
}: {
  titulo: string;
  receitaRotulo: string;
  receitaFormatada: string;
  linhas: Array<{ id: string; rotulo: string; valorFormatado: string; cor: string }>;
  /** A linha destacada do fim. Sem resultado conhecido, ela não aparece. */
  resultado: { rotulo: string; valorFormatado: string; negativo: boolean } | null;
}) {
  return (
    <>
      <p className="cockpit-kicker">{titulo}</p>
      <dl className="conta-escrita">
        <div className="conta-linha is-receita">
          <span className="conta-sinal" aria-hidden="true" />
          <dt>{receitaRotulo}</dt>
          <dd>{receitaFormatada}</dd>
        </div>
        {linhas.map((linha) => (
          <div key={linha.id} className="conta-linha">
            <span className="conta-sinal" style={{ color: linha.cor }} aria-hidden="true">−</span>
            <dt>
              <span className="cockpit-marca" aria-hidden="true" style={{ background: linha.cor }} />
              {linha.rotulo}
            </dt>
            <dd>{linha.valorFormatado}</dd>
          </div>
        ))}
        {resultado ? (
          <div className={`conta-linha is-resultado${resultado.negativo ? " is-negativo" : ""}`}>
            <span className="conta-sinal" aria-hidden="true">=</span>
            <dt>{resultado.rotulo}</dt>
            <dd>{resultado.valorFormatado}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

/**
 * As pendências numa linha só.
 *
 * ⚠️ ELAS SÃO AS MESMAS DE HOJE, com os mesmos textos, links e condições — o
 * que muda é a forma: cartões empilhados à direita viraram chips em fila. A
 * lista continua vindo de quem já a montava, então nenhuma pendência nasce nem
 * some por causa desta peça.
 */
export function LinhaDePendencias({ itens }: {
  itens: Array<{ label: string; href: string; tone?: "pendencia" | "alerta" }>;
}) {
  if (itens.length === 0) return null;
  return (
    <nav className="cockpit-pendencias" aria-label="Pendências">
      <span className="cockpit-kicker">Pendências</span>
      {itens.map((item) => (
        <a
          key={item.label}
          href={item.href}
          className={`cockpit-chip${item.tone === "pendencia" ? " is-acao" : ""}`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

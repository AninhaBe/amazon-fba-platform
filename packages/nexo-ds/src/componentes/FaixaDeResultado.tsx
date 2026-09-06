import type { ReactNode } from "react";

/**
 * FAIXA DE RESULTADO — o lucro como protagonista, com a cascata do que o
 * consumiu. E a peca de topo do dashboard do Mercado Livre.
 *
 * ⚠️ ELA NAO CALCULA NADA. Recebe pronto o que a tela ja exibia e decide so a
 * apresentacao: tamanho, ordem e a proporcao da barra. No app ha guarda
 * proibindo aritmetica de dinheiro aqui, e o motivo e que numero derivado na
 * peca divergiria do produtor sem nada ficar vermelho.
 *
 * ⚠️ A CASCATA OMITE PARCELA DESCONHECIDA em vez de desenha-la como zero. O
 * `null != 0` vale para a proporcao como vale para o numero: uma barra que soma
 * o que ninguem sabe mente com a autoridade de um desenho.
 *
 * ⚠️ NUMERO E FRASE DIVIDEM A LINHA-BASE (dimensao aprovada em 06/09/2026):
 * 28px e 12px, `align-items: baseline`. Com 36 e 16 a linha nao cabia na coluna
 * e o `flex-wrap` os empilhava.
 */
export interface ParcelaDaCascata {
  id: string;
  rotulo: string;
  /** `null`/`undefined` = desconhecido: fica fora da barra e da legenda. */
  valor: number | null | undefined;
  /** A cor vem do chamador para nao fixar paleta na peca. */
  cor: string;
  /** Fatia clara precisa de contorno para existir sobre o fundo. */
  contorno?: boolean;
}

export interface FaixaDeResultadoProps {
  titulo: string;
  /** So decide a cor do numero; a formatacao vem pronta. */
  lucro: number | null;
  lucroFormatado: string;
  frase: ReactNode;
  parcelas: ParcelaDaCascata[];
  /** O painel da direita (no app: a lista de Top produtos). */
  aoLado?: ReactNode;
  /** O que desce para o branco embaixo da legenda (no app: a regua de dias). */
  abaixoDaLegenda?: ReactNode;
}

export function FaixaDeResultado({
  titulo, lucro, lucroFormatado, frase, parcelas, aoLado, abaixoDaLegenda,
}: FaixaDeResultadoProps) {
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

        {/* A barra so existe quando ha o que proporcionar. Sem parcela
            conhecida, ela seria uma faixa cinza que nao diz nada. */}
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
                  <span className="cockpit-marca" aria-hidden="true"
                    style={{ background: parte.cor, ...(parte.contorno ? { boxShadow: "inset 0 0 0 1px var(--line)" } : {}) }} />
                  {parte.rotulo}
                </li>
              ))}
            </ul>
          </>
        )}

        {abaixoDaLegenda}
      </div>

      {aoLado ? <div className="cockpit-ao-lado">{aoLado}</div> : null}
    </section>
  );
}

/**
 * Pendencias numa fila de chips. Elas dizem O QUE falta com numero e destino —
 * nunca "parcial" nem adjetivo que se desculpa.
 */
export function LinhaDePendencias({ itens }: {
  itens: Array<{ label: string; href: string; tone?: "pendencia" | "alerta" }>;
}) {
  if (itens.length === 0) return null;
  return (
    <nav className="cockpit-pendencias" aria-label="Pendências">
      <span className="cockpit-kicker">Pendências</span>
      {itens.map((item) => (
        <a key={item.label} href={item.href}
          className={`cockpit-chip${item.tone === "pendencia" ? " is-acao" : ""}`}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

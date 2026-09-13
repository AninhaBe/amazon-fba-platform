"use client";
import type { ReactNode } from "react";

/**
 * O CARTAO DE UMA ETAPA — peca sozinha, fora de `FaixaDeEtapas.tsx`.
 *
 * ⚠️ MUDOU DE CASA EM 13/09/2026, e o motivo e uma guarda. O
 * cartao nasceu como um dos quatro passos da faixa do "Caminho do Dinheiro" e
 * morava no mesmo arquivo. Essa faixa SAIU das telas de canal, e
 * `cockpitMLSoMudaDesign` proibe cada canal de importar de `FaixaDeEtapas` —
 * proibicao correta, porque e a faixa que nao pode voltar.
 *
 * Quando os Repasses da Amazon passaram a usar este cartao (o mesmo que o saldo
 * do Mercado Livre ja usava), a guarda ficou vermelha: ela casa o NOME DO
 * MODULO, e nao dava para distinguir "importou o cartao" de "remontou a faixa".
 * Afrouxar a guarda seria trocar uma protecao real por conveniencia. Separar a
 * peca devolve precisao aos dois lados: a faixa continua proibida, o cartao
 * continua compartilhado.
 */
export function EtapaDoCaminhoView({ rotulo, valor, contexto, destaque, negativo, acao }: {
  rotulo: string;
  valor: string;
  contexto: ReactNode;
  destaque?: "resultado";
  negativo?: boolean;
  /**
   * ⚠️ OPCIONAL DE PROPOSITO. A peca nasceu como um dos quatro
   * passos de uma faixa, onde botao nenhum fazia sentido — os passos eram
   * leitura, nao destino. Ela ganhou um uso novo (o saldo do Mercado Pago, na
   * metade de baixo do dashboard) onde os vizinhos TEM acao no canto, e sem
   * ela o cartao do saldo era o unico sem saida. Quem nao passar `acao`
   * continua com a peca exatamente como era.
   */
  acao?: ReactNode;
}) {
  return (
    <div className={`etapa${destaque === "resultado" ? " is-resultado" : ""}${negativo ? " is-negativo" : ""}`}>
      {acao ? (
        <div className="etapa-topo">
          <p className="etapa-rotulo">{rotulo}</p>
          {acao}
        </div>
      ) : (
        <p className="etapa-rotulo">{rotulo}</p>
      )}
      {/* `num-display` = Archivo, que so veste numero de 24px para cima. */}
      <p className="etapa-valor num-display">{valor}</p>
      <p className="etapa-contexto">{contexto}</p>
    </div>
  );
}

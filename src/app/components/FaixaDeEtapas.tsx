import type { ReactNode } from "react";

/**
 * A FAIXA DE 4 ETAPAS — o caminho do dinheiro, da venda ao que cai na conta.
 *
 * Desenho aprovado em 06/09/2026 (canvas "Caminho do dinheiro", Main.dc.html).
 * A leitura e uma frase, da esquerda para a direita: voce vendeu X, custou Y,
 * sobrou Z, e cai na conta ate tal dia. Cada etapa e um passo do dinheiro, nao
 * um indicador solto — e por isso elas dividem uma faixa unica, com divisao de
 * 1px, em vez de virarem quatro cartoes.
 *
 * ⚠️ UM SO NUMERO EM VERDE, e e o "Sobrou". Se o faturamento tambem fosse
 * verde, o olho leria dois destaques e a faixa deixaria de ter uma resposta. O
 * verde aqui significa "este e o numero que sobra para voce", nao "este numero
 * e bom" — inclusive quando ele e negativo, e ai ele troca para a tinta de
 * perigo, que continua sendo UM destaque so.
 *
 * ⚠️ ESTA PECA NAO CALCULA NADA. Total, porcentagem e margem chegam prontos —
 * as contas moram em `caminhoDoDinheiro.ts`, onde da para testa-las pelo
 * comportamento, com os dois lados da fronteira do `null`.
 */

export interface EtapaDoCaminho {
  id: string;
  rotulo: string;
  /** Ja formatado. "—" quando desconhecido; a peca nunca inventa zero. */
  valor: string;
  /** A linha de contexto embaixo do numero. */
  contexto: ReactNode;
  /** So a etapa do resultado usa o destaque, e so uma pode usar. */
  destaque?: "resultado";
  /** Resultado negativo troca o verde pela tinta de perigo. */
  negativo?: boolean;
}

export function FaixaDeEtapas({ etapas }: { etapas: EtapaDoCaminho[] }) {
  return (
    <section className="etapas" aria-label="Caminho do dinheiro no período">
      {etapas.map((etapa) => (
        <div
          key={etapa.id}
          className={`etapa${etapa.destaque === "resultado" ? " is-resultado" : ""}${etapa.negativo ? " is-negativo" : ""}`}
        >
          <p className="etapa-rotulo">{etapa.rotulo}</p>
          {/* `num-display` = Archivo, que so veste numero de 24px para cima. */}
          <p className="etapa-valor num-display">{etapa.valor}</p>
          <p className="etapa-contexto">{etapa.contexto}</p>
        </div>
      ))}
    </section>
  );
}

/**
 * OS ALERTAS — o que exige acao dela, com numero e destino.
 *
 * ⚠️ ELES NAO SAO "AVISOS DE ESTADO". Cada um aponta uma coisa que ela pode
 * resolver e diz onde: *"5 produtos sem custo cadastrado -> Cadastrar custos"*.
 * Nada de "parcial", "incompleto" ou adjetivo que se desculpa — a regra da casa
 * e dizer O QUE falta, com numero e link, e o canvas a segue a letra.
 *
 * Lista vazia nao desenha nada: estado normal nao e noticia.
 */
export interface AlertaDoCaminho {
  id: string;
  titulo: string;
  detalhe: string;
  acao: string;
  href: string;
  tom?: "acao" | "atencao";
}

export function AlertasDoCaminho({ alertas }: { alertas: AlertaDoCaminho[] }) {
  if (alertas.length === 0) return null;
  return (
    <section className="alertas" aria-label="O que precisa de você">
      {alertas.map((alerta) => (
        <article key={alerta.id} className={`alerta${alerta.tom === "atencao" ? " is-atencao" : ""}`}>
          <div>
            <p className="alerta-titulo">{alerta.titulo}</p>
            <p className="alerta-detalhe">{alerta.detalhe}</p>
          </div>
          <a className="alerta-acao" href={alerta.href}>{alerta.acao} <span aria-hidden="true">→</span></a>
        </article>
      ))}
    </section>
  );
}

import { EtapaDoCaminhoView } from "./EtapaDoCaminhoView";
import type { CSSProperties, ReactNode } from "react";

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

/**
 * Uma etapa. Exportada porque a QUARTA nao vem do mesmo lugar que as tres
 * primeiras: o saldo do Mercado Pago tem busca propria, e quem o desenha e o
 * componente que ja o busca.
 *
 * ⚠️ A MARCACAO MORA AQUI, num lugar so. Se cada dono desenhasse a sua etapa,
 * a quarta divergiria das outras na primeira vez que alguem mexesse numa —
 * e ninguem veria, porque elas nascem em arquivos diferentes.
 */
export function FaixaDeEtapas({ etapas, children }: {
  etapas: EtapaDoCaminho[];
  /**
   * A quarta etapa, quando ela vem de outra fonte. Entra como filho para o
   * dono do dado continuar dono da busca — mover o fetch para ca seria trocar
   * arquitetura numa frente de layout.
   *
   * ⚠️ E ELA PODE NAO VIR: sem saldo conhecido, a faixa fecha com tres. E o
   * mesmo desenho da Amazon — ausencia e ausencia, nao "R$ 0,00" nem um
   * "proximo repasse ~dia X" estimado por nos.
   */
  children?: ReactNode;
}) {
  return (
    <section
      className="etapas"
      aria-label="Caminho do dinheiro no período"
      /* ⚠️ A GRADE SEGUE A CONTAGEM. Com `repeat(4, …)` fixo e tres
         etapas, a quarta celula fica vazia e a faixa parece quebrada em vez de
         parecer curta. */
      style={{ "--etapas": etapas.length + (children ? 1 : 0) } as CSSProperties}
    >
      {etapas.map((etapa) => (
        <EtapaDoCaminhoView
          key={etapa.id}
          rotulo={etapa.rotulo}
          valor={etapa.valor}
          contexto={etapa.contexto}
          destaque={etapa.destaque}
          negativo={etapa.negativo}
        />
      ))}
      {children}
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

"use client";

import { useState } from "react";
import { PainelCanal } from "./VitrineAnimada";
import { MostraSaldo, MostraAuditoria } from "./Mostruario";

/**
 * A vitrine do hero com abas — o elemento de assinatura do dub.co: três pills
 * flutuando sobre a janela do app, cada uma trocando a tela E a animação.
 *
 * O remonte é o truque: a tela ativa recebe `key={aba}`, então trocar de aba
 * desmonta e remonta o componente, e o `useEffect` de cada animação recomeça do
 * zero. Sem isso a pessoa clicaria e cairia no meio de um ciclo já rodando.
 *
 * As três telas são as três seções profundas da página. A aba é atalho e
 * demonstração ao mesmo tempo: quem clica vê a tela, quem rola encontra a
 * explicação. Nenhuma é mock inventado — todas são a UI real com os números de
 * 16/08/2026 (ver `Mostruario.tsx`).
 */

const ABAS = [
  {
    id: "financeiro",
    rotulo: "Financeiro",
    legenda: "Ele fecha a conta de cada canal",
    descricao:
      "Faturamento, tarifa, custo e lucro — com o que ainda não fechou marcado como pendente, nunca como zero.",
    tela: () => <PainelCanal />,
  },
  {
    id: "saldo",
    rotulo: "Saldo",
    legenda: "Ele acompanha quando o dinheiro cai",
    descricao:
      "O que está retido, o que já liberou e a data de cada liberação — inclusive a cobrança que ainda vai chegar.",
    tela: () => <MostraSaldo />,
  },
  {
    id: "auditoria",
    rotulo: "Auditoria",
    legenda: "Ele confere o frete, pedido a pedido",
    descricao:
      "O frete que o marketplace cobrou contra o que o envio declara. Só entra na lista quando as duas pontas não fecham.",
    tela: () => <MostraAuditoria />,
  },
] as const;

export function Vitrine() {
  const [ativa, setAtiva] = useState<(typeof ABAS)[number]["id"]>("financeiro");
  const aba = ABAS.find((a) => a.id === ativa) ?? ABAS[0];

  return (
    <>
      <div className="lp-vitrine-abas" role="tablist" aria-label="Telas do NEXO">
        {ABAS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`aba-${item.id}`}
            aria-selected={item.id === ativa}
            aria-controls="vitrine-painel"
            className={item.id === ativa ? "is-ativa" : ""}
            onClick={() => setAtiva(item.id)}
          >
            <span className={`lp-aba-ponto is-${item.id}`} aria-hidden="true" />
            {item.rotulo}
          </button>
        ))}
      </div>

      <figure
        className="lp-vitrine"
        id="vitrine-painel"
        role="tabpanel"
        aria-labelledby={`aba-${aba.id}`}
      >
        {/* `key` remonta a tela: cada aba recomeça a própria animação. */}
        <div key={aba.id} className="lp-vitrine-tela">
          {aba.tela()}
        </div>

        <figcaption className="lp-legenda">
          <span className="lp-legenda-icone">◆</span>
          <span>
            <strong>{aba.legenda}</strong>
            <em>{aba.descricao}</em>
          </span>
        </figcaption>
      </figure>
    </>
  );
}

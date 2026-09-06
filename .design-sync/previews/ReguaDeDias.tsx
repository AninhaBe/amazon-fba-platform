import { ReguaDeDias } from "@nexo/ds";

// Régua dos últimos 7 dias. As três regras que valem ver: zero é FATO e a
// coluna encosta no chão; desconhecido NÃO desenha coluna; hoje é o destaque.
// O wrapper .cockpit-faixa é o contexto real da régua no app: as variáveis
// --ml-verde e --ml-coluna (cores das barras) só existem dentro dele.
export function UltimosSete() {
  return (
    <div className="cockpit-faixa" style={{ border: 0 }}>
    <ReguaDeDias
      titulo="Lucro por dia — últimos 7"
      dias={[
        { id: "1", rotulo: "seg", valor: 700, compacto: "700", completo: "01/09: R$ 700,00", destaque: false },
        { id: "2", rotulo: "ter", valor: 1000, compacto: "1.000", completo: "02/09: R$ 1.000,00", destaque: false },
        { id: "3", rotulo: "qua", valor: 900, compacto: "900", completo: "03/09: R$ 900,00", destaque: false },
        { id: "4", rotulo: "qui", valor: 0, compacto: "0", completo: "04/09: R$ 0,00", destaque: false },
        { id: "5", rotulo: "sex", valor: null, compacto: "—", completo: "05/09: lucro ainda desconhecido", destaque: false },
        { id: "6", rotulo: "sáb", valor: -140, compacto: "-140", completo: "06/09: prejuízo de R$ 140,00", destaque: false },
        { id: "7", rotulo: "hoje", valor: 240, compacto: "240", completo: "07/09: R$ 240,00", destaque: true },
      ]}
    />
    </div>
  );
}

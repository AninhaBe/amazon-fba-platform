import { ChipDeMargem } from "@nexo/ds";

// Os estados da regra da casa, incluindo os dois lados da fronteira de 12%
// (verde >15, âmbar 12–15, vermelho <12) e o desconhecido, que é traço.
//
// O wrapper .cockpit-faixa é o contexto real do chip no app: é nele que a
// variável --ml-verde (o verde do estado positivo) está definida — fora dele o
// chip positivo renderiza sem cor, no app e aqui. Achado registrado em NOTES.
function Contexto({ children }: { children: React.ReactNode }) {
  return <div className="cockpit-faixa" style={{ border: 0, padding: 8 }}>{children}</div>;
}

export function Saudavel() {
  return <Contexto><ChipDeMargem margemPct={30} /></Contexto>;
}

export function NaFaixaDeAtencao() {
  return <Contexto><ChipDeMargem margemPct={13.6} /></Contexto>;
}

export function AbaixoDaFronteira() {
  return <Contexto><ChipDeMargem margemPct={11.9} /></Contexto>;
}

export function Prejuizo() {
  return <Contexto><ChipDeMargem margemPct={-5.5} /></Contexto>;
}

export function Desconhecida() {
  return <Contexto><ChipDeMargem margemPct={null} /></Contexto>;
}

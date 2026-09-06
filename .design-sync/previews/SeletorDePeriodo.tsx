import { SeletorDePeriodo } from "@nexo/ds";

const OPCOES = [
  { value: "today", label: "Hoje" },
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
];

export function HojeSelecionado() {
  return <SeletorDePeriodo opcoes={OPCOES} selecionado="today" onSelecionar={() => {}} />;
}

export function TrintaDiasSelecionado() {
  return <SeletorDePeriodo opcoes={OPCOES} selecionado="30" onSelecionar={() => {}} />;
}

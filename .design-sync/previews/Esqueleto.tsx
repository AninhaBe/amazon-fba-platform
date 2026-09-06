import { Esqueleto } from "@nexo/ds";

// Carregando é esqueleto, nunca spinner.
export function Carregando() {
  return <Esqueleto label="Carregando dados de exemplo" />;
}

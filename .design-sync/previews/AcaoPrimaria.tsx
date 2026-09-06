import { AcaoPrimaria } from "@nexo/ds";

// O botão diz o que acontece.
export function ComoBotao() {
  return <AcaoPrimaria onClick={() => {}}>Cadastrar custos</AcaoPrimaria>;
}

export function ComoLink() {
  return <AcaoPrimaria href="#">Ver detalhes</AcaoPrimaria>;
}

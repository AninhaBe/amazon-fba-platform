import { AvisoDeCobertura } from "@nexo/ds";

// O aviso legítimo de cobertura: só existe quando os números NÃO cobrem o
// período pedido — é o que separa "não vendeu" de "ainda não importei".
export function ImportacaoEmCurso() {
  return <AvisoDeCobertura cobreDesde="12/08/2026" progresso={64} emImportacao pedidosImportados="1.240" />;
}

export function HistoricoComecaAi() {
  return <AvisoDeCobertura cobreDesde="28/06/2026" />;
}

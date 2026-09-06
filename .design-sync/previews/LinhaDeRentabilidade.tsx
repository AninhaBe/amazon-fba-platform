import { ChipDeMargem, LinhaDeRentabilidade } from "@nexo/ds";

// Linha da tabela de rentabilidade. O caso pendente é a regra da casa:
// repasse não postado é traço, nada vira zero.
export function VendaCompleta() {
  return (
    <LinhaDeRentabilidade
      produto="Produto de exemplo A"
      sku="EXEMPLO-001"
      pedidoId="2000000000000001"
      data="06/09/2026"
      logistica="Full"
      status="Pago"
      quantidade="3 unidades × R$ 40,00"
      venda="R$ 120,00"
      custos="R$ 94,00"
      margem={<ChipDeMargem margemPct={21.6} />}
    />
  );
}

export function AguardandoRepasse() {
  return (
    <LinhaDeRentabilidade
      produto="Produto de exemplo B"
      pedidoId="2000000000000002"
      data="06/09/2026"
      status="Aguardando repasse"
      statusPendente
      quantidade="1 unidade"
      venda="—"
      custos="—"
      margem={<ChipDeMargem margemPct={null} />}
    />
  );
}

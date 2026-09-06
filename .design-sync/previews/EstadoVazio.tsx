import { AcaoPrimaria, EstadoVazio } from "@nexo/ds";

// Tela sem dado mostra o estado REAL — convite para agir, nunca zeros que
// pareçam "não vendeu nada".
export function SemConexao() {
  return (
    <EstadoVazio
      kind="sem-conexao"
      title="Conecte sua conta do Mercado Livre"
      description="Autorize o NEXO para começar a importar anúncios e pedidos."
      action={<AcaoPrimaria href="#">Gerenciar integração</AcaoPrimaria>}
    />
  );
}

export function SemResultado() {
  return (
    <EstadoVazio
      kind="sem-resultado"
      title="Nenhum pedido neste período"
      description="Ajuste o período ou confira outro canal."
    />
  );
}

export function Erro() {
  return (
    <EstadoVazio
      kind="erro"
      title="Não foi possível carregar"
      description="Tente novamente; se persistir, verifique a conexão da conta."
      action={<AcaoPrimaria onClick={() => {}}>Tentar novamente</AcaoPrimaria>}
    />
  );
}

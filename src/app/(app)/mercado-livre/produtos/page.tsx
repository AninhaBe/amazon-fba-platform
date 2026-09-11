import { redirect } from "next/navigation";

/**
 * ⚠️ ESTA TELA FOI ABSORVIDA PELA DE ANÚNCIOS (decisão dela,
 * 10/09/2026): *"acho que ficou redundante com a última tela, vamos só usar a
 * última tela e só adicionamos a feature de cadastrar custo"*. Das cinco colunas
 * daqui, quatro já existiam lá.
 *
 * ⚠️ O ARQUIVO NÃO FOI APAGADO, e isso é deliberado. Onze
 * lugares do produto apontavam para `/mercado-livre/produtos` — menu, curva ABC,
 * calculadora, insights, o bloco do Full, a central de configurações — e links
 * salvos pela vendedora apontam para cá também. Apagar a rota transformaria
 * todos em 404; os do código foram atualizados, e este redirecionamento segura
 * os de fora.
 *
 * A âncora da alíquota (`#mercado-livre-aliquota`) mudou de tela mas não de
 * nome. `redirect` não repassa fragmento — o navegador não o envia ao servidor —,
 * então quem chegar por um link antigo com âncora cai na tela certa, no topo. O
 * "Cadastrar alíquota →" do monitor aponta direto para o destino novo.
 */
export default function ProdutosRedirecionados() {
  redirect("/mercado-livre/anuncios");
}

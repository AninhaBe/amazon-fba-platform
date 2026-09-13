import { redirect } from "next/navigation";

/**
 * O catálogo e o custo por SKU da Amazon moram em Anúncios. A rota antiga
 * continua válida para favoritos e links já publicados, como no Mercado Livre.
 */
export default function ProdutosAmazonRedirect() {
  redirect("/amazon/anuncios");
}

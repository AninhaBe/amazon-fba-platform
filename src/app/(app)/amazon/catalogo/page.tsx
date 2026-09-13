import { redirect } from "next/navigation";

/** A rota antiga permanece como atalho; o catálogo Amazon agora vive em Anúncios. */
export default function CatalogoAmazonRedirect() {
  redirect("/amazon/anuncios");
}

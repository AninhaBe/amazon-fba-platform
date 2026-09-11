import { MercadoLivreWorkspace } from "../../../components/MercadoLivreWorkspace";

/**
 * Bancada do RADAR DE ESTOQUE — `/mercado-livre/bancada-estoque`.
 *
 * Monta a tela real, pelos motivos inteiros em `../bancada/page.tsx`: a amostra
 * chegava por um `window.fetch` trocado que nunca desinstalava e que respondia
 * `POST /api/costs` com sucesso sem gravar.
 */
export default function BancadaDoRadarDeEstoque() {
  return <MercadoLivreWorkspace view="estoque" />;
}

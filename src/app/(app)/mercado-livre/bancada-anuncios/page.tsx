import Anuncios from "../anuncios/page";

/**
 * Bancada dos ANÚNCIOS — `/mercado-livre/bancada-anuncios`.
 *
 * ⚠️ O `import "../bancadaAmostra"` SAIU DAQUI, e era ele o
 * mecanismo inteiro: importado só pelo efeito colateral, trocava o
 * `window.fetch` da aba. Os motivos completos estão em `../bancada/page.tsx`.
 *
 * A tela continua sendo montada exatamente como em produção — agora com o
 * produtor real, que é o que "funcional" quer dizer nesta leva.
 */
export default function BancadaDosAnuncios() {
  return <Anuncios />;
}

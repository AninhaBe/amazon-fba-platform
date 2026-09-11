import { MercadoLivreWorkspace } from "../../../components/MercadoLivreWorkspace";

/**
 * Bancada do DASHBOARD do Mercado Livre — `/mercado-livre/bancada`.
 *
 * ⚠️ A AMOSTRA MORREU, E COM ELA O DEFEITO QUE ELA CARREGAVA
 * (11/09/2026, ordem da dona do produto: *bancada que sobe a produção tem de
 * ser funcional*). Esta tela montava `Dashboard` com dado fixo, e o dado
 * chegava por um `window.fetch` trocado no import de `bancadaAmostra`.
 *
 * O que esse intercepto fazia, medido no fonte antes de sair:
 *
 *   1. **nunca desinstalava.** Navegação dentro do app é client-side, então o
 *      `window` sobrevive: quem abrisse uma bancada e navegasse para
 *      `/mercado-livre/anuncios` seguia com o fetch trocado pelo resto da
 *      sessão — tela REAL respondida com amostra, com cara de dado dela;
 *   2. **engolia `POST /api/costs` com `{ ok: true }`.** A vendedora cadastrava
 *      custo, o botão saía de "Salvando…", a tela dizia que deu certo e nada
 *      era gravado. Declaração falsa na tela, no único dado que só ela sabe
 *      cadastrar;
 *   3. instalava no import do módulo, não num efeito — bastava o chunk da rota
 *      carregar.
 *
 * ⚠️ POR QUE ALIAS E NÃO "GUARDA DE NODE_ENV". A defesa por
 * ambiente foi considerada (é o padrão de `/lab` em `proxy.ts`) e é mais fraca
 * do que não existir: guarda protege um mecanismo que continua escrito. Com a
 * bancada montando o produtor real, não há intercepto para guardar — o que não
 * existe não vaza para a tela real nem precisa ser lembrado.
 *
 * O critério de "funcional" é o mesmo do resto da leva: **mesmos produtores da
 * tela real, mesmos valores**. Por isso esta rota é a `/mercado-livre` inteira,
 * e não uma cópia dela: cópia diverge no primeiro ajuste e passa a aprovar um
 * desenho que o produto não tem.
 *
 * Para julgar o desenho SEM sessão e sem banco, o lugar é `/lab/mercado-livre`,
 * que tem dado fixo próprio e não é servida em produção (`isLab` em
 * `src/lib/supabase/proxy.ts`).
 */
export default function BancadaDoDashboard() {
  return <MercadoLivreWorkspace view="dashboard" />;
}

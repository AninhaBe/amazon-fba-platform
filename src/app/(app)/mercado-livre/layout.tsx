/**
 * A identidade nova do NEXO, ESCOPADA AO MERCADO LIVRE.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE (11/09/2026). O redesign v3 foi
 * desenhado sobre um fundo cinza quente, e esse fundo chegou como troca do token
 * global `--canvas` — ou seja, mudava a cara de Amazon, Shopee, TikTok e da
 * central junto. A ordem da dona do produto é *"somente mercado livre"*, dita
 * duas vezes, então o token voltou ao valor de produção e o cinza passou a
 * morar AQUI, onde alcança só as telas deste canal.
 *
 * ⚠️ O FUNDO NÃO É DECORAÇÃO: os cartões do v3 são brancos com traço
 * de 1px. Sobre o `--paper` (#fdfdfd) do resto do app eles praticamente
 * desaparecem — a tela lê chapada, que foi o defeito que o cinza corrigiu.
 *
 * ⚠️ E É UM WRAPPER, NÃO UM TOKEN REDEFINIDO. Redefinir `--canvas`
 * dentro de uma classe não pintaria o fundo: quem pinta a página é o `body`, que
 * está ACIMA deste nó na árvore. Um token escopado aqui mudaria só quem o lê
 * abaixo — e daria a impressão de funcionar nas telas que pintam o próprio
 * fundo, falhando nas outras. Pintar o container é o que realmente alcança a
 * área de conteúdo do canal.
 *
 * Morte deste arquivo: quando a identidade for aprovada canal por canal, o
 * fundo volta para o token global e este layout sai.
 */
export default function MercadoLivreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="ml-identidade">{children}</div>;
}

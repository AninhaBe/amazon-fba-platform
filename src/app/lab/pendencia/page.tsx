"use client";

/**
 * Bancada das variantes da pendência no cartão — `/lab/pendencia`.
 *
 * ⚠️ EXISTE PORQUE PRINT EM DISCO NAO E OPCAO PARA ESCOLHER.
 * Eu tinha capturado as tres variantes trocando o CSS ao vivo NO NAVEGADOR DELA
 * e mandado os caminhos dos arquivos — ela respondeu *"onde estao essas opcoes?
 * nao tem nada aberto aqui"*, com razao. Comparacao visual precisa estar na
 * tela, lado a lado, ao mesmo tempo.
 *
 * ⚠️ E MEXER NA ABA DELA PARA TESTAR TEM CUSTO. Ela viu o
 * cartao desalinhado no meio de um experimento meu e perguntou "????". Bancada
 * em rota propria nao invade a tela que ela esta olhando.
 */

const VARIANTES = [
  {
    id: "azul",
    nome: "A · Pastilha azul",
    resumo: "Como está no ar. Azul é a cor de ação da tela (botões).",
  },
  {
    id: "ambar",
    nome: "B · Pastilha âmbar",
    resumo: "Mesma forma, no matiz do próprio cartão.",
  },
  {
    id: "texto",
    nome: "C · Só texto âmbar",
    resumo: "Sem pastilha. Sublinha só no hover.",
  },
];

export default function BancadaDaPendencia() {
  return (
    <div className="v3 menu-variantes">
      <header className="menu-variantes-cab">
        <h1>Pendência no cartão do Full</h1>
        <p>
          O mesmo cartão, três tratamentos para o “2 sem custo”. Passe o mouse em cada um: os três
          são clicáveis e levam para Produtos.
        </p>
      </header>

      <div className="menu-variantes-grade">
        {VARIANTES.map((v) => (
          <div className="menu-variante-col" key={v.id}>
            <div className="menu-variante-rotulo">
              <strong>{v.nome}</strong>
              <span>{v.resumo}</span>
            </div>
            <div className="v3-colunas" style={{ gridTemplateColumns: "198px" }}>
              <div className="v3-coluna is-tom-ambar">
                <p className="v3-coluna-rotulo">Valor em estoque no Full</p>
                <strong className="v3-coluna-valor">R$ 1.881,22</strong>
                <span className="v3-coluna-share">
                  <a href="/mercado-livre/anuncios" className={`full-pendencia-link is-${v.id}`}>
                    2 sem custo
                  </a>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

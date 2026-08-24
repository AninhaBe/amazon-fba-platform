/**
 * A seção de prova: cada bloco é um número medido, não um adjetivo.
 *
 * Existe porque o resto da landing já diz o que o NEXO faz, e "ele entende"
 * é exatamente a frase que todo concorrente também escreve. O que nenhum deles
 * escreve é o número que mostra a diferença — então é o número que fica.
 *
 * ## As três regras desta seção
 *
 * 1. **Todo par de números aqui foi medido em produção**, com data. Nenhum é
 *    ilustrativo, nenhum é arredondado para ficar bonito. Se um deles mudar, o
 *    certo é atualizar aqui, não deixar envelhecer — número em landing é
 *    promessa (AGENTS.md).
 * 2. **Nenhum bloco promete o que não roda hoje.** Chat sobre a operação,
 *    alerta proativo e recomendação seguem em docs/ai-agent-harness.md como
 *    backlog; nada disso aparece aqui.
 * 3. **O argumento é sempre a omissão do outro**, não a esperteza nossa. É por
 *    isso que os pares são "o que o painel mostra" contra "o que é" — a coluna
 *    da esquerda é o marketplace falando, e ela não é caricatura: são os
 *    valores que o Seller Central realmente exibiu.
 */

interface Prova {
  id: string;
  kicker: string;
  titulo: string;
  /** [rótulo, valor] do que o marketplace mostra. */
  deles: [string, string];
  /** [rótulo, valor] do que o NEXO mostra. */
  nosso: [string, string];
  texto: string;
  /** De onde saiu o número. Aparece na tela: prova sem procedência é slogan. */
  fonte: string;
}

const PROVAS: Prova[] = [
  {
    id: "diferenca",
    kicker: "Faturamento",
    titulo: "A diferença entre os dois números tem nome",
    deles: ["Seller Central", "R$ 516,27"],
    nosso: ["Entrou de verdade", "R$ 360,99"],
    texto:
      "O painel do marketplace soma pedido pendente, pedido cancelado e preço antes do cupom num número só. O NEXO mostra os dois lado a lado e diz quanto de cada real da diferença é pendente, quanto é cancelado e quanto é desconto.",
    fonte: "Conta real, 30 dias, medido em 22/08/2026",
  },
  {
    id: "cupom",
    kicker: "Preço",
    titulo: "O preço do anúncio não é o preço da venda",
    deles: ["API de preço", "R$ 22,11"],
    nosso: ["O comprador pagou", "R$ 19,90"],
    texto:
      "Cupom não aparece na API de preço de nenhum marketplace: ela devolve o valor cheio. Quem calcula margem por ali erra para cima em toda venda com desconto — e só descobre no fechamento do mês.",
    fonte: "R$ 16,83 sumiram assim em 7 de 14 pedidos",
  },
  {
    id: "cancelado",
    kicker: "Cancelamento",
    titulo: "O que o marketplace apaga, ele já guardou",
    deles: ["Depois do cancelamento", "sem valor"],
    nosso: ["Capturado antes", "R$ 22,11"],
    texto:
      "A Amazon zera o pedido cancelado em todas as quatro fontes que oferece — some o valor, some a quantidade, some do relatório. O NEXO grava enquanto o pedido ainda está de pé, para o cancelamento não apagar a venda que existiu.",
    fonte: "Quatro APIs testadas em 22/08/2026",
  },
  {
    id: "cobertura",
    kicker: "Honestidade",
    titulo: "Quando ele não sabe, ele diz que não sabe",
    deles: ["Painel comum", "R$ 0,00"],
    nosso: ["NEXO", "1 de 160"],
    texto:
      "Zero é um fato: significa que não houve. Desconhecido é outra coisa. Todo painel confunde os dois, e é assim que um relatório fecha bonito e errado. O NEXO mostra o que capturou e diz de quantos capturou.",
    fonte: "Aponta o que falta, em vez de arredondar",
  },
];

export function Provas() {
  return (
    <section id="provas" className="lp-provas">
      <div className="lp-provas-topo">
        <p className="lp-kicker">Prova</p>
        <h2>
          Todo painel promete clareza. <span>Poucos mostram a conta.</span>
        </h2>
        <p>
          Os números abaixo saíram de contas reais rodando no NEXO. A coluna da esquerda é
          o que o marketplace exibe hoje — não é exagero nosso, é a tela dele.
        </p>
      </div>

      <ol className="lp-provas-lista">
        {PROVAS.map((prova) => (
          <li key={prova.id} className="lp-prova">
            <div className="lp-prova-texto">
              <p className="lp-kicker">{prova.kicker}</p>
              <h3>{prova.titulo}</h3>
              <p>{prova.texto}</p>
            </div>

            {/* O confronto é o argumento inteiro. Dois valores, mesma unidade,
                mesma tipografia — a assimetria tem que vir do número, nunca do
                estilo, senão vira infográfico persuasivo em vez de medição. */}
            <div className="lp-prova-confronto">
              <div className="lp-prova-lado">
                <span>{prova.deles[0]}</span>
                <strong className="is-deles">{prova.deles[1]}</strong>
              </div>
              <div className="lp-prova-lado">
                <span>{prova.nosso[0]}</span>
                <strong>{prova.nosso[1]}</strong>
              </div>
              <p className="lp-prova-fonte">{prova.fonte}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

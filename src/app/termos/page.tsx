import type { Metadata } from "next";
import Link from "next/link";

import { NexoWordmark } from "../components/NexoWordmark";
import { RodapePublico } from "../components/RodapePublico";
import { IDENTIFICACAO_LEGAL } from "../components/identidadeLegal";

export const metadata: Metadata = {
  title: "Termos de Uso — NEXO",
  description:
    "As regras de uso do NEXO: o que o serviço faz, como funciona a assinatura com garantia de 7 dias, responsabilidades e rescisão.",
};

/**
 * TERMOS DE USO — página pública, irmã da Política de Privacidade.
 *
 * ⚠️ ESTE TEXTO É RASCUNHO PARA APROVAÇÃO DA DONA DO PRODUTO
 * (22/09/2026). Ele está no ar do repositório para ela ler e corrigir; **não
 * suba para produção antes do "ok" dela no texto**. A frente nasceu da
 * reprovação do cadastro na AbacatePay, que exige a identificação do fornecedor
 * e os documentos visíveis a partir da home, sem login.
 *
 * ⚠️ O QUE FOI ESCRITO SÓ DESCREVE O QUE O PRODUTO FAZ HOJE, e
 * isso não é formalidade: documento legal que promete o que o software não faz
 * é a mesma família do texto de tela que afirma número que não existe — só que
 * com consequência contratual. Duas passagens foram medidas no código antes de
 * virar frase, e estão comentadas onde aparecem: o que a autorização dos
 * marketplaces permite (§2) e a garantia de 7 dias (§4).
 *
 * ⚠️ REUSA O LAYOUT `.privacy-*` DE PROPÓSITO: é o desenho de
 * documento legal que a casa já tem, e duas telas com a mesma função precisam
 * ter a mesma cara. O nome das classes nasceu na Política; renomear para algo
 * neutro (`.doc-legal-*`) é churn mecânico que vale a pena no dia em que
 * aparecer um terceiro documento, não hoje.
 */
export default function TermosPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" aria-label="Ir para o NEXO">
          <NexoWordmark />
        </Link>
        <div>
          <p>Condições do serviço</p>
          <h1>Termos de Uso</h1>
          <span>Versão 1.0 · rascunho de 22/09/2026 · aguardando aprovação</span>
        </div>
        <Link href="/login" className="privacy-login">Entrar</Link>
      </header>

      <div className="privacy-layout">
        <aside className="privacy-nav" aria-label="Nestes termos">
          <p>Nestes termos</p>
          <nav>
            <a href="#quem-somos">Quem somos</a>
            <a href="#objeto">O que o NEXO faz</a>
            <a href="#conta">Conta e acesso</a>
            <a href="#assinatura">Assinatura e garantia</a>
            <a href="#responsabilidades">Suas responsabilidades</a>
            <a href="#disponibilidade">Disponibilidade</a>
            <a href="#limitacao">Limitação de responsabilidade</a>
            <a href="#propriedade">Propriedade e seus dados</a>
            <a href="#rescisao">Rescisão</a>
            <a href="#alteracoes">Alterações</a>
            <a href="#foro">Lei e foro</a>
          </nav>
        </aside>

        <article className="privacy-content">
          <section aria-labelledby="quem-somos">
            <h2 id="quem-somos" className="mb-2 text-lg font-semibold text-[var(--ink)]">1. Quem somos</h2>
            <p>
              O NEXO é operado por <strong>{IDENTIFICACAO_LEGAL.razaoSocial}</strong>, inscrita no
              CNPJ sob o nº {IDENTIFICACAO_LEGAL.cnpj}. Contato:{" "}
              <a href={`mailto:${IDENTIFICACAO_LEGAL.email}`} className="underline">
                {IDENTIFICACAO_LEGAL.email}
              </a>
              .
            </p>
            <p className="mt-2">
              Ao criar uma conta ou usar o NEXO, você concorda com estes Termos e com a{" "}
              <Link href="/privacidade" className="underline">Política de Privacidade</Link>, que
              é parte integrante deles.
            </p>
          </section>

          <section aria-labelledby="objeto">
            <h2 id="objeto" className="mb-2 text-lg font-semibold text-[var(--ink)]">2. O que o NEXO faz</h2>
            <p>
              O NEXO é um serviço de software (SaaS) que reúne, num só painel, a operação de quem
              vende em marketplaces — hoje Amazon, Mercado Livre, Shopee e TikTok Shop. Ele lê os
              dados das lojas que você conecta e devolve leitura financeira e operacional:
              faturamento, tarifas, custos, margem por venda e por produto, cobertura de estoque e
              o que está pendente de apuração.
            </p>
            {/* ⚠️ MEDIDO ANTES DE ESCRITO, e a versão anterior desta
                frase seria falsa: "acesso somente leitura" é o que a maioria
                dos SaaS de análise escreve, mas o NEXO TAMBÉM ESCREVE quando
                você pede — `/api/amazon/listings` publica e edita anúncio na
                Amazon (`submitListing`, PUT na SP-API). Prometer "só leitura"
                num contrato e escrever no marketplace é divergência COM
                mentira, que é defeito, não dívida. */}
            <p className="mt-2">
              A conexão de cada loja é feita por você, pelo login do próprio marketplace (OAuth), e
              pode ser revogada por você a qualquer momento — no NEXO ou no painel do marketplace.
              A autorização é usada para <strong>ler</strong> os dados da sua operação e para
              executar, <strong>quando você pede</strong>, as ações que a tela oferece (por
              exemplo, publicar ou editar um anúncio na Amazon). O NEXO não age por conta própria
              na sua loja e não vende nem publica nada sem o seu comando.
            </p>
            <p className="mt-2">
              O NEXO <strong>não é</strong> marketplace, meio de pagamento, transportadora,
              contabilidade ou consultoria de investimento. Os números que ele exibe são leitura
              dos dados das suas lojas e do que você cadastra (como o custo dos produtos) — a
              decisão comercial e as obrigações fiscais continuam sendo suas.
            </p>
          </section>

          <section aria-labelledby="conta">
            <h2 id="conta" className="mb-2 text-lg font-semibold text-[var(--ink)]">3. Conta e acesso</h2>
            <p>
              A conta é pessoal e a senha é sua responsabilidade — quem tem a senha entra na sua
              operação. Avise-nos em {IDENTIFICACAO_LEGAL.email} se suspeitar de uso indevido.
              Você é responsável pelo que as pessoas do seu time fizerem com o acesso que você
              conceder.
            </p>
            <p className="mt-2">
              Cada conta enxerga apenas os dados do próprio espaço de trabalho. O NEXO não mistura
              dados entre clientes, e isso é garantia técnica do serviço, não configuração.
            </p>
          </section>

          <section aria-labelledby="assinatura">
            <h2 id="assinatura" className="mb-2 text-lg font-semibold text-[var(--ink)]">4. Assinatura, pagamento e garantia de 7 dias</h2>
            <p>
              O acesso ao NEXO é por <strong>assinatura mensal</strong>, cobrada de forma recorrente
              pelo meio de pagamento que você cadastrar. O valor vigente é o informado no momento da
              contratação; qualquer reajuste é avisado com antecedência e vale para os ciclos
              seguintes, nunca retroativamente.
            </p>
            {/* ⚠️ A GARANTIA DE 7 DIAS É REGRA DA DONA DO PRODUTO, já
                fixada antes desta página, e o prazo legal do Código de Defesa do
                Consumidor (art. 49) é de 7 dias para compra fora do
                estabelecimento. Os dois coincidem, e é por isso que a frase diz
                "a partir da contratação" sem inventar condição extra. */}
            <p className="mt-2">
              <strong>Garantia de 7 dias:</strong> se você pedir o cancelamento em até 7 dias
              corridos contados da primeira contratação, devolvemos o valor pago, integralmente. O
              pedido é feito por e-mail para {IDENTIFICACAO_LEGAL.email} e o reembolso segue o prazo
              do meio de pagamento usado.
            </p>
            <p className="mt-2">
              Depois desse prazo, você pode cancelar quando quiser: a assinatura deixa de ser
              renovada e o acesso continua até o fim do ciclo já pago, sem multa. Falha no
              pagamento suspende o acesso até a regularização — os seus dados continuam guardados
              conforme a seção 8.
            </p>
          </section>

          <section aria-labelledby="responsabilidades">
            <h2 id="responsabilidades" className="mb-2 text-lg font-semibold text-[var(--ink)]">5. Suas responsabilidades</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Usar o NEXO conforme a lei e as regras dos marketplaces que você conectar.</li>
              <li>Manter corretos os dados que só você sabe — custo dos produtos, alíquota de imposto e afins. O NEXO calcula sobre o que você cadastra, e aponta na tela o que está faltando.</li>
              <li>Não tentar acessar dados de outros clientes, burlar limites técnicos, automatizar acesso fora das APIs oferecidas ou revender o serviço sem acordo escrito.</li>
              <li>Conferir os números antes de decisões fiscais ou contábeis: o NEXO organiza a leitura, não substitui a sua contabilidade.</li>
            </ul>
          </section>

          <section aria-labelledby="disponibilidade">
            <h2 id="disponibilidade" className="mb-2 text-lg font-semibold text-[var(--ink)]">6. Disponibilidade e dependência de terceiros</h2>
            <p>
              Trabalhamos para manter o serviço disponível, com manutenções planejadas fora do
              horário comercial sempre que possível. O NEXO depende das APIs dos marketplaces: se
              um canal ficar indisponível, mudar sua interface de dados ou atrasar a publicação de
              um valor, a leitura daquele canal fica incompleta até ele responder.
            </p>
            <p className="mt-2">
              Quando isso acontece, o NEXO mostra o que falta — não preenche com zero nem inventa
              estimativa. É desenho do produto, e vale como compromisso aqui.
            </p>
          </section>

          <section aria-labelledby="limitacao">
            <h2 id="limitacao" className="mb-2 text-lg font-semibold text-[var(--ink)]">7. Limitação de responsabilidade</h2>
            <p>
              O NEXO é fornecido como serviço de leitura e organização de dados. Na máxima extensão
              permitida pela lei brasileira, não respondemos por lucros cessantes, perda de
              oportunidade ou danos indiretos decorrentes do uso do serviço, nem por decisões
              comerciais tomadas a partir dos números exibidos, nem por indisponibilidade,
              alteração ou erro nos dados fornecidos pelos marketplaces.
            </p>
            <p className="mt-2">
              Nossa responsabilidade, em qualquer hipótese, fica limitada ao valor pago por você ao
              NEXO nos 12 meses anteriores ao evento. Nada aqui afasta direitos que o Código de
              Defesa do Consumidor garanta a você.
            </p>
          </section>

          <section aria-labelledby="propriedade">
            <h2 id="propriedade" className="mb-2 text-lg font-semibold text-[var(--ink)]">8. Propriedade e seus dados</h2>
            <p>
              O software, a marca e as telas do NEXO são nossos. Os <strong>dados da sua operação
              são seus</strong>: nós os tratamos para prestar o serviço, conforme a{" "}
              <Link href="/privacidade" className="underline">Política de Privacidade</Link>, e você
              pode pedir a exclusão a qualquer momento.
            </p>
          </section>

          <section aria-labelledby="rescisao">
            <h2 id="rescisao" className="mb-2 text-lg font-semibold text-[var(--ink)]">9. Rescisão</h2>
            <p>
              Você encerra quando quiser, pelo painel ou por e-mail. Podemos encerrar a sua conta
              em caso de descumprimento destes Termos, uso que ameace a segurança do serviço ou de
              outros clientes, ou inadimplência — com aviso prévio, exceto quando a gravidade
              exigir ação imediata. Encerrada a conta, os dados seguem a regra de retenção e
              exclusão da Política de Privacidade.
            </p>
          </section>

          <section aria-labelledby="alteracoes">
            <h2 id="alteracoes" className="mb-2 text-lg font-semibold text-[var(--ink)]">10. Alterações destes Termos</h2>
            <p>
              Podemos atualizar estes Termos. Mudança relevante é avisada por e-mail ou no painel
              antes de valer, e a versão vigente fica sempre nesta página, com data. Continuar
              usando o serviço depois do aviso significa aceitar a nova versão.
            </p>
          </section>

          <section aria-labelledby="foro">
            <h2 id="foro" className="mb-2 text-lg font-semibold text-[var(--ink)]">11. Lei aplicável e foro</h2>
            <p>
              Estes Termos são regidos pela lei brasileira. Fica eleito o foro do domicílio do
              consumidor para dirimir qualquer questão, conforme o Código de Defesa do Consumidor.
            </p>
          </section>

          <RodapePublico />
        </article>
      </div>
    </main>
  );
}

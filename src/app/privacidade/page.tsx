import type { Metadata } from "next";
import Link from "next/link";
import { NexoWordmark } from "../components/NexoWordmark";

export const metadata: Metadata = {
  title: "Política de Privacidade — NEXO",
  description:
    "Como o NEXO coleta, usa, protege e exclui os dados da sua operação multicanal.",
};

// Página pública (listada em publicPaths no proxy). Versão resumida e pública do
// Personal Information Protection Standard (docs/compliance/) — ao alterar um,
// revise o outro.
export default function PrivacidadePage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/login" aria-label="Ir para o NEXO">
          <NexoWordmark />
        </Link>
        <div>
          <p>Segurança e privacidade</p>
          <h1>Política de Privacidade</h1>
          <span>Versão 1.1 · vigente desde 24/08/2026 · revisão anual</span>
        </div>
        <Link href="/login" className="privacy-login">Entrar</Link>
      </header>

      <div className="privacy-layout">
        <aside className="privacy-nav" aria-label="Nesta política">
          <p>Nesta política</p>
          <nav>
            <a href="#quem-somos">Quem somos</a>
            <a href="#papeis">Nossos papéis</a>
            <a href="#dados">Dados tratados</a>
            <a href="#compartilhamento">Compartilhamento</a>
            <a href="#ia">Inteligência artificial</a>
            <a href="#seguranca">Segurança</a>
            <a href="#retencao">Retenção e exclusão</a>
            <a href="#direitos">Seus direitos</a>
            <a href="#incidentes">Incidentes</a>
            <a href="#alteracoes">Alterações</a>
          </nav>
        </aside>
        <article className="privacy-content">
        <section aria-labelledby="quem-somos">
          <h2 id="quem-somos" className="mb-2 text-lg font-semibold text-[var(--ink)]">1. Quem somos</h2>
          <p>
            O NEXO é um serviço de gestão de operações multicanal para vendedores de
            marketplaces, operado por <strong>66.106.202 ANA BEATRIZ DE OLIVEIRA</strong> (CNPJ
            66.106.202/0001-20). Contato de privacidade:{" "}
            <a className="text-[var(--acao)] underline" href="mailto:contato.anabeatrizoliver@gmail.com">
              contato.anabeatrizoliver@gmail.com
            </a>
            . A encarregada pelo tratamento de dados pessoais (DPO) é Ana Beatriz de Oliveira.
          </p>
        </section>

        <section aria-labelledby="papeis">
          <h2 id="papeis" className="mb-2 text-lg font-semibold text-[var(--ink)]">2. Nossos papéis</h2>
          <p>
            Para os dados vindos dos marketplaces conectados (pedidos, anúncios, repasses), o
            vendedor define as finalidades e o NEXO atua como <strong>operador</strong>,
            seguindo suas instruções. Para os dados mínimos de conta necessários ao funcionamento do
            serviço (e-mail, sessão de acesso), o NEXO atua como <strong>controlador</strong>.
          </p>
        </section>

        <section aria-labelledby="dados">
          <h2 id="dados" className="mb-2 text-lg font-semibold text-[var(--ink)]">3. Quais dados tratamos e para quê</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Dados de conta</strong> (e-mail, sessão): autenticar você e isolar o seu workspace.</li>
            <li><strong>Dados da loja e autorização</strong> (identificadores da loja, tokens de acesso): fazer as chamadas autorizadas por você às APIs dos marketplaces.</li>
            <li><strong>Catálogo e estoque</strong> (produtos, SKUs, preços, quantidades): apresentar catálogo, cobertura de estoque e alertas.</li>
            <li><strong>Pedidos e entregas</strong> (número, status, itens): operação de vendas e acompanhamento logístico.</li>
            <li><strong>Dados de compradores</strong>: somente os campos retornados pelas APIs autorizadas e necessários ao atendimento do pedido e a obrigações fiscais brasileiras.</li>
            <li><strong>Dados financeiros</strong> (repasses, tarifas, custos): conciliação, cálculo de margem e relatórios para o vendedor.</li>
          </ul>
          <p className="mt-2">
            Não usamos dados dos marketplaces para publicidade, perfilamento não relacionado ao
            serviço, venda a terceiros ou qualquer finalidade não solicitada pelo vendedor. Não
            solicitamos dados pessoais sensíveis.
          </p>
        </section>

        <section aria-labelledby="compartilhamento">
          <h2 id="compartilhamento" className="mb-2 text-lg font-semibold text-[var(--ink)]">4. Com quem compartilhamos</h2>
          <p>
            Apenas com os provedores necessários para operar o serviço: <strong>Supabase</strong>{" "}
            (autenticação e banco de dados), <strong>Fly.io</strong> (hospedagem da aplicação),{" "}
            <strong>Google</strong> (geração do texto explicativo do NEXO — ver a seção 5),{" "}
            <strong>Crisp</strong> (chat de suporte dentro do painel — recebe apenas seu nome e
            e-mail para identificar a conversa, com servidores na União Europeia e acordo de
            processamento de dados) e os{" "}
            <strong>marketplaces autorizados por você</strong> (Amazon, Mercado Livre, Shopee e
            TikTok Shop). Não vendemos nem alugamos dados pessoais.
          </p>
        </section>

        <section aria-labelledby="ia">
          <h2 id="ia" className="mb-2 text-lg font-semibold text-[var(--ink)]">5. Inteligência artificial</h2>
          <p>
            O NEXO usa um modelo de linguagem do <strong>Google (Gemini)</strong> para escrever, em
            português, a frase que explica o que mudou na sua operação. O que enviamos ao modelo é
            um resumo <strong>agregado</strong> e nada além dele:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>faturamento, lucro, margem e variação do período;</li>
            <li>o nome dos canais conectados e os totais de cada um;</li>
            <li>fatos já apurados por nós no seu próprio dado — por exemplo &quot;nenhum anúncio ativo&quot; ou &quot;estoque zerado&quot;.</li>
          </ul>
          <p className="mt-2">
            <strong>Não enviamos dado de comprador.</strong> Nome, CPF, e-mail, telefone e endereço
            de quem comprou de você nunca saem do NEXO para o modelo. Também não enviamos seus
            tokens de acesso aos marketplaces.
          </p>
          <p className="mt-2">
            O modelo apenas <strong>redige</strong> a explicação a partir dos números que já
            calculamos — ele não decide preço, não altera anúncio e não executa ação nenhuma na sua
            conta. Esse processamento ocorre na infraestrutura do Google, que pode estar fora do
            Brasil, sob as salvaguardas contratuais aplicáveis.
          </p>
        </section>

        <section aria-labelledby="seguranca">
          <h2 id="seguranca" className="mb-2 text-lg font-semibold text-[var(--ink)]">6. Onde os dados ficam e como são protegidos</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Banco de dados e aplicação hospedados no <strong>Brasil</strong> — banco na região AWS São Paulo, aplicação na região São Paulo da Fly.io. Seus dados de operação não saem do país para funcionar.</li>
            <li>A única exceção é a geração do texto explicativo, descrita na seção 5: um resumo agregado, sem dado de comprador, é processado pelo Google sob as salvaguardas contratuais aplicáveis.</li>
            <li>Todo o tráfego é protegido por HTTPS (TLS 1.2 ou superior).</li>
            <li>Tokens de autorização dos marketplaces são criptografados em repouso (AES-256-GCM).</li>
            <li>Cada usuário tem um workspace isolado; as consultas são restritas ao seu workspace no servidor.</li>
            <li>Acesso interno segue o princípio do menor privilégio.</li>
          </ul>
        </section>

        <section aria-labelledby="retencao">
          <h2 id="retencao" className="mb-2 text-lg font-semibold text-[var(--ink)]">7. Retenção e exclusão</h2>
          <p>
            Ao desconectar uma integração, as credenciais de autorização daquela conexão são
            excluídas e o acesso à API cessa. Ao encerrar a relação com o serviço ou revogar uma
            autorização, os dados pessoais correspondentes são excluídos ou anonimizados de forma
            irreversível em até <strong>30 dias</strong>, salvo quando a lei exigir retenção — nesse
            caso o registro fica isolado e com acesso restrito.
          </p>
        </section>

        <section aria-labelledby="direitos">
          <h2 id="direitos" className="mb-2 text-lg font-semibold text-[var(--ink)]">8. Seus direitos (LGPD)</h2>
          <p>
            Você pode solicitar confirmação de tratamento, acesso, correção, portabilidade,
            informação sobre compartilhamento, revogação de consentimento e exclusão pelo e-mail{" "}
            <a className="text-[var(--acao)] underline" href="mailto:contato.anabeatrizoliver@gmail.com">
              contato.anabeatrizoliver@gmail.com
            </a>
            . Confirmamos a identidade de quem solicita e respondemos nos prazos da legislação
            aplicável, sem cobrança pelo exercício ordinário desses direitos. Quando o pedido
            envolver dados de compradores de um marketplace, atuamos em conjunto com o vendedor
            responsável.
          </p>
        </section>

        <section aria-labelledby="incidentes">
          <h2 id="incidentes" className="mb-2 text-lg font-semibold text-[var(--ink)]">9. Incidentes de segurança</h2>
          <p>
            Suspeitas de incidente são tratadas imediatamente: contenção, revogação e rotação de
            credenciais afetadas, apuração do alcance e notificação aos afetados, aos marketplaces e
            às autoridades quando exigido por lei ou contrato.
          </p>
        </section>

        <section aria-labelledby="alteracoes">
          <h2 id="alteracoes" className="mb-2 text-lg font-semibold text-[var(--ink)]">10. Alterações desta política</h2>
          <p>
            Mudanças relevantes de finalidade ou de categorias de dados serão comunicadas com
            atualização desta página e, quando exigido, renovação da autorização. A versão vigente e
            sua data constam no topo.
          </p>
        </section>
        </article>
      </div>

      <footer className="privacy-footer">
        NEXO · 66.106.202 ANA BEATRIZ DE OLIVEIRA · CNPJ 66.106.202/0001-20
      </footer>
    </main>
  );
}

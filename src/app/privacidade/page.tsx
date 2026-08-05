import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../components/Logo";

export const metadata: Metadata = {
  title: "Política de Privacidade — SellerCore",
  description:
    "Como o SellerCore coleta, usa, protege e exclui os dados da sua operação multicanal.",
};

// Página pública (listada em publicPaths no proxy). Versão resumida e pública do
// Personal Information Protection Standard (docs/compliance/) — ao alterar um,
// revise o outro.
export default function PrivacidadePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10">
        <Link href="/login" aria-label="Ir para o SellerCore">
          <Logo />
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">
          Política de Privacidade
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Versão 1.0 · vigente desde 04/08/2026 · revisada ao menos uma vez por ano
        </p>
      </header>

      <div className="space-y-8 text-[15px] leading-relaxed text-slate-700">
        <section aria-labelledby="quem-somos">
          <h2 id="quem-somos" className="mb-2 text-lg font-semibold text-slate-900">1. Quem somos</h2>
          <p>
            O SellerCore é um serviço de gestão de operações multicanal para vendedores de
            marketplaces, operado por <strong>66.106.202 ANA BEATRIZ DE OLIVEIRA</strong> (CNPJ
            66.106.202/0001-20). Contato de privacidade:{" "}
            <a className="text-blue-600 underline" href="mailto:contato.anabeatrizoliver@gmail.com">
              contato.anabeatrizoliver@gmail.com
            </a>
            . A encarregada pelo tratamento de dados pessoais (DPO) é Ana Beatriz de Oliveira.
          </p>
        </section>

        <section aria-labelledby="papeis">
          <h2 id="papeis" className="mb-2 text-lg font-semibold text-slate-900">2. Nossos papéis</h2>
          <p>
            Para os dados vindos dos marketplaces conectados (pedidos, anúncios, repasses), o
            vendedor define as finalidades e o SellerCore atua como <strong>operador</strong>,
            seguindo suas instruções. Para os dados mínimos de conta necessários ao funcionamento do
            serviço (e-mail, sessão de acesso), o SellerCore atua como <strong>controlador</strong>.
          </p>
        </section>

        <section aria-labelledby="dados">
          <h2 id="dados" className="mb-2 text-lg font-semibold text-slate-900">3. Quais dados tratamos e para quê</h2>
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
          <h2 id="compartilhamento" className="mb-2 text-lg font-semibold text-slate-900">4. Com quem compartilhamos</h2>
          <p>
            Apenas com os provedores necessários para operar o serviço: <strong>Supabase</strong>{" "}
            (autenticação e banco de dados), <strong>Render</strong> (hospedagem da aplicação) e os{" "}
            <strong>marketplaces autorizados por você</strong> (ex.: Amazon, Mercado Livre, TikTok
            Shop). Não vendemos nem alugamos dados pessoais.
          </p>
        </section>

        <section aria-labelledby="seguranca">
          <h2 id="seguranca" className="mb-2 text-lg font-semibold text-slate-900">5. Onde os dados ficam e como são protegidos</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Banco de dados hospedado no <strong>Brasil</strong> (região AWS São Paulo); aplicação processada nos <strong>Estados Unidos</strong> (Render), sob salvaguardas contratuais aplicáveis.</li>
            <li>Todo o tráfego é protegido por HTTPS (TLS 1.2 ou superior).</li>
            <li>Tokens de autorização dos marketplaces são criptografados em repouso (AES-256-GCM).</li>
            <li>Cada usuário tem um workspace isolado; as consultas são restritas ao seu workspace no servidor.</li>
            <li>Acesso interno segue o princípio do menor privilégio.</li>
          </ul>
        </section>

        <section aria-labelledby="retencao">
          <h2 id="retencao" className="mb-2 text-lg font-semibold text-slate-900">6. Retenção e exclusão</h2>
          <p>
            Ao desconectar uma integração, as credenciais de autorização daquela conexão são
            excluídas e o acesso à API cessa. Ao encerrar a relação com o serviço ou revogar uma
            autorização, os dados pessoais correspondentes são excluídos ou anonimizados de forma
            irreversível em até <strong>30 dias</strong>, salvo quando a lei exigir retenção — nesse
            caso o registro fica isolado e com acesso restrito.
          </p>
        </section>

        <section aria-labelledby="direitos">
          <h2 id="direitos" className="mb-2 text-lg font-semibold text-slate-900">7. Seus direitos (LGPD)</h2>
          <p>
            Você pode solicitar confirmação de tratamento, acesso, correção, portabilidade,
            informação sobre compartilhamento, revogação de consentimento e exclusão pelo e-mail{" "}
            <a className="text-blue-600 underline" href="mailto:contato.anabeatrizoliver@gmail.com">
              contato.anabeatrizoliver@gmail.com
            </a>
            . Confirmamos a identidade de quem solicita e respondemos nos prazos da legislação
            aplicável, sem cobrança pelo exercício ordinário desses direitos. Quando o pedido
            envolver dados de compradores de um marketplace, atuamos em conjunto com o vendedor
            responsável.
          </p>
        </section>

        <section aria-labelledby="incidentes">
          <h2 id="incidentes" className="mb-2 text-lg font-semibold text-slate-900">8. Incidentes de segurança</h2>
          <p>
            Suspeitas de incidente são tratadas imediatamente: contenção, revogação e rotação de
            credenciais afetadas, apuração do alcance e notificação aos afetados, aos marketplaces e
            às autoridades quando exigido por lei ou contrato.
          </p>
        </section>

        <section aria-labelledby="alteracoes">
          <h2 id="alteracoes" className="mb-2 text-lg font-semibold text-slate-900">9. Alterações desta política</h2>
          <p>
            Mudanças relevantes de finalidade ou de categorias de dados serão comunicadas com
            atualização desta página e, quando exigido, renovação da autorização. A versão vigente e
            sua data constam no topo.
          </p>
        </section>
      </div>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-400">
        SellerCore · 66.106.202 ANA BEATRIZ DE OLIVEIRA · CNPJ 66.106.202/0001-20
      </footer>
    </main>
  );
}

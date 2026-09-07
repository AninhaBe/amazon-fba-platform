import Link from "next/link";
import { redirect } from "next/navigation";
import { NexoWordmark } from "../components/NexoWordmark";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { lerAcesso } from "@/lib/billing/acessoDoServidor";
import { textoDoBloqueio } from "@/lib/billing/acesso";
import { DIAS_DE_GARANTIA } from "@/lib/billing/garantiaDeSeteDias";
import { BotaoDeAssinar } from "./BotaoDeAssinar";

export const dynamic = "force-dynamic";

/**
 * A PORTA DE ENTRADA — e ela mora FORA do grupo `(app)`, de propósito.
 *
 * ⚠️ NÃO É SÓ "reativação" desde o modelo v3 (07/09/2026): como não existe mais
 * período de avaliação, TODA conta sem assinatura chega aqui — a que nunca
 * assinou e a que cancelou. O texto tem de servir aos dois sem mentir para
 * nenhum: quem nunca assinou não pode ler "sua assinatura foi encerrada".
 *
 * ⚠️ Se estivesse dentro, a tranca do `(app)/layout.tsx` a barraria e mandaria
 * para ela mesma: laço de redirecionamento, e a pessoa cortada sem nenhuma tela
 * para abrir. É a mesma razão pela qual `/api/billing/checkout` passa
 * `allowExpiredTrial`.
 *
 * A página confere o acesso do lado do servidor e MANDA DE VOLTA quem já está
 * liberado — senão viraria uma tela de cobrança para quem está em dia.
 */
export default async function ReativarPage({
  searchParams,
}: {
  searchParams: Promise<{ pago?: string; cancelado?: string }>;
}) {
  const params = await searchParams;
  if (!supabaseConfigured()) redirect("/login?next=/reativar");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?next=/reativar");

  const acesso = await lerAcesso(data.user.id);

  // Voltou da Stripe pagando: o webhook é quem libera, e ele pode chegar
  // depois. Não afirmamos "está ativo" — dizemos o que sabemos e o que fazer.
  const acabouDePagar = params.pago === "1";
  if (acesso.liberado && !acabouDePagar) redirect("/");

  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="reativar-title">
        <NexoWordmark className="mb-6" />
        <p className="auth-kicker">Assinatura</p>
        <h1 id="reativar-title">
          {acesso.liberado
            ? "Pagamento recebido."
            : acesso.motivo === "assinatura-cortada"
              ? "Sua assinatura está encerrada."
              : "Assine para começar a usar o NEXO."}
        </h1>
        <div className="auth-intro-copy">
          {acesso.liberado ? (
            <p>O acesso já está liberado. Pode voltar para o painel.</p>
          ) : acabouDePagar ? (
            <>
              <p>
                A Stripe confirmou o pagamento e estamos liberando o acesso. Isso costuma levar
                alguns segundos — atualize esta página.
              </p>
              <p>Se continuar assim depois de um minuto, fale com a gente que resolvemos na hora.</p>
            </>
          ) : (
            <>
              <p>{textoDoBloqueio(acesso.motivo)}</p>
              {acesso.motivo === "assinatura-cortada" && (
                <p>
                  Nada foi apagado: canais conectados, custos cadastrados e histórico continuam onde
                  estavam e voltam a aparecer assim que o pagamento for confirmado.
                </p>
              )}
              {/* ⚠️ A GARANTIA APARECE AQUI, e não só na landing: esta é a tela
                  onde a pessoa decide pagar. Escondê-la do ponto da decisão
                  seria vender o produto e guardar a parte que tira o medo. */}
              <p>
                Você tem <strong>{DIAS_DE_GARANTIA} dias de garantia</strong>: se cancelar dentro
                desse prazo, devolvemos o valor pago, sem perguntas.
              </p>
            </>
          )}
          {params.cancelado === "1" && !acesso.liberado && (
            <p>Você saiu do pagamento sem concluir. Pode tentar de novo quando quiser.</p>
          )}
        </div>
        {acesso.liberado ? (
          <Link className="auth-submit" href="/">
            Voltar para o painel
          </Link>
        ) : (
          <BotaoDeAssinar rotulo={acesso.motivo === "assinatura-cortada" ? "Reativar assinatura" : "Assinar o NEXO"} />
        )}
      </section>
    </main>
  );
}

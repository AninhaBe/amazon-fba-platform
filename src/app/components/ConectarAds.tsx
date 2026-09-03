import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";

/**
 * O ESTADO "VOCÊ AINDA NÃO CONECTOU SEUS ANÚNCIOS".
 *
 * ⚠️ ELE EXISTE PORQUE A TELA MENTIA PARA QUEM NUNCA CONECTOU. A aba de Ads
 * mostrava *"Nenhum produto anunciado neste período"* — que é a frase do caso
 * **conectado e sem campanha**. Para quem não autorizou, ela afirma que a pessoa
 * não anunciou, quando o que falta é a autorização.
 *
 * 📌 E o efeito foi maior que uma frase errada: a aba pareceu "só da dona do
 * produto" por meses. O OAuth, o cron e a rota sempre foram por workspace — só
 * ela tinha autorizado porque ninguém mais achava o botão. A tela dizendo o
 * estado real é o que abre a aba para os clientes.
 *
 * É a doutrina da casa aplicada: tela sem dado mostra o estado real, nunca um
 * vazio que pareça "não vendeu nada". E o estado real vem com a SAÍDA — saber o
 * problema sem o caminho não ajuda ninguém.
 */

const NOME: Record<string, string> = {
  amazon: "Amazon Ads",
  mercado_livre: "Mercado Livre Ads",
};

export function ConectarAds({ faltando }: {
  faltando: Array<{ provider: string; conectarEm: string }>;
}) {
  if (faltando.length === 0) return null;
  return (
    <section className="ads-conectar" aria-labelledby="ads-conectar-titulo">
      <span className="ads-conectar-marca" aria-hidden="true"><Megaphone /></span>
      <div>
        <h2 id="ads-conectar-titulo">Você ainda não conectou seus anúncios</h2>
        <p>
          Depois de autorizar, o NEXO lê o gasto de cada campanha e mostra o que sobrou do produto
          já com a tarifa e o custo descontados — não só o quanto você gastou.
        </p>
        <div className="ads-conectar-acoes">
          {faltando.map((canal) => (
            <Link key={canal.provider} href={canal.conectarEm} className="ads-conectar-botao">
              Conectar {NOME[canal.provider] ?? canal.provider}
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
          {/* ⚠️ `/ads/como-ligar` EXISTIA E NINGUÉM CHEGAVA NELA: a instrução
              estava escrita e sem porta de entrada. Este é o lugar onde a
              pessoa está justamente procurando o caminho. */}
          <Link href="/ads/como-ligar" className="ads-conectar-ajuda">Como funciona</Link>
        </div>
      </div>
    </section>
  );
}

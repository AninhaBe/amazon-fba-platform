"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NexoMensagem } from "./NexoMensagem";

/**
 * A abertura do painel de canal — a frase que diz o que aconteceu, e o que
 * exige ação logo abaixo dela.
 *
 * ## O problema que ela resolve
 *
 * A intenção da tela é: a pessoa abre o NEXO de manhã e sabe o que aconteceu
 * com a operação dela ontem. O que existia no lugar era um subtítulo fixo —
 * "O que entrou, saiu e ainda depende de conciliação no período selecionado".
 * Isso descreve a própria tela, não o período. Ele é o mesmo texto num dia de
 * recorde e num dia de prejuízo.
 *
 * Aqui a frase é **calculada**. Muda com o dado, e é a única coisa da tela em
 * 20px — que é o tamanho que a referência reserva para a única frase que
 * carrega o peso (`docs/peec-ui-audit.md` §3 e §7).
 *
 * ## Por que a comparação vem junto
 *
 * "R$ 369,89" não permite julgamento. É bom? É ruim? Só dizendo contra o quê.
 * Todo número desta faixa nasce com o período anterior ao lado, e quando não
 * há histórico suficiente a frase **diz isso** em vez de inventar uma seta.
 *
 * ## Por que as pendências moram aqui
 *
 * Estavam em dois lugares: um bloco no topo e "Estoque crítico" no meio da
 * página, a 1.200px de distância. São a mesma pergunta — "o que precisa de
 * mim?" — e responder em dois lugares faz a pessoa rolar para descobrir se
 * terminou. Uma lista só, logo abaixo da frase.
 *
 * ## Compartilhada de propósito
 *
 * Os quatro canais usam esta mesma peça. Amazon, Mercado Livre, Shopee e
 * TikTok Shop entregam números diferentes, mas a pergunta da manhã é a mesma —
 * e quando a Shopee e o TikTok receberem conta real, a tela deles já nasce
 * igual à dos outros dois em vez de virar uma quinta variação.
 */

export interface BriefingAction {
  label: string;
  href: string;
  /** `alerta` = dinheiro parado ou venda perdida. `pendencia` = cadastro faltando. */
  tone?: "alerta" | "pendencia";
}

export interface BriefingLeadProps {
  /** Rótulo do período ("ontem", "últimos 7 dias"). Entra na frase. */
  periodo: string;
  faturamento: number | null;
  pedidos: number;
  /** `null` = ainda não dá para saber (custo ou tarifa faltando). Não é zero. */
  lucro: number | null;
  /** Faturamento do período anterior de mesmo tamanho. `null` = sem histórico. */
  faturamentoAnterior?: number | null;
  acoes?: BriefingAction[];
  format: (value: number) => string;
  loading?: boolean;
  /**
   * Liga a narração do NEXO abaixo da frase. É o identificador do canal
   * ("amazon", "mercado_livre"…) e serve de escopo do cache diário. Ausente =
   * sem narração (a peça segue puramente calculada, como antes).
   */
  escopo?: string;
  /** Nome do canal para o modelo ("Amazon"). Só usado quando `escopo` está setado. */
  canalNome?: string;
  /** Moeda dos valores, para o modelo formatar certo. */
  moeda?: string;
  /** Destino do CTA — o briefing do canal ("/amazon/briefing") ou o monitor dele. */
  briefingHref?: string;
  /** Rótulo do CTA. "Ver briefing" onde há briefing; "Ver detalhes" onde não há. */
  briefingLabel?: string;
  /**
   * POR QUE `lucro` está `null`, na linguagem do canal ("o extrato do período
   * ainda não fechou", "3 unidades sem custo cadastrado"). Vai para o NEXO junto
   * com o snapshot: sem o motivo ele deduzia a causa e errava, narrando "faltam
   * os custos cadastrados" quando o que faltava era o extrato fechar.
   */
  motivoSemLucro?: string | null;
}

function variacao(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

/**
 * A frase. Cada ramo existe porque o anterior seria mentira ou seria vazio:
 * sem venda não há o que comparar, sem custo não há lucro a afirmar, e sem
 * histórico não há variação a exibir.
 */
function montarFrase(p: BriefingLeadProps): { titulo: string; detalhe: string | null } {
  const { periodo, faturamento, pedidos, lucro, faturamentoAnterior, format } = p;

  if (faturamento == null || pedidos === 0) {
    return {
      titulo: `Nenhuma venda ${periodo}.`,
      detalhe: "Se você esperava venda neste período, vale conferir se a conta continua conectada.",
    };
  }

  const venda = `${pedidos} ${pedidos === 1 ? "venda" : "vendas"} e ${format(faturamento)} ${periodo}`;

  // Lucro desconhecido é o caso MAIS comum no começo (custo não cadastrado), e
  // é onde o produto costuma mentir mostrando zero. Aqui ele diz que não sabe.
  if (lucro == null) {
    return {
      titulo: `${venda[0].toUpperCase()}${venda.slice(1)}.`,
      detalhe: "Quanto sobrou ainda não dá para dizer — falta custo ou tarifa. O lucro fica em branco até fechar.",
    };
  }

  const sobra = lucro >= 0
    ? `sobraram ${format(lucro)}`
    : `o resultado ficou negativo em ${format(Math.abs(lucro))}`;

  const v = faturamentoAnterior != null ? variacao(faturamento, faturamentoAnterior) : null;
  const comparacao = v == null
    ? null
    : Math.abs(v) < 1
      ? "Praticamente o mesmo do período anterior."
      : `${v > 0 ? "Alta" : "Queda"} de ${Math.abs(v).toFixed(0)}% contra o período anterior.`;

  return {
    titulo: `${venda[0].toUpperCase()}${venda.slice(1)} — ${sobra}.`,
    detalhe: comparacao,
  };
}

/**
 * A narração do NEXO para o resumo do canal. Monta o snapshot do próprio canal,
 * pede o texto (modo resumo) e devolve a prosa — que SUBSTITUI a frase calculada
 * quando existe. Só narra os números que recebeu; sem chave/resposta volta null
 * e a frase calculada fica como fallback. Cache diário no servidor.
 */
function useNexoResumo(props: BriefingLeadProps): string | null {
  const [texto, setTexto] = useState<string | null>(null);
  const { escopo, canalNome, faturamento, lucro, pedidos, moeda, motivoSemLucro } = props;
  // ⚠️ A NARRAÇÃO É DOS ÚLTIMOS 30 DIAS, SEMPRE — e só é pedida nessa janela.
  //
  // Provado em 28/08/2026: o servidor cacheia o modo "resumo" por
  // (escopo, saudação, workspace, dia), SEM período. Mandar os números de
  // "hoje" não muda o texto — dois payloads com números completamente
  // diferentes voltaram idênticos, palavra por palavra. Ou seja, o efeito
  // refazia o POST a cada troca de período para receber sempre a mesma coisa,
  // e a frase afirmava, com valor por extenso, números de outro recorte.
  //
  // Agora o pedido só sai na janela de 30 dias — que é o padrão da tela e o que
  // os campos do payload (`faturamento30d`, `lucro30d`) sempre disseram ser. Em
  // outro período o texto que já veio continua na tela, e ele DIZ a janela dele
  // (ver o FORMATO do modo resumo em `centralBriefing.ts`). Nada de narrar um
  // recorte com os números de outro.
  const params = useSearchParams();
  const dias = params.get("days");
  const janelaDe30Dias = !params.get("from") && !params.get("to") && (dias == null || dias === "30");

  useEffect(() => {
    // ⚠️ TEXTO DE OUTRA JANELA NÃO FICA NA TELA (31/08/2026).
    //
    // A narração persistia ao trocar de período — e em 31/08 ela exibia
    // "40 vendas e R$ 969,45 nos últimos 30 dias" ao lado de um card de
    // R$ 1.068,37, com os R$ 969,45 vindos de um recorte anterior. Número velho
    // na tela é pior que número ausente: ele parece atual e ninguém confere.
    //
    // Ao sair da janela de 30 dias o texto SOME — mas quem esconde é o RETURN
    // lá embaixo, não um `setTexto(null)` aqui: `setState` dentro de efeito
    // dispara render em cascata (é o que o eslint acusa em `app/page.tsx:188`).
    // Derivar na renderização não tem esse custo e ainda evita o flash do texto
    // velho antes do estado limpar.
    if (!janelaDe30Dias) return;
    // ⚠️ `faturamento === 0` TAMBÉM não narra. Zero aqui não é "vendeu zero": é
    // o período ainda sem valor apurado (pendente sem preço postado), e narrar
    // "o faturamento ficou em R$ 0,00" afirma um fato que ninguém mediu. É o
    // `null ≠ 0` do AGENTS.md chegando na narração.
    if (!escopo || faturamento == null || faturamento === 0 || pedidos === 0) return;
    const margemPct = lucro != null && faturamento > 0 ? Math.round((lucro / faturamento) * 1000) / 10 : null;
    const payload = {
      modo: "resumo",
      escopo,
      data: "",
      moeda: moeda ?? "BRL",
      faturamento30d: faturamento,
      lucro30d: lucro,
      margemPct,
      variacaoSemanaPct: null,
      canais: [{ nome: canalNome ?? "seu canal", faturamento, lucro, margemPct, variacaoSemanaPct: null, semLeitura: false, unidadesSemCusto: 0,
        motivoSemLucro: lucro == null ? motivoSemLucro ?? null : null }],
    };
    let cancelado = false;
    fetch("/api/central/briefing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado && d?.texto) setTexto(d.texto as string); })
      .catch(() => {});
    return () => { cancelado = true; };
    // As dependências continuam cobrindo o que a narração REALMENTE usa —
    // escopo, canal e os números da janela de 30 dias. O que saiu foi a
    // refeitura por troca de período, que só rendia o mesmo texto de volta.
  }, [janelaDe30Dias, escopo, canalNome, faturamento, lucro, pedidos, moeda, motivoSemLucro]);

  // ⚠️ O TEXTO SÓ APARECE NA JANELA QUE ELE DESCREVE (31/08/2026).
  //
  // Antes ele persistia ao trocar de período, e em 31/08 a tela exibia
  // "40 vendas e R$ 969,45 nos últimos 30 dias" ao lado de um card de
  // R$ 1.068,37 — os R$ 969,45 vinham de outro recorte. Número velho na tela é
  // pior que número ausente: parece atual, e ninguém confere o que parece atual.
  //
  // E com `faturamento` zerado ele também não aparece: zero aqui não é "vendeu
  // zero", é período sem valor apurado ainda (pendente sem preço postado).
  // Narrar "o faturamento ficou em R$ 0,00" afirma um fato que ninguém mediu.
  return janelaDe30Dias && faturamento != null && faturamento > 0 ? texto : null;
}

export function BriefingLead(props: BriefingLeadProps) {
  const { acoes = [], loading } = props;
  // ORDEM POR SEVERIDADE, com a semantica que o proprio tipo ja define:
  // `alerta` = dinheiro parado ou venda perdida; `pendencia` = cadastro
  // faltando. Tres acoes empilhadas com o mesmo peso e lista sem hierarquia —
  // a mesma doenca das faixas. O sort e ESTAVEL, entao a ordem que o canal
  // escolheu dentro de cada tom continua valendo.
  const ordenadas = [...acoes].sort(
    (a, b) => (a.tone === "alerta" ? 0 : 1) - (b.tone === "alerta" ? 0 : 1)
  );
  // A Shopee pode emitir 6 (3 dela + 3 da saude da conta) e o ML 4. Acima de
  // tres, o resto vai para um "Mais N" — nenhuma acao e removida, so deixa de
  // competir de igual para igual com as mais graves.
  const acoesPrincipais = ordenadas.slice(0, 3);
  const acoesRestantes = ordenadas.slice(3);
  // Chamado sempre (regra dos hooks), antes de qualquer return.
  const narracao = useNexoResumo(props);

  if (loading) {
    return (
      <div className="briefing-lead is-loading" data-onboarding="context" aria-busy="true">
        <span className="briefing-lead-skeleton" style={{ width: "62%" }} />
        <span className="briefing-lead-skeleton" style={{ width: "38%", height: 18 }} />
      </div>
    );
  }

  const { titulo, detalhe } = montarFrase(props);

  return (
    <div className="briefing-lead" data-onboarding="context">
      <div className="briefing-lead-texto">
        {/* Quando o NEXO fala, ele TOMA O LUGAR da frase calculada — não fica
            abaixo dela. A frase calculada é o fallback (sem chave/resposta). */}
        {narracao ? (
          // A narração do NEXO TOMA O LUGAR da frase calculada (que fica de fallback).
          <NexoMensagem texto={narracao} ctaHref={props.briefingHref ?? "/briefing"} ctaLabel={props.briefingLabel ?? "Ver briefing"} />
        ) : (
          <>
            <h2>{titulo}</h2>
            {detalhe && <p>{detalhe}</p>}
          </>
        )}
      </div>

      {acoes.length > 0 && (
        <ul className="briefing-acoes" aria-label="O que precisa da sua atenção">
          {acoesPrincipais.map((a) => (
            <li key={a.href + a.label}>
              <Link href={a.href} className={`briefing-acao${a.tone === "alerta" ? " is-alerta" : ""}`}>
                <span className="briefing-acao-marca" aria-hidden="true" />
                <span className="briefing-acao-label">{a.label}</span>
                <ArrowRight className="briefing-acao-seta" aria-hidden />
              </Link>
            </li>
          ))}
          {acoesRestantes.length > 0 && (
            <li>
              <details className="briefing-acoes-mais">
                <summary>
                  Mais {acoesRestantes.length} {acoesRestantes.length === 1 ? "ação" : "ações"}
                </summary>
                <ul>
                  {acoesRestantes.map((a) => (
                    <li key={a.href + a.label}>
                      <Link href={a.href} className={`briefing-acao${a.tone === "alerta" ? " is-alerta" : ""}`}>
                        <span className="briefing-acao-marca" aria-hidden="true" />
                        <span className="briefing-acao-label">{a.label}</span>
                        <ArrowRight className="briefing-acao-seta" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

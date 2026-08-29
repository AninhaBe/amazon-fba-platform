"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { dicaDoImposto } from "@/lib/aliquota";
import { aliquotaEmTexto, painelDeAliquotaAberto } from "./painelDeAliquota";

/**
 * A alíquota de imposto dos QUATRO canais, numa tela só.
 *
 * ⚠️ UMA ALÍQUOTA POR CANAL. NUNCA UMA PARA TODOS.
 *
 * Pedido dela em 26/08/2026: *"cada integração pode ter sua própria alíquota,
 * não assuma que o que será cadastrado no ML poderá refletir também para amazon
 * e assim vai"*. E é a realidade fiscal: regime, substituição tributária e
 * benefício estadual mudam por canal e por operação. Um campo global escreveria
 * o mesmo número em quatro lugares e erraria três.
 *
 * Por isso cada linha aqui salva na **própria rota do canal**, que já existia:
 *
 *   GET/POST /api/integrations/<canal>/settings  →  { taxRate }
 *
 * O contrato é o mesmo nos quatro; o armazenamento é diferente em cada um
 * (Amazon e Shopee em `workspace_settings`, ML no `metadata` da conexão, TikTok
 * no registro da loja). Esta tela não sabe disso, e não precisa saber.
 *
 * 📌 Ela nasceu de um defeito: existiam DOIS campos de alíquota no Mercado
 * Livre, um que salvava e outro que só simulava dizendo "Alíquota configurada".
 * Alguém digitou 5% no que não salva, e o dashboard do canal passou horas com
 * Lucro e Margem em "—". Um lugar único e explícito é o conserto de fundo.
 */

const CANAIS = [
  { id: "amazon", rota: "amazon", nome: "Amazon" },
  { id: "mercado_livre", rota: "mercado-livre", nome: "Mercado Livre" },
  { id: "shopee", rota: "shopee", nome: "Shopee" },
  { id: "tiktok_shop", rota: "tiktok", nome: "TikTok Shop" },
] as const;

type Estado = "carregando" | "pronto" | "salvando" | "salvo" | "erro" | "desconectado";

interface LinhaDeAliquota {
  campo: string;
  /** O que está gravado na conta. `null` = não configurada. */
  salva: number | null;
  estado: Estado;
  /** Motivo REAL da falha — nunca um palpite sobre o número digitado. */
  erro: string | null;
}

const INICIAL: LinhaDeAliquota = { campo: "", salva: null, estado: "carregando", erro: null };

/**
 * `null` (nao cadastrada) e `0` (isencao declarada) NUNCA viram o mesmo texto.
 * Este e o unico lugar do painel que traduz alíquota para leitura — o recolhido
 * mostra o valor, e mostrar "0%" para quem nao cadastrou seria afirmar isencao.
 */
export function AliquotasPorCanal() {
  const [linhas, setLinhas] = useState<Record<string, LinhaDeAliquota>>(
    () => Object.fromEntries(CANAIS.map((c) => [c.id, INICIAL]))
  );

  /**
   * RECOLHIDO POR PADRAO, ABERTO QUANDO HA O QUE FAZER.
   *
   * Pedido dela (29/08/2026): o painel ocupava a Visao geral inteira com quatro
   * campos de digitacao mesmo quando as quatro alíquotas ja estavam cadastradas
   * — e era a segunda das duas faixas empilhadas no topo. Configuracao resolvida
   * nao precisa de formulario aberto; precisa do VALOR a vista.
   *
   * `null` = ninguem clicou ainda, entao quem decide e o estado do dado:
   * falta alíquota em algum canal conectado -> abre (a pendencia se mostra
   * sozinha). Clique da pessoa passa a mandar, e nao e desfeito por releitura.
   */
  const [abertoPeloUsuario, setAbertoPeloUsuario] = useState<boolean | null>(null);
  const corpoId = useId();

  const atualizar = useCallback((id: string, mudanca: Partial<LinhaDeAliquota>) => {
    setLinhas((atual) => ({ ...atual, [id]: { ...atual[id], ...mudanca } }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    for (const canal of CANAIS) {
      void fetch(`/api/integrations/${canal.rota}/settings`, { cache: "no-store", signal: controller.signal })
        .then(async (resposta) => {
          // 404 = canal não conectado. Não é erro: é estado, e a linha diz isso
          // em vez de mostrar um campo que não teria onde salvar.
          if (resposta.status === 404) return atualizar(canal.id, { estado: "desconectado" });
          const dado = await resposta.json();
          if (!resposta.ok) throw new Error(dado.error || `HTTP ${resposta.status}`);
          atualizar(canal.id, {
            campo: dado.taxRate == null ? "" : String(dado.taxRate),
            salva: dado.taxRate ?? null,
            estado: "pronto",
            erro: null,
          });
        })
        .catch((motivo) => {
          if (motivo instanceof DOMException && motivo.name === "AbortError") return;
          atualizar(canal.id, { estado: "erro", erro: motivo instanceof Error ? motivo.message : "Falha ao ler a alíquota." });
        });
    }
    return () => controller.abort();
  }, [atualizar]);

  async function salvar(canal: (typeof CANAIS)[number], event: React.FormEvent) {
    event.preventDefault();
    const linha = linhas[canal.id];
    const cru = linha.campo.trim().replace(",", ".");
    // Campo vazio LIMPA a alíquota (`null`), que é diferente de 0% — zero é
    // isenção declarada, vazio é "ainda não sei". Mesmo contrato dos quatro.
    const valor = cru === "" ? null : Number(cru);
    if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) {
      return atualizar(canal.id, { estado: "erro", erro: "Informe um percentual entre 0 e 100, ou deixe vazio para limpar." });
    }
    atualizar(canal.id, { estado: "salvando", erro: null });
    try {
      const resposta = await fetch(`/api/integrations/${canal.rota}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxRate: valor }),
      });
      const dado = await resposta.json();
      if (!resposta.ok) throw new Error(dado.error || `Não foi possível salvar (HTTP ${resposta.status}).`);
      atualizar(canal.id, {
        campo: dado.taxRate == null ? "" : String(dado.taxRate),
        salva: dado.taxRate ?? null,
        estado: "salvo",
        erro: null,
      });
    } catch (motivo) {
      // O motivo REAL. Sessão expirada, 404 e 500 não podem virar "o número
      // está errado" — foi assim que uma alíquota nunca salva passou horas
      // escondida atrás de "Informe um percentual entre 0 e 100".
      atualizar(canal.id, { estado: "erro", erro: motivo instanceof Error ? motivo.message : "Não foi possível salvar." });
    }
  }

  const algumConectado = CANAIS.some((c) => linhas[c.id].estado !== "desconectado" && linhas[c.id].estado !== "carregando");

  // Canais que a pessoa REALMENTE tem — canal nao conectado nao e pendencia de
  // imposto, e contar ele diria "faltam 4" para quem conectou um.
  const conectados = useMemo(
    () => CANAIS.filter((c) => linhas[c.id].estado !== "desconectado" && linhas[c.id].estado !== "carregando"),
    [linhas]
  );
  const lendo = CANAIS.some((c) => linhas[c.id].estado === "carregando");
  // `salva == null` e o unico teste de pendencia: 0% e isencao DECLARADA e nao
  // falta nada. Confundir os dois faria o painel cobrar quem ja respondeu.
  const semAliquota = conectados.filter((c) => linhas[c.id].salva == null);
  const aberto = painelDeAliquotaAberto({ abertoPeloUsuario, lendo, canaisSemAliquota: semAliquota.length });

  // `data-onboarding` liga este painel ao 4º passo do tour (NexoOnboarding).
  // Sem imposto cadastrado, lucro e margem do canal saem "—" ou otimistas — por
  // isso a configuração entrou no caminho de quem chega, e não só numa tela que
  // a pessoa precisaria descobrir sozinha.
  return (
    <section
      className={`aliquotas-panel ${aberto ? "is-aberto" : "is-recolhido"}`}
      data-onboarding="tax-rates"
      aria-labelledby="aliquotas-title"
    >
      <header>
        <div className="aliquotas-cabecalho">
          <div>
            <p className="section-kicker">Imposto sobre vendas</p>
            <h2 id="aliquotas-title">Alíquota de cada canal</h2>
          </div>
          {/* O botao aparece SEMPRE que ha canal conectado, inclusive aberto:
              quem abriu por pendencia precisa de uma saida, e quem abriu por
              clique precisa desfazer o clique. */}
          {algumConectado && (
            <button
              type="button"
              className="aliquotas-alternar"
              aria-expanded={aberto}
              aria-controls={corpoId}
              onClick={() => setAbertoPeloUsuario(!aberto)}
            >
              {aberto ? "Fechar" : "Editar alíquotas"}
            </button>
          )}
        </div>

        {/* RECOLHIDO: o valor a vista, canal por canal. Era isto que o painel
            aberto escondia atras de quatro campos de digitacao — quem ja
            cadastrou quer LER o numero, nao redigita-lo. */}
        {!aberto && (
          <ul className="aliquotas-resumo">
            {lendo ? (
              <li className="is-lendo">Lendo as alíquotas dos canais…</li>
            ) : conectados.length === 0 ? (
              // Tela sem dado mostra o estado real — nunca "0%", que afirmaria
              // isencao para quem nem conectou canal.
              <li className="is-lendo">Nenhum canal conectado ainda.</li>
            ) : (
              conectados.map((canal) => {
                const salva = linhas[canal.id].salva;
                return (
                  <li key={canal.id} className={salva == null ? "is-pendente" : undefined}>
                    <MarketplaceIcon provider={canal.id} />
                    <span>{canal.nome}</span>
                    <b>{aliquotaEmTexto(salva)}</b>
                  </li>
                );
              })
            )}
          </ul>
        )}

        {/* A pendencia diz O QUE falta, com numero e com os nomes — nunca um
            adjetivo que se desculpa. Fica visivel nos dois estados: recolhido
            ela e o motivo de abrir, aberto ela e a lista do que preencher. */}
        {!lendo && semAliquota.length > 0 && (
          <p className="aliquotas-pendencia">
            {semAliquota.length === 1
              ? `1 canal sem alíquota cadastrada (${semAliquota[0].nome})`
              : `${semAliquota.length} canais sem alíquota cadastrada (${semAliquota.map((c) => c.nome).join(", ")})`}
            {" — "}o lucro desses canais sai sem imposto.
          </p>
        )}

        {aberto && (
          <p>
            O percentual entra no lucro e na margem do canal onde foi cadastrado.{" "}
            <strong>Cada canal tem a sua</strong> — cadastrar na Amazon não altera o Mercado Livre.
          </p>
        )}
      </header>

      <div className="aliquotas-grid" id={corpoId} hidden={!aberto}>
        {CANAIS.map((canal) => {
          const linha = linhas[canal.id];
          const desconectado = linha.estado === "desconectado";
          return (
            <form key={canal.id} className="aliquota-linha" onSubmit={(event) => void salvar(canal, event)}>
              <span className="aliquota-canal">
                <MarketplaceIcon provider={canal.id} />
                <b>{canal.nome}</b>
              </span>

              {desconectado ? (
                <p className="aliquota-vazio">Canal não conectado</p>
              ) : (
                <>
                  <span className="aliquota-input">
                    <input
                      type="number" min="0" max="100" step="0.01" inputMode="decimal"
                      aria-label={`Alíquota de imposto — ${canal.nome}`}
                      value={linha.campo}
                      disabled={linha.estado === "carregando" || linha.estado === "salvando"}
                      onChange={(event) => atualizar(canal.id, { campo: event.target.value, estado: "pronto", erro: null })}
                    />
                    <b>%</b>
                  </span>
                  <button type="submit" disabled={linha.estado === "carregando" || linha.estado === "salvando"}>
                    {linha.estado === "salvando" ? "Salvando…" : "Salvar"}
                  </button>
                  <small aria-live="polite" className={linha.estado === "erro" ? "is-error" : undefined}>
                    {linha.estado === "carregando" ? "Lendo…"
                      : linha.estado === "erro" ? linha.erro
                      : linha.estado === "salvo" ? "Alíquota salva"
                      : dicaDoImposto(linha.campo, linha.salva)}
                  </small>
                </>
              )}
            </form>
          );
        })}
      </div>

      {algumConectado && aberto && (
        <p className="aliquotas-rodape">
          Campo vazio limpa a alíquota e o lucro do canal volta a sair sem imposto.{" "}
          <strong>0% é isenção declarada</strong> — não é a mesma coisa que vazio.
        </p>
      )}
    </section>
  );
}

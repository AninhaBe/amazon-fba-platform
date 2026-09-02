"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, CircleCheck } from "lucide-react";

import styles from "./landing-v2.module.css";

/**
 * O FORMULÁRIO DE ORÇAMENTO DA LANDING.
 *
 * ⚠️ NÃO HÁ TABELA DE PREÇOS AQUI, e isso é decisão e não omissão: a dona do
 * produto não decidiu publicar preço. O que a página oferece é o caminho —
 * orçamento conforme canais e volume —, e é isso que o texto diz, sem prometer
 * faixa nenhuma. Inventar "a partir de R$ X" para a página parecer completa
 * seria comprometer a decisão dela com um número que ninguém aprovou.
 *
 * ⚠️ A VALIDAÇÃO DAQUI É DE EXPERIÊNCIA, NUNCA DE SEGURANÇA. Este formulário é
 * entrada pública não-confiável: qualquer pessoa pode postar direto na rota, sem
 * passar por esta tela. Quem valida de verdade — formato, tamanho, limite por
 * origem — é o servidor. O que está aqui evita o envio errado de quem está de
 * boa-fé, e nada além disso.
 */

const CONTATO = "contato@nexoaihub.com";

const MARKETPLACES = ["Amazon", "Mercado Livre", "Shopee", "TikTok Shop", "Site próprio"] as const;

const FAIXAS = [
  "Até 100 pedidos/mês",
  "100 a 500 pedidos/mês",
  "500 a 2.000 pedidos/mês",
  "Mais de 2.000 pedidos/mês",
] as const;

/** O contrato combinado com o backend. Uma peça, um formato. */
export interface PedidoDeOrcamento {
  nome: string;
  email: string;
  marketplaces: string[];
  faixaDePedidos: string;
}

type Estado = { tipo: "parado" } | { tipo: "enviando" } | { tipo: "enviado" } | { tipo: "erro"; mensagem: string };

export function SolicitarOrcamento() {
  const [marketplaces, setMarketplaces] = useState<string[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "parado" });

  const alternar = (nome: string) =>
    setMarketplaces((atual) => (atual.includes(nome) ? atual.filter((item) => item !== nome) : [...atual, nome]));

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (estado.tipo === "enviando") return;
    const dados = new FormData(evento.currentTarget);
    const pedido: PedidoDeOrcamento = {
      nome: String(dados.get("nome") ?? "").trim(),
      email: String(dados.get("email") ?? "").trim(),
      marketplaces,
      faixaDePedidos: String(dados.get("faixaDePedidos") ?? ""),
    };
    setEstado({ tipo: "enviando" });
    try {
      const resposta = await fetch("/api/contato/orcamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        /**
         * ⚠️ A MENSAGEM DE ERRO DIZ O QUE FAZER, e o caminho alternativo vai
         * junto: um formulário que falha sem dar o e-mail transforma uma
         * pessoa interessada numa pessoa que desistiu.
         */
        throw new Error(corpo.error || "Não foi possível enviar agora.");
      }
      setEstado({ tipo: "enviado" });
    } catch (motivo) {
      setEstado({ tipo: "erro", mensagem: motivo instanceof Error ? motivo.message : "Não foi possível enviar agora." });
    }
  }

  if (estado.tipo === "enviado") {
    return (
      <div className={styles.quoteDone} role="status">
        <CircleCheck aria-hidden="true" />
        <div>
          <strong>Pedido recebido.</strong>
          <p>Respondemos no e-mail informado com o orçamento para os canais e o volume que você indicou.</p>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.quoteForm} onSubmit={enviar} noValidate={false}>
      <div className={styles.quoteRow}>
        <label>
          <span>Nome</span>
          <input name="nome" type="text" required maxLength={120} autoComplete="name" placeholder="Como podemos chamar você" />
        </label>
        <label>
          <span>E-mail</span>
          <input name="email" type="email" required maxLength={200} autoComplete="email" placeholder="onde respondemos" />
        </label>
      </div>

      <fieldset className={styles.quoteChannels}>
        <legend>Onde você vende hoje</legend>
        <div>
          {MARKETPLACES.map((nome) => (
            <label key={nome} data-marcado={marketplaces.includes(nome) ? "sim" : undefined}>
              <input
                type="checkbox"
                name="marketplaces"
                value={nome}
                checked={marketplaces.includes(nome)}
                onChange={() => alternar(nome)}
              />
              {nome}
            </label>
          ))}
        </div>
      </fieldset>

      <label className={styles.quoteVolume}>
        <span>Volume de pedidos</span>
        <select name="faixaDePedidos" required defaultValue="">
          <option value="" disabled>Selecione a faixa</option>
          {FAIXAS.map((faixa) => <option key={faixa} value={faixa}>{faixa}</option>)}
        </select>
      </label>

      <div className={styles.quoteActions}>
        <button type="submit" className={styles.primaryButton} disabled={estado.tipo === "enviando"}>
          {estado.tipo === "enviando" ? "Enviando…" : "Solicitar orçamento"}
          {estado.tipo === "enviando" ? null : <ArrowRight aria-hidden="true" />}
        </button>
        <p>Usamos esses dados só para responder ao seu pedido de orçamento.</p>
      </div>

      {estado.tipo === "erro" && (
        <p className={styles.quoteError} role="alert">
          <CircleAlert aria-hidden="true" />
          {estado.mensagem}
          {/* ⚠️ O CAMINHO ALTERNATIVO SO ENTRA SE O SERVIDOR NAO O DEU.
              Medido em 02/09/2026, quando a rota ficou pronta: cinco das
              mensagens dela ja citam o e-mail (as de limite, de chave ausente e
              de falha no envio) — justamente as que a pessoa mais vai ver.
              Concatenar o meu texto por cima escreveria o endereco duas vezes
              na mesma frase.
              A GARANTIA NAO MUDA: continua sempre havendo uma saida. O que muda
              e quem a escreve. */}
          {estado.mensagem.includes(CONTATO) ? null : (
            <> Se preferir, escreva para <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.</>
          )}
        </p>
      )}
    </form>
  );
}

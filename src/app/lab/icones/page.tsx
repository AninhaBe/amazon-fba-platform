"use client";

/**
 * Comparação de iconografia — `/lab/icones`.
 *
 * Os quatro pictogramas próprios ao lado dos Fluent Emoji atuais, no MESMO
 * tamanho e nos DOIS fundos (claro e o escuro do menu). Comparar fora do
 * contexto de uso é como aprovar cor olhando o balde de tinta: em 18px sobre
 * escuro, metade do que parece bom em 40px sobre branco desaparece.
 *
 * Rota pública (`/lab`), sem dado de cliente.
 */

import { pictogramas } from "../../components/pictogramas";
import { pictogramasNexo } from "../../components/pictogramasNexo";

/* ⚠️ AS DUAS FONTES USAM CHAVES DIFERENTES: o mapa do Fluent nasceu
   com os nomes do `Nav.tsx` (products/ads/stock) e o nosso com nomes em
   portugues. Comparar sem traduzir deixou tres celulas VAZIAS no primeiro
   render — e vazio nao le como erro, le como "esse icone nao existe". */
const ITENS = [
  { fluent: "dashboard", nexo: "dashboard", rotulo: "Dashboard" },
  { fluent: "products", nexo: "produtos", rotulo: "Produtos" },
  { fluent: "ads", nexo: "anuncios", rotulo: "Anúncios" },
  { fluent: "stock", nexo: "estoque", rotulo: "Radar de estoque" },
] as const;

const TAMANHOS = [18, 24, 40] as const;

function Fileira({ escuro }: { escuro: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {[
        { titulo: "Fluent Emoji (hoje)", fonte: pictogramas, campo: "fluent" as const },
        { titulo: "NEXO (proposta)", fonte: pictogramasNexo, campo: "nexo" as const },
      ].map(({ titulo, fonte, campo }) => (
        <section
          key={titulo}
          style={{
            border: `1px solid ${escuro ? "#ffffff24" : "#e3e3df"}`,
            borderRadius: 10,
            background: escuro ? "#1b1a17" : "#ffffff",
            color: escuro ? "#f4f3f0" : "#171717",
            padding: "16px 18px 18px",
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700 }}>{titulo}</h2>

          {/* Em tamanho de menu, que é onde eles precisam funcionar. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 18 }}>
            {ITENS.map((i) => (
              <span
                key={i.rotulo}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 6,
                  padding: "6px 9px",
                  fontSize: 13,
                }}
              >
                <span style={{ display: "grid", width: 18, height: 18, flex: "none" }}>
                  {fonte[i[campo]]}
                </span>
                {i.rotulo}
              </span>
            ))}
          </div>

          {/* E nos três tamanhos, para ver o que some quando encolhe. */}
          <div style={{ display: "flex", gap: 22, alignItems: "flex-end" }}>
            {ITENS.map((i) => (
              <span key={i.rotulo} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                {TAMANHOS.map((t) => (
                  <span key={t} style={{ display: "grid", width: t, height: t }}>
                    {fonte[i[campo]]}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ComparacaoDeIcones() {
  return (
    <div style={{ minHeight: "100vh", background: "#f6f5f2", padding: "28px 24px 80px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Iconografia: Fluent Emoji × NEXO</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#171717a3", maxWidth: "70ch" }}>
            Mesmos quatro objetos, mesmo tamanho, nos dois fundos. Em cima como aparecem no menu (18px);
            embaixo em 18, 24 e 40px, para ver o que some quando encolhe. O Fluent Emoji é MIT — trocar é
            escolha de identidade, não obrigação de licença.
          </p>
        </div>
        <Fileira escuro={false} />
        <Fileira escuro />
      </div>
    </div>
  );
}

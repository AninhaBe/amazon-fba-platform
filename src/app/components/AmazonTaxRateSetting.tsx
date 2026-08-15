"use client";

import { useEffect, useState } from "react";
import { readJson } from "../../lib/readJson";

/**
 * Alíquota de imposto sobre vendas da Amazon.
 *
 * A Amazon não informa imposto — ela não conhece o regime tributário de quem
 * vende. Sem este campo, o lucro da Amazon saía sem imposto enquanto o do
 * Mercado Livre saía com, e comparar os dois canais no painel era injusto.
 *
 * Campo vazio ≠ 0%: vazio é "não configurado" (o painel mostra "—" e avisa que o
 * lucro está sem imposto); 0 é uma isenção declarada. São decisões diferentes.
 */
export function AmazonTaxRateSetting() {
  const [rate, setRate] = useState("");
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [indisponivel, setIndisponivel] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/amazon/settings", { cache: "no-store", signal: controller.signal })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, status: r.status, d })))
      .then(({ ok, status, d }) => {
        if (!ok) {
          // Sem conta conectada não há o que configurar — o bloco some em vez de
          // ficar exibindo um erro que a pessoa não pode resolver aqui.
          if (status === 404) setIndisponivel(true);
          else throw new Error((d as { error?: string }).error || "Não foi possível carregar a alíquota.");
          return;
        }
        const valor = (d as { taxRate?: number | null }).taxRate;
        setRate(valor == null ? "" : String(valor));
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setErro(motivo instanceof Error ? motivo.message : "Não foi possível carregar a alíquota.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregado(true);
      });
    return () => controller.abort();
  }, []);

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    // Vazio limpa a configuração de propósito: é como voltar para "não sei".
    const bruto = rate.trim().replace(",", ".");
    const taxRate = bruto === "" ? null : Number(bruto);
    if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) {
      setErro("Informe uma alíquota entre 0 e 100.");
      setSalvando(false);
      return;
    }
    try {
      const response = await fetch("/api/integrations/amazon/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxRate }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error((data as { error?: string }).error || "Não foi possível salvar.");
      setSalvo(true);
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  if (indisponivel) return null;

  return (
    <section className="tax-setting" aria-labelledby="tax-setting-title">
      <div>
        <p className="section-kicker">Imposto sobre vendas</p>
        <h2 id="tax-setting-title" className="mt-1 text-lg font-semibold text-slate-900">Alíquota da Amazon</h2>
        <p className="tax-setting-help">
          Percentual que você paga sobre o faturamento (no Simples Nacional, o comércio começa perto de 4%).
          Enquanto estiver em branco, o lucro da Amazon aparece <strong>sem imposto</strong> — e não dá para
          comparar com o Mercado Livre, que já desconta.
        </p>
      </div>
      <form className="tax-setting-form" onSubmit={salvar}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Alíquota (%)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            inputMode="decimal"
            value={rate}
            onChange={(event) => { setRate(event.target.value); setSalvo(false); }}
            placeholder={carregado ? "ex.: 6" : "Carregando…"}
            disabled={!carregado}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" disabled={!carregado || salvando} className="tax-setting-save">
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </form>
      {erro && <p role="alert" className="tax-setting-erro">{erro}</p>}
      {salvo && !erro && (
        <p className="tax-setting-ok" role="status">
          {rate.trim() === ""
            ? "Alíquota removida — o lucro volta a aparecer sem imposto."
            : "Alíquota salva. O lucro da Amazon já desconta o imposto."}
        </p>
      )}
    </section>
  );
}

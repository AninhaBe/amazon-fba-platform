"use client";

import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";

interface Trial {
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  expired: boolean;
  note?: string;
}

// Aviso do período de avaliação.
//
// Dois níveis, de propósito: um modal na primeira visita da sessão (para a
// pessoa não descobrir o prazo tarde demais) e uma faixa fixa com a contagem
// (para não precisar lembrar). Contas normais não recebem nada.

const SEEN_KEY = "sc-trial-modal-seen";

export function TrialNotice() {
  const [trial, setTrial] = useState<Trial | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/trial", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled || !data.trial) return;
        setTrial(data.trial);
        // Uma vez por sessão do navegador — e sempre, se já venceu.
        const seen = sessionStorage.getItem(SEEN_KEY);
        if (!seen || data.trial.expired) setShowModal(true);
      } catch {
        // aviso é acessório: silencioso em caso de falha
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trial) return null;

  const dismiss = () => {
    setShowModal(false);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // navegador sem storage: o modal reaparece, sem prejuízo
    }
  };

  const days = Math.max(0, trial.daysLeft);
  const label = trial.expired
    ? "Período de avaliação encerrado"
    : days === 0
      ? "Último dia de avaliação"
      : `${days} ${days === 1 ? "dia restante" : "dias restantes"} de avaliação`;

  return (
    <>
      <div className={`trial-banner${trial.expired ? " is-expired" : ""}`} role="status">
        <strong>{label}</strong>
        <span>
          {trial.expired
            ? `Encerrado em ${brDate(trial.endsAt)}.`
            : `Acesso liberado até ${brDate(trial.endsAt)}.`}
        </span>
      </div>

      {showModal && (
        <div className="trial-modal-backdrop" role="presentation" onClick={dismiss}>
          <div
            className="trial-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="trial-modal-kicker">Conta de avaliação</p>
            <h2 id="trial-modal-title" className="trial-modal-title">
              {trial.expired ? "Seu período de teste terminou" : `Você tem ${days} ${days === 1 ? "dia" : "dias"} de teste`}
            </h2>
            <p className="trial-modal-text">
              {trial.expired ? (
                <>
                  O acesso de avaliação era válido até <strong>{brDate(trial.endsAt)}</strong>. Para
                  continuar usando o SellerCore, fale com quem liberou seu acesso.
                </>
              ) : (
                <>
                  Este acesso é uma avaliação do SellerCore, válida de{" "}
                  <strong>{brDate(trial.startsAt)}</strong> até <strong>{brDate(trial.endsAt)}</strong>.
                  Depois dessa data a conta deixa de abrir.
                </>
              )}
            </p>
            {trial.note && <p className="trial-modal-note">{trial.note}</p>}
            <button type="button" className="trial-modal-action" onClick={dismiss}>
              {trial.expired ? "Entendi" : "Começar a usar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

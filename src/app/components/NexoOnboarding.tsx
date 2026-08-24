"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import {
  NEXO_ONBOARDING_OPEN_EVENT,
  NEXO_ONBOARDING_VERSION,
  NEXO_TRIAL_DISMISSED_EVENT,
  NEXO_TRIAL_STATE_EVENT,
} from "@/lib/productTour";
import styles from "./NexoOnboarding.module.css";

const STEPS = [
  { selector: "[data-onboarding='channels']", title: "Todos os canais no mesmo lugar", description: "Troque de marketplace sem perder o contexto da operação. A visão geral reúne o que importa entre eles.", placement: "right" },
  { selector: "[data-onboarding='context'], .page-heading", title: "Comece pelo que aconteceu", description: "O NEXO abre cada painel com uma leitura do período e coloca as pendências acionáveis ao lado.", placement: "bottom" },
  { selector: "[data-onboarding='financial-summary'], .app-topbar-actions a[href='/briefing']", title: "Entenda para onde o dinheiro foi", description: "Receita, custos e resultado ficam na mesma composição. O que ainda não fechou continua explicitamente pendente.", placement: "left" },
] as const;

type TargetRect = { top: number; left: number; width: number; height: number };

export function NexoOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [canAutoOpen, setCanAutoOpen] = useState(false);
  const [target, setTarget] = useState<TargetRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const openTour = () => { setStep(0); setOpen(true); };
    const onTrialState = (event: Event) => {
      if (!(event as CustomEvent<{ willOpen?: boolean }>).detail?.willOpen) setCanAutoOpen(true);
    };
    const onTrialDismissed = () => setCanAutoOpen(true);
    window.addEventListener(NEXO_ONBOARDING_OPEN_EVENT, openTour);
    window.addEventListener(NEXO_TRIAL_STATE_EVENT, onTrialState);
    window.addEventListener(NEXO_TRIAL_DISMISSED_EVENT, onTrialDismissed);
    const fallback = window.setTimeout(() => setCanAutoOpen(true), 1800);
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener(NEXO_ONBOARDING_OPEN_EVENT, openTour);
      window.removeEventListener(NEXO_TRIAL_STATE_EVENT, onTrialState);
      window.removeEventListener(NEXO_TRIAL_DISMISSED_EVENT, onTrialDismissed);
    };
  }, []);

  useEffect(() => {
    if (!canAutoOpen) return;
    try {
      if (localStorage.getItem(NEXO_ONBOARDING_VERSION) === "seen") return;
    } catch {
      // A visita continua mesmo quando o navegador bloqueia storage.
    }
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [canAutoOpen]);

  useLayoutEffect(() => {
    if (!open) return;
    const updateTarget = () => {
      const selected = Array.from(document.querySelectorAll<HTMLElement>(STEPS[step].selector)).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ?? document.querySelector<HTMLElement>("#main-content");
      if (!selected) return;
      const rect = selected.getBoundingClientRect();
      setTarget({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    Array.from(document.querySelectorAll<HTMLElement>(STEPS[step].selector)).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const frame = window.requestAnimationFrame(updateTarget);
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tooltipRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish(); return; }
      if (event.key !== "Tab" || !tooltipRef.current) return;
      const focusable = Array.from(tooltipRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function finish() {
    try { localStorage.setItem(NEXO_ONBOARDING_VERSION, "seen"); } catch { /* persistência opcional */ }
    setOpen(false);
    window.setTimeout(() => previousFocusRef.current?.focus(), 0);
  }

  if (!open || !target) return null;

  const tooltipWidth = Math.min(296, window.innerWidth - 24);
  const tooltipHeight = 190;
  const gap = 14;
  const placement = STEPS[step].placement;
  let tooltipLeft = target.left;
  let tooltipTop = target.top;
  if (placement === "right") { tooltipLeft = target.left + target.width + gap; tooltipTop = target.top; }
  else if (placement === "left") { tooltipLeft = target.left - tooltipWidth - gap; tooltipTop = target.top; }
  else { tooltipLeft = target.left + Math.min(24, Math.max(0, target.width - tooltipWidth)); tooltipTop = target.top + target.height + gap; }
  if (tooltipLeft + tooltipWidth > window.innerWidth - 12) tooltipLeft = window.innerWidth - tooltipWidth - 12;
  if (tooltipLeft < 12) tooltipLeft = 12;
  if (tooltipTop + tooltipHeight > window.innerHeight - 12) tooltipTop = Math.max(12, target.top - tooltipHeight - gap);
  if (tooltipTop < 12) tooltipTop = 12;

  const targetStyle = {
    "--target-top": `${Math.max(4, target.top - 5)}px`,
    "--target-left": `${Math.max(4, target.left - 5)}px`,
    "--target-width": `${Math.min(window.innerWidth - 8, target.width + 10)}px`,
    "--target-height": `${Math.min(window.innerHeight - 8, target.height + 10)}px`,
    "--tooltip-top": `${tooltipTop}px`,
    "--tooltip-left": `${tooltipLeft}px`,
    "--tooltip-width": `${tooltipWidth}px`,
  } as CSSProperties;

  return (
    <div className={styles.tour} style={targetStyle}>
      <div className={styles.blocker} aria-hidden="true" />
      <div className={styles.highlight} aria-hidden="true" />
      <div ref={tooltipRef} className={`${styles.tooltip} ${styles[placement]}`} role="dialog" aria-modal="true" aria-labelledby="nexo-tour-title" aria-describedby="nexo-tour-description">
        <button type="button" className={styles.close} onClick={finish} aria-label="Fechar onboarding"><X aria-hidden="true" /></button>
        <span className={styles.progress}>{step + 1} de {STEPS.length}</span>
        <h2 id="nexo-tour-title">{STEPS[step].title}</h2>
        <p id="nexo-tour-description">{STEPS[step].description}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={finish}>Pular</button>
          <button type="button" className={styles.next} onClick={() => step === STEPS.length - 1 ? finish() : setStep((current) => current + 1)}>
            {step === STEPS.length - 1 ? "Explorar o NEXO" : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
}

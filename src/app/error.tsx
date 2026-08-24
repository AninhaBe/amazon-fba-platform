"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { NexoSymbol } from "./components/NexoSymbol";
import styles from "./error.module.css";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
};

// Fallback global para falhas inesperadas de renderizacao. Erros esperados de
// canal, permissao ou formulario continuam sendo tratados na propria tela.
export default function ErrorPage({ error, reset, unstable_retry }: ErrorPageProps) {
  const retry = unstable_retry ?? reset ?? (() => window.location.reload());

  return (
    <section role="alert" aria-labelledby="nexo-error-title" className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.brand}>
        <NexoSymbol size={20} />
        <strong>NEXO</strong>
        <span>Operação protegida</span>
      </header>

      <div className={styles.card}>
        <aside className={styles.signal} aria-hidden="true">
          <div className={styles.signalMark}>
            <span className={styles.signalRing} />
            <NexoSymbol size={54} />
          </div>
          <div className={styles.signalCopy}>
            <span />
            <p>Leitura interrompida</p>
          </div>
        </aside>

        <div className={styles.content}>
          <p className={styles.eyebrow}>Algo saiu do fluxo</p>
          <h1 id="nexo-error-title">Essa área não abriu como deveria.</h1>
          <p className={styles.description}>
            A tela não conseguiu concluir o carregamento. Tente refazer a leitura; se a
            interrupção continuar, recarregue a página por completo.
          </p>

          <div className={styles.actions}>
            <button type="button" className={styles.primaryAction} onClick={retry}>
              <RefreshCw aria-hidden="true" />
              Tentar novamente
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => window.location.reload()}
            >
              <RotateCcw aria-hidden="true" />
              Recarregar página
            </button>
          </div>

          <footer className={styles.footer}>
            <span>Você pode tentar novamente sem sair desta página.</span>
            {error.digest ? <code>Referência {error.digest}</code> : null}
          </footer>
        </div>
      </div>
    </section>
  );
}

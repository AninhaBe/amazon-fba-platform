"use client";

// Error boundary global — cai aqui o que nenhuma tela tratou.
//
// A mensagem NÃO deve apontar causa específica: este componente aparece em
// qualquer rota, inclusive no login, onde falar em "conexão da conta Amazon"
// manda a pessoa procurar problema no lugar errado. Diagnóstico de canal tem
// componente próprio (ConnectionBroken), acionado por código de erro.

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Algo deu errado</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--ink)]">Não foi possível abrir esta área</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        Pode ter sido uma falha momentânea. Tente novamente; se continuar, recarregue a página.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Tentar novamente
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] hover:bg-[var(--ink-03)]"
        >
          Recarregar a página
        </button>
      </div>
    </section>
  );
}

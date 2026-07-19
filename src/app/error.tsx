"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Algo deu errado</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Não foi possível abrir esta área</h1>
      <p className="mt-2 text-sm text-slate-500">Tente novamente. Se o problema continuar, confira a conexão da conta Amazon.</p>
      <button onClick={reset} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        Tentar novamente
      </button>
    </section>
  );
}

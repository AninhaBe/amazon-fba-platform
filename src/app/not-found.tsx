import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-[var(--line-strong)] bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Erro 404</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--ink)]">Página não encontrada</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">O endereço pode ter mudado ou não existir.</p>
      <Link href="/" className="mt-5 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Voltar ao dashboard</Link>
    </section>
  );
}

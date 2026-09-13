import { PanelLoading } from "../components/LoadingState";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-3 border-b border-[var(--line-strong)] pb-5">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--ink-08)]" />
        <div className="h-9 w-72 max-w-full animate-pulse rounded bg-[var(--ink-08)]" />
        <div className="h-4 w-[32rem] max-w-full animate-pulse rounded bg-[var(--ink-05)]" />
      </div>
      <PanelLoading label="Carregando tela" />
    </div>
  );
}

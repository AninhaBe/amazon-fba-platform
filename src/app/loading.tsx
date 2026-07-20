import { PanelLoading } from "./components/LoadingState";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-3 border-b border-slate-200 pb-5">
        <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
        <div className="h-9 w-72 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-[32rem] max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <PanelLoading label="Carregando tela" />
    </div>
  );
}

import { NexoSymbol } from "./NexoSymbol";

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return <NexoSymbol className={className} />;
}

/** Marca completa: símbolo oficial + assinatura NEXO. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="seller-logo flex items-center gap-2">
      <LogoMark className="h-8 w-8" />
      {!compact && (
        <div className="leading-none">
          <span className="brand-word text-base font-bold tracking-[-0.035em]">
            NEXO
          </span>
          <span className="brand-sub mt-1 block text-[12px] font-semibold uppercase tracking-[0.13em]">
            Operação conectada
          </span>
        </div>
      )}
    </div>
  );
}

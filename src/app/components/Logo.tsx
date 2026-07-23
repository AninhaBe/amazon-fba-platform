export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brands/sellercore-logo.png" alt="" aria-hidden="true" className="h-full w-full object-contain" />
    </span>
  );
}

/** Marca completa: símbolo + tipografia "Seller" (escuro) + "Core" (laranja). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="seller-logo flex items-center gap-3">
      <LogoMark className="h-8 w-8" />
      {!compact && (
        <div className="leading-none">
          <span className="brand-word text-base font-bold tracking-[-0.035em]">
            SELLER<span>CORE</span>
          </span>
          <span className="brand-sub mt-1 block text-[10px] font-semibold uppercase tracking-[0.13em]">
            Controle de operação
          </span>
        </div>
      )}
    </div>
  );
}

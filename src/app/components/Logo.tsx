export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`seller-mark inline-flex items-center justify-center text-white ${className}`}
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-full w-full" aria-hidden>
        <rect x="3.5" y="3.5" width="25" height="25" rx="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 22V16.5l5-4.5 4 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="seller-mark-core" cx="17" cy="15" r="3.25" />
      </svg>
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

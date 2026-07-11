// Marca do SellerCore: um "core" — hexágono (módulo/base) com núcleo central,
// em gradiente laranja. Escala bem de 24px (sidebar) a tamanhos maiores.

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/25 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[64%] w-[64%]" aria-hidden>
        {/* núcleo (core) */}
        <circle cx="12" cy="14" r="3.9" stroke="currentColor" strokeWidth="2" />
        {/* seta ascendente saindo do núcleo (crescimento) */}
        <path d="M12 14V5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path
          d="M8.6 8.4 12 5l3.4 3.4"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Marca completa: símbolo + tipografia "Seller" (escuro) + "Core" (laranja). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9" />
      {!compact && (
        <div className="leading-none">
          <span className="text-[15px] font-bold tracking-tight text-slate-900">
            Seller<span className="text-blue-600">Core</span>
          </span>
          <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
            Inteligência para Amazon
          </span>
        </div>
      )}
    </div>
  );
}
